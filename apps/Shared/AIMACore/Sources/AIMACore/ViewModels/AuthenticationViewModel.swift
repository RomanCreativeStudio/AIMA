import Foundation
import Observation

/// Backs the Login screen and gates the app's root navigation (macOS Authentication Foundation): owns
/// login/loading/error state and the current signed-in user, and is the only thing in the app that calls
/// `AuthClient.signIn`/`signOut` — no view talks to `AuthClient` directly, matching every other screen's
/// `*ViewModel` boundary. `@Observable` (not Combine's `ObservableObject`), so this package stays
/// Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class AuthenticationViewModel {
    public var email = ""
    public var password = ""
    public private(set) var currentUser: AuthenticatedUser?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    /// True once a session exists — the app's only signal for whether to show `LoginView` or its normal
    /// navigation. A stored, not computed, property so `@Observable`'s change tracking fires reliably.
    public private(set) var isAuthenticated = false

    /// Notified whenever the signed-in identity changes (sign-in, sign-out, restored session) — lets
    /// `DependencyContainer` learn which user is now active without this view model reaching into it directly,
    /// mirroring `SettingsViewModel.onBackendURLChange`'s existing report-upward convention.
    public var onCurrentUserChange: ((AuthenticatedUser?) -> Void)?

    private let authClient: AuthClient

    public init(authClient: AuthClient) {
        self.authClient = authClient
    }

    /// Checks for an already-active session — call once at launch, before deciding which screen to show. A
    /// no-op today since no `AuthClient` in this foundation persists a session across relaunches (see
    /// `BackendAuthClient`'s doc comment), but kept as an explicit, separate step so a future persisted
    /// implementation only needs to change under `AuthClient`, not here.
    public func restoreExistingSession() async {
        let user = await authClient.currentUser()
        currentUser = user
        isAuthenticated = user != nil
        onCurrentUserChange?(user)
    }

    public func signIn() async {
        guard !email.isEmpty, !password.isEmpty else {
            errorMessage = "Enter your email and password."
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            try await authClient.signIn(email: email, password: password)
            let user = await authClient.currentUser()
            currentUser = user
            isAuthenticated = true
            password = ""
            onCurrentUserChange?(user)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func signOut() async {
        // Sign-out must always leave the user signed out locally — `AuthClient.signOut` only throws
        // `.noActiveSession`, which is already the state this call is trying to reach.
        try? await authClient.signOut()
        currentUser = nil
        isAuthenticated = false
        email = ""
        password = ""
        onCurrentUserChange?(nil)
    }
}
