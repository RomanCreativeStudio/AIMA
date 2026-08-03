import AIMACore
import SwiftUI

/// The macOS app's entry point (Phase 2.1, item 1). Builds the one
/// `DependencyContainer` for the process and gates its content on
/// authentication (macOS Authentication Foundation): `LoginView` until
/// `AuthenticationViewModel.isAuthenticated`, `RootNavigationView` after —
/// every view and view model in the app is reachable from here, nothing
/// is a global singleton.
@main
struct AIMAApp: App {
    @State private var container: DependencyContainer
    @State private var authenticationViewModel: AuthenticationViewModel

    init() {
        let container = DependencyContainer()
        _container = State(initialValue: container)
        _authenticationViewModel = State(initialValue: container.makeAuthenticationViewModel())
    }

    var body: some Scene {
        WindowGroup {
            rootContent
                .task {
                    await authenticationViewModel.restoreExistingSession()
                }
        }
        .windowResizability(.contentSize)
    }

    @ViewBuilder
    private var rootContent: some View {
        if authenticationViewModel.isAuthenticated {
            RootNavigationView(container: container)
        } else {
            LoginView(viewModel: authenticationViewModel)
        }
    }
}
