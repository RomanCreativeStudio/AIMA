import AIMACore
import Foundation

/// The macOS app's composition root (Phase 2.1, item 1: Dependency
/// Injection). Owns the single `APIClient` instance every view model is
/// built from, and is the only place that decides real vs. mock — nothing
/// else in the app ever constructs a `URLSessionAPIClient` or
/// `MockAPIClient` directly. `@Observable` so changing the backend
/// connection (Settings screen) or swapping in the mock client updates
/// every view that reads `apiClient`/`configuration`.
@MainActor
@Observable
final class DependencyContainer {
    private(set) var apiClient: APIClient
    private(set) var configuration: APIConfiguration
    let userId: String

    /// `AIMA_USE_MOCK_API=1` runs the app entirely against `MockAPIClient` —
    /// useful for demoing the UI without a running backend. `AIMA_USER_ID`
    /// stands in for the single-user MVP's account id until real
    /// authentication exists (backend/README.md's "what's not built yet").
    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let configuration = APIConfiguration.fromEnvironment(environment)
        self.configuration = configuration
        self.userId = environment["AIMA_USER_ID"] ?? "mock-user"

        if environment["AIMA_USE_MOCK_API"] == "1" {
            self.apiClient = MockAPIClient()
        } else {
            self.apiClient = URLSessionAPIClient(configuration: configuration)
        }
    }

    /// Called from the Settings screen when the user changes the backend
    /// address — rebuilds the real API client against the new URL. Has no
    /// effect if the app is currently running against the mock client,
    /// since there is no backend connection to change in that mode.
    func updateBackendURL(_ url: URL) {
        let newConfiguration = APIConfiguration(baseURL: url, requestTimeout: configuration.requestTimeout)
        configuration = newConfiguration
        if apiClient is URLSessionAPIClient {
            apiClient = URLSessionAPIClient(configuration: newConfiguration)
        }
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

    func makeSettingsViewModel() -> SettingsViewModel {
        SettingsViewModel(apiClient: apiClient, userId: userId, currentConfiguration: configuration)
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
