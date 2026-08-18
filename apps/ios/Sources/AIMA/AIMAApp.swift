import AIMACore
import SwiftUI

/// The iOS app's entry point (Alpha Launch sprint) — mirrors
/// `apps/macos/Sources/AIMA/AIMAApp.swift` exactly: builds the one
/// `DependencyContainer`, gates content on `AuthenticationManager.state`
/// (`LoginView` while `.signedOut`, a loading indicator while `.loading`,
/// `RootTabView` once `.authenticated`). Onboarding (`OnboardingView`,
/// `hasCompletedOnboarding`) is a known, documented v1 gap for iOS — see
/// `apps/ios/README.md` — skipping it is non-fatal since it is only ever a
/// one-time preference write, never a requirement to use the rest of the app.
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
                    if let user {
                        container.setUserId(user.id)
                    }
                }
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        switch authenticationManager.state {
        case .loading:
            ProgressView()
        case .signedOut:
            LoginView(manager: authenticationManager)
        case .authenticated:
            RootTabView(container: container, authenticationManager: authenticationManager)
        }
    }
}
