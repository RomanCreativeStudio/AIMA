import Foundation
import Observation

/// The three states an app session can be in — deliberately just these three, not a richer state machine: any
/// screen gating logic (`AIMAApp`'s "show `LoginView` or the real app") only ever needs to ask "loading, signed
/// out, or here's the signed-in user."
public enum AuthenticationState: Equatable, Sendable {
    case loading
    case signedOut
    case authenticated(UserProfile)
}

/// Turns a session (`AuthClient`) into a usable app context: the signed-in user's full `UserProfile` and their
/// workspaces (`APIClient.getUser`/`.listWorkspaces` — both already existed for `WorkspaceViewModel`, reused
/// here rather than duplicated). Coordinates `BackendAuthClient` through the `AuthClient` protocol, exactly
/// like every other consumer in this package depends on `APIClient` rather than `URLSessionAPIClient` directly
/// — `MockAuthClient`/`MockAPIClient` stand in for tests and previews.
///
/// `@MainActor @Observable` (not Combine's `ObservableObject`), matching every other view-facing coordinator in
/// this package, so it stays Linux-buildable — see `Package.swift`. Platform-independent: nothing here imports
/// SwiftUI/AppKit, and nothing here decides *how* a session is stored (that's `AuthClient`'s `SessionStore`).
@MainActor
@Observable
public final class AuthenticationManager {
    public private(set) var state: AuthenticationState = .loading
    /// The signed-in user's workspaces, loaded alongside their profile on every path that reaches
    /// `.authenticated` — mirrors `WorkspaceViewModel.workspaces`, not duplicated logic, just fetched here too
    /// since "authenticated context" per this sprint's goal means having them ready, not re-fetching later.
    public private(set) var workspaces: [Workspace] = []
    /// Defaults to the user's `defaultWorkspaceId`, falling back to the first workspace — the same rule
    /// `WorkspaceViewModel.load()` already uses.
    public private(set) var activeWorkspaceId: String?
    public private(set) var errorMessage: String?

    private let authClient: AuthClient
    private let apiClient: APIClient

    public init(authClient: AuthClient, apiClient: APIClient) {
        self.authClient = authClient
        self.apiClient = apiClient
    }

    /// The signed-in user's profile, or `nil` unless `state == .authenticated`. A convenience over pattern-matching `state` everywhere a caller just wants the profile.
    public var currentUser: UserProfile? {
        if case .authenticated(let user) = state {
            return user
        }
        return nil
    }

    public var activeWorkspace: Workspace? {
        workspaces.first { $0.id == activeWorkspaceId }
    }

    /// Beta Onboarding sprint: reuses `UserProfile.preferences` (the existing generic JSONB blob, already
    /// round-tripped via `apiClient.updateUserProfile`) instead of a new state manager or a new column — the
    /// task's own instruction was "use existing architecture... do not create another state manager." `false`
    /// for a signed-out session, a freshly-provisioned account with no preferences yet, or any existing account
    /// that predates this flag (there is no reliable signal to distinguish "old existing account" from "genuinely
    /// new" retroactively, so this never shows onboarding to an account that's already been using AIMA).
    public var hasCompletedOnboarding: Bool {
        if case .bool(true) = currentUser?.preferences["onboardingCompleted"] {
            return true
        }
        return false
    }

    /// Beta Tester Infrastructure sprint: whether this account is marked as a beta tester — reuses
    /// `UserProfile.preferences` exactly like `hasCompletedOnboarding` above, no schema change or new state
    /// manager. This is a tracking/analytics marker only, not an access gate: AIMA has no invite/waitlist
    /// system, so this never blocks sign-in — it only lets the app (and whoever's running the beta) know who
    /// opted in. Read-only here; there is deliberately no `setBetaTester` — an account's beta status is an
    /// operational decision made outside the app, not something a user toggles on themselves.
    public var isBetaTester: Bool {
        if case .bool(true) = currentUser?.preferences["betaTester"] {
            return true
        }
        return false
    }

    /// Startup flow: restore session → validate/refresh if needed → fetch user → fetch workspaces →
    /// `.authenticated`. Call once at launch, before deciding which screen to show (`AIMAApp` does exactly
    /// that: `.task { await authenticationManager.restoreSession() }`, gating `rootContent` on `state`).
    public func restoreSession() async {
        state = .loading
        errorMessage = nil

        guard var session = await authClient.currentSession() else {
            state = .signedOut
            return
        }

        if session.isExpired {
            do {
                session = try await authClient.refreshSession()
            } catch {
                // The session `AuthClient` restored can't actually be used — a caller checking `state` needs to
                // see "signed out," not a stale "authenticated" left over from before the refresh was even tried.
                state = .signedOut
                return
            }
        }

        await loadAuthenticatedContext(userId: session.userId)
    }

    /// Login flow: sign in → (session is saved by `AuthClient` itself, via its `SessionStore`) → fetch user →
    /// fetch workspaces → `.authenticated`.
    public func signIn(email: String, password: String) async {
        state = .loading
        errorMessage = nil

        do {
            let session = try await authClient.signIn(email: email, password: password)
            await loadAuthenticatedContext(userId: session.userId)
        } catch let error as APIError {
            errorMessage = error.userMessage
            state = .signedOut
        } catch {
            errorMessage = error.localizedDescription
            state = .signedOut
        }
    }

    /// Logout flow: clear everything → `.signedOut`. `AuthClient.signOut` already clears its own session/store;
    /// this clears the context built on top of it (profile, workspaces) so nothing stale survives into the next sign-in.
    public func signOut() async {
        // Sign-out must always leave the user signed out locally — `AuthClient.signOut` only throws
        // `.noActiveSession`, which is already the state this call is trying to reach.
        try? await authClient.signOut()
        workspaces = []
        activeWorkspaceId = nil
        errorMessage = nil
        state = .signedOut
    }

    /// Changes which workspace `activeWorkspace` points at — never fetches anything, mirrors
    /// `WorkspaceViewModel.switchWorkspace(to:)`'s "only changes which workspace this app is pointed at" scope exactly.
    public func switchWorkspace(to workspaceId: String) {
        guard workspaces.contains(where: { $0.id == workspaceId }) else { return }
        activeWorkspaceId = workspaceId
    }

    /// Marks onboarding complete for the signed-in user, persisting it via the existing `updateUserProfile`
    /// endpoint so it survives sign-out/sign-in and future launches. Merges into `currentUser.preferences`
    /// rather than replacing it — other preference keys (e.g. `set_preference`-written ones) are untouched.
    /// A no-op if called while not authenticated.
    public func completeOnboarding() async {
        guard let user = currentUser else { return }

        var preferences = user.preferences
        preferences["onboardingCompleted"] = .bool(true)

        do {
            let updated = try await apiClient.updateUserProfile(
                id: user.id,
                request: UpdateUserProfileRequest(preferences: preferences)
            )
            state = .authenticated(updated)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadAuthenticatedContext(userId: String) async {
        do {
            async let userResult = apiClient.getUser(id: userId)
            async let workspacesResult = apiClient.listWorkspaces(userId: userId)
            let (user, workspaces) = try await (userResult, workspacesResult)

            self.workspaces = workspaces
            self.activeWorkspaceId = user.defaultWorkspaceId ?? workspaces.first?.id
            state = .authenticated(user)
        } catch let error as APIError {
            errorMessage = error.userMessage
            workspaces = []
            activeWorkspaceId = nil
            state = .signedOut
        } catch {
            errorMessage = error.localizedDescription
            workspaces = []
            activeWorkspaceId = nil
            state = .signedOut
        }
    }
}
