import SwiftUI

/// The macOS app's entry point (Phase 2.1, item 1). Builds the one
/// `DependencyContainer` for the process and hands it to `RootNavigationView`
/// — every view and view model in the app is reachable from here, nothing
/// is a global singleton.
@main
struct AIMAApp: App {
    @State private var container = DependencyContainer()

    var body: some Scene {
        WindowGroup {
            RootNavigationView(container: container)
        }
        .windowResizability(.contentSize)
    }
}
