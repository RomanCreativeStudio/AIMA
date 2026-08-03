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
    /// The signed-in user's id once real authentication succeeds (`AuthenticationViewModel.onCurrentUserChange`,
    /// wired below) — before that, or in mock mode before signing in, falls back to `AIMA_USER_ID`/`"mock-user"`
    /// exactly as before this foundation existed. Every `make*ViewModel` reads this at call time, and every one
    /// of them is only ever invoked after `RootNavigationView` appears, which itself only happens once
    /// authenticated — so by the time any view model is built, this already reflects the real signed-in user.
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
            let backendAuthClient = BackendAuthClient(configuration: configuration)
            self.authClient = backendAuthClient
            self.apiClient = URLSessionAPIClient(configuration: configuration, tokenProvider: backendAuthClient)
        }
    }

    /// Called from the Settings screen when the user changes the backend
    /// address — rebuilds the real API client against the new URL. Has no
    /// effect if the app is currently running against the mock client,
    /// since there is no backend connection to change in that mode.
    ///
    /// Also rebuilds `authClient` against the new address, which drops any current session (a fresh
    /// `BackendAuthClient` starts with none) — pointing at a different backend mid-session, signed in against
    /// the old one, has no meaningful "still signed in" state to preserve.
    func updateBackendURL(_ url: URL) {
        let newConfiguration = APIConfiguration(baseURL: url, requestTimeout: configuration.requestTimeout)
        configuration = newConfiguration
        if apiClient is URLSessionAPIClient {
            let newAuthClient = BackendAuthClient(configuration: newConfiguration)
            authClient = newAuthClient
            apiClient = URLSessionAPIClient(configuration: newConfiguration, tokenProvider: newAuthClient)
        }
    }

    func makeAuthenticationViewModel() -> AuthenticationViewModel {
        let viewModel = AuthenticationViewModel(authClient: authClient)
        viewModel.onCurrentUserChange = { [weak self] user in
            guard let self, let user else { return }
            self.userId = user.id
        }
        return viewModel
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
