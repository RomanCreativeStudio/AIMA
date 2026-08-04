import AIMACore
import Foundation

/// The macOS app's composition root (Phase 2.1, item 1: Dependency
/// Injection). Owns the single `APIClient` and `AuthClient` instance every
/// view model is built from, and is the only place that decides real vs.
/// mock — nothing else in the app ever constructs a `URLSessionAPIClient`,
/// `BackendAuthClient`, `MockAPIClient`, or `MockAuthClient` directly.
/// `@Observable` so changing the backend connection (Settings screen) or
/// swapping in the mock client updates every view that reads
/// `apiClient`/`configuration`.
@MainActor
@Observable
final class DependencyContainer {
    private(set) var apiClient: APIClient
    private(set) var configuration: APIConfiguration
    private(set) var authClient: AuthClient
    /// The signed-in user's id once real authentication succeeds (`setUserId(_:)`, called from `AIMAApp` when
    /// `AuthenticationManager.currentUser` changes) — before that, or in mock mode before signing in, falls back
    /// to `AIMA_USER_ID`/`"mock-user"` exactly as before this foundation existed. Every `make*ViewModel` reads
    /// this at call time, and every one of them is only ever invoked after `RootNavigationView` appears, which
    /// itself only happens once `AuthenticationManager.state` is `.authenticated` — so by the time any view
    /// model is built, this already reflects the real signed-in user.
    private(set) var userId: String

    /// `AIMA_USE_MOCK_API=1` runs the app entirely against `MockAPIClient`/`MockAuthClient` — useful for
    /// demoing the UI without a running backend (sign in with `MockAuthClient.seededEmail`/`seededPassword`).
    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let configuration = APIConfiguration.fromEnvironment(environment)
        self.configuration = configuration
        self.userId = environment["AIMA_USER_ID"] ?? "mock-user"

        if environment["AIMA_USE_MOCK_API"] == "1" {
            let mockAuthClient = MockAuthClient()
            self.authClient = mockAuthClient
            self.apiClient = MockAPIClient()
        } else {
            let backendAuthClient = BackendAuthClient(configuration: configuration, sessionStore: Self.sessionStore(for: configuration))
            self.authClient = backendAuthClient
            self.apiClient = URLSessionAPIClient(configuration: configuration, tokenProvider: backendAuthClient)
        }
    }

    /// Called from the Settings screen when the user changes the backend
    /// address — rebuilds the real API client against the new URL. Has no
    /// effect if the app is currently running against the mock client,
    /// since there is no backend connection to change in that mode.
    ///
    /// Also rebuilds `authClient` against the new address. Its `KeychainSessionStore` is keyed by host (see
    /// `sessionStore(for:)`), so this never reads or overwrites a session that belongs to a different backend —
    /// pointing at a backend this app hasn't signed into before starts genuinely signed out, and pointing back
    /// at one it has restores that backend's own session correctly.
    func updateBackendURL(_ url: URL) {
        let newConfiguration = APIConfiguration(baseURL: url, requestTimeout: configuration.requestTimeout)
        configuration = newConfiguration
        if apiClient is URLSessionAPIClient {
            let newAuthClient = BackendAuthClient(configuration: newConfiguration, sessionStore: Self.sessionStore(for: newConfiguration))
            authClient = newAuthClient
            apiClient = URLSessionAPIClient(configuration: newConfiguration, tokenProvider: newAuthClient)
        }
    }

    /// One `KeychainSessionStore` per backend host — so a session issued by one backend (e.g. production) is
    /// never handed to a different one (e.g. a local dev server) just because the user pointed Settings at it.
    private static func sessionStore(for configuration: APIConfiguration) -> SessionStore {
        KeychainSessionStore(account: configuration.baseURL.host ?? configuration.baseURL.absoluteString)
    }

    /// The single `AuthenticationManager` for the process (macOS Auth Bootstrap sprint) — coordinates
    /// `authClient`/`apiClient` into `.loading`/`.signedOut`/`.authenticated(UserProfile)`, replacing the
    /// narrower `AuthenticationViewModel` (identity-only, no profile/workspaces) this app used before.
    func makeAuthenticationManager() -> AuthenticationManager {
        AuthenticationManager(authClient: authClient, apiClient: apiClient)
    }

    /// Called from `AIMAApp` once `AuthenticationManager.currentUser` reflects a real signed-in profile — the
    /// same "report the authenticated id upward so `make*ViewModel` calls use it" role
    /// `makeAuthenticationManager`'s predecessor filled via `onCurrentUserChange`, just invoked by the view
    /// layer now that `AuthenticationManager` owns no callback of its own.
    func setUserId(_ userId: String) {
        self.userId = userId
    }

    func makeWorkspaceViewModel() -> WorkspaceViewModel {
        WorkspaceViewModel(apiClient: apiClient, userId: userId)
    }

    func makeDashboardViewModel() -> DashboardViewModel {
        DashboardViewModel(apiClient: apiClient)
    }

    func makeChatViewModel(workspaceId: String) -> ChatViewModel {
        ChatViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeApprovalsViewModel(workspaceId: String) -> ApprovalsViewModel {
        ApprovalsViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeTasksViewModel(workspaceId: String) -> TasksViewModel {
        TasksViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeIntegrationsViewModel(workspaceId: String) -> IntegrationsViewModel {
        IntegrationsViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeWorkflowsViewModel(workspaceId: String) -> WorkflowsViewModel {
        WorkflowsViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeExecutionsViewModel(workspaceId: String) -> ExecutionsViewModel {
        ExecutionsViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeVoiceSessionViewModel(workspaceId: String) -> VoiceSessionViewModel {
        VoiceSessionViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeSettingsViewModel() -> SettingsViewModel {
        SettingsViewModel(apiClient: apiClient, userId: userId, currentConfiguration: configuration)
    }

    func makeMemoryViewModel(workspaceId: String) -> MemoryViewModel {
        MemoryViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeFeedbackViewModel(workspaceId: String) -> FeedbackViewModel {
        FeedbackViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeAdminViewModel() -> AdminViewModel {
        AdminViewModel(apiClient: apiClient)
    }

    func makeInvitationViewModel() -> InvitationViewModel {
        InvitationViewModel(apiClient: apiClient)
    }

    func makeSearchViewModel(workspaceId: String) -> SearchViewModel {
        SearchViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }
}

#if DEBUG
extension DependencyContainer {
    /// Used by every screen's `#Preview` — always mock, never touches a real backend.
    static var preview: DependencyContainer {
        DependencyContainer(environment: ["AIMA_USE_MOCK_API": "1", "AIMA_USER_ID": "mock-user"])
    }
}
#endif
