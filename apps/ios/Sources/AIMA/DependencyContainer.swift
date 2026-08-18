import AIMACore
import Foundation

/// The iOS app's composition root (Alpha Launch sprint) — a deliberately smaller sibling of
/// `apps/macos/Sources/AIMA/DependencyContainer.swift`: same pattern (owns the single `APIClient`/`AuthClient`
/// instance, decides real vs. mock, exposes one `make*ViewModel()` factory per screen this app actually has),
/// trimmed to only the six tabs `RootTabView` shows (Dashboard, Chat, Tasks, Memory, Workspace, Settings) — the
/// sprint's own instruction is "the smallest SwiftUI iOS target using existing shared code," not a second copy
/// of every macOS screen. Nothing here is AppKit/UIKit-specific; it is pure Foundation/AIMACore, exactly like
/// macOS's version.
@MainActor
@Observable
final class DependencyContainer {
    private(set) var apiClient: APIClient
    private(set) var configuration: APIConfiguration
    private(set) var authClient: AuthClient
    private(set) var userId: String

    /// `AIMA_USE_MOCK_API=1` runs the app entirely against `MockAPIClient`/`MockAuthClient` — useful for
    /// exercising the UI without a running backend (sign in with `MockAuthClient.seededEmail`/`seededPassword`).
    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let configuration = APIConfiguration.resolved(environment: environment)
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

    /// Called from the Settings screen when the user changes the backend address — e.g. pointing a physical
    /// iPhone at its Mac's LAN IP. Persists via `APIConfiguration.save(baseURL:)` so the address survives
    /// relaunch instead of reverting to `developmentDefault`'s useless-on-device `127.0.0.1` (see
    /// `APIConfiguration.resolved`'s doc comment).
    func updateBackendURL(_ url: URL) {
        let newConfiguration = APIConfiguration(baseURL: url, requestTimeout: configuration.requestTimeout)
        configuration = newConfiguration
        APIConfiguration.save(baseURL: url)
        if apiClient is URLSessionAPIClient {
            let newAuthClient = BackendAuthClient(configuration: newConfiguration, sessionStore: Self.sessionStore(for: newConfiguration))
            authClient = newAuthClient
            apiClient = URLSessionAPIClient(configuration: newConfiguration, tokenProvider: newAuthClient)
        }
    }

    /// One `KeychainSessionStore` per backend host — so a session issued by one backend is never handed to a
    /// different one just because Settings was pointed at it (same rule as macOS's container).
    private static func sessionStore(for configuration: APIConfiguration) -> SessionStore {
        KeychainSessionStore(account: configuration.baseURL.host ?? configuration.baseURL.absoluteString)
    }

    func makeAuthenticationManager() -> AuthenticationManager {
        AuthenticationManager(authClient: authClient, apiClient: apiClient)
    }

    /// Called once `AuthenticationManager.currentUser` reflects a real signed-in profile, mirroring macOS's
    /// `AIMAApp.onChange(of: authenticationManager.currentUser)`.
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

    func makeTasksViewModel(workspaceId: String) -> TasksViewModel {
        TasksViewModel(apiClient: apiClient, workspaceId: workspaceId)
    }

    func makeMemoryViewModel(workspaceId: String) -> MemoryViewModel {
        MemoryViewModel(apiClient: apiClient, workspaceId: workspaceId)
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
