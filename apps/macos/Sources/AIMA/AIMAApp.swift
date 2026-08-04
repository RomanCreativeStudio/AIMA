import AIMACore
import SwiftUI

/// The macOS app's entry point (Phase 2.1, item 1). Builds the one
/// `DependencyContainer` for the process and gates its content on
/// `AuthenticationManager.state` (macOS Auth Bootstrap sprint): `LoginView`
/// while `.signedOut`, a minimal loading indicator while `.loading`,
/// `RootNavigationView` once `.authenticated` — every view and view model
/// in the app is reachable from here, nothing is a global singleton.
@main
struct AIMAApp: App {
    @State private var container: DependencyContainer
    @State private var authenticationManager: AuthenticationManager

    init() {
        let container = DependencyContainer()
        _container = State(initialValue: container)
        _authenticationManager = State(initialValue: container.makeAuthenticationManager())
    }

    var body: some Scene {
        WindowGroup {
            rootContent
                .task {
                    await authenticationManager.restoreSession()
                }
                .onChange(of: authenticationManager.currentUser) { _, user in
                    // Reports the real signed-in id up to the container so every `make*ViewModel` call made
                    // once `RootNavigationView` appears already uses it — a `.onChange`, not an inline mutation
                    // during view-body evaluation, since SwiftUI disallows mutating observed state while a
                    // view's body is being computed.
                    if let user {
                        container.setUserId(user.id)
                    }
                }
        }
        .windowResizability(.contentSize)
    }

    @ViewBuilder
    private var rootContent: some View {
        switch authenticationManager.state {
        case .loading:
            ProgressView()
                .frame(width: 320, height: 200)
        case .signedOut:
            LoginView(manager: authenticationManager)
        case .authenticated:
            RootNavigationView(container: container, authenticationManager: authenticationManager)
        }
    }
}
