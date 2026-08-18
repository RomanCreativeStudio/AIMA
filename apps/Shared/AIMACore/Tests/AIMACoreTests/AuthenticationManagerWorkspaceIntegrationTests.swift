import XCTest
@testable import AIMACore

/// Verifies the exact composition `RootNavigationView` performs (macOS Dashboard Shell sprint): seeding a
/// `WorkspaceViewModel` from an already-authenticated `AuthenticationManager`'s workspaces/`activeWorkspaceId`
/// reproduces the same workspace context, with no separate network call, and that signing out leaves nothing
/// behind to seed. `AuthenticationManagerTests` and `WorkspaceViewModelTests` already cover each type on its
/// own; this covers the handoff between them that the app itself relies on.
@MainActor
final class AuthenticationManagerWorkspaceIntegrationTests: XCTestCase {
    func testSeedingWorkspaceViewModelFromAnAuthenticatedManagerReproducesItsWorkspaceContext() async throws {
        let authClient = MockAuthClient()
        let apiClient = MockAPIClient()
        let manager = AuthenticationManager(authClient: authClient, apiClient: apiClient)
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        guard case .authenticated = manager.state else {
            XCTFail("expected AuthenticationManager to reach .authenticated before seeding")
            return
        }
        XCTAssertFalse(manager.workspaces.isEmpty, "sanity check: sign-in should have populated workspaces")

        let workspaceViewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        workspaceViewModel.seed(workspaces: manager.workspaces, activeWorkspaceId: manager.activeWorkspaceId)

        XCTAssertEqual(workspaceViewModel.workspaces.map(\.id).sorted(), manager.workspaces.map(\.id).sorted())
        XCTAssertEqual(workspaceViewModel.activeWorkspaceId, manager.activeWorkspaceId)
        XCTAssertEqual(workspaceViewModel.activeWorkspace?.id, manager.activeWorkspace?.id)
    }

    func testRestoringASessionProducesTheSameWorkspaceContextAsSigningIn() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let apiClient = MockAPIClient()
        let manager = AuthenticationManager(authClient: authClient, apiClient: apiClient)

        await manager.restoreSession()

        let workspaceViewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        workspaceViewModel.seed(workspaces: manager.workspaces, activeWorkspaceId: manager.activeWorkspaceId)

        XCTAssertEqual(workspaceViewModel.workspaces.count, 4)
        XCTAssertEqual(workspaceViewModel.activeWorkspaceId, manager.activeWorkspaceId)
    }

    func testAfterSignOutTheManagerHasNoWorkspaceContextLeftToSeed() async throws {
        let authClient = MockAuthClient()
        let apiClient = MockAPIClient()
        let manager = AuthenticationManager(authClient: authClient, apiClient: apiClient)
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        await manager.signOut()

        XCTAssertEqual(manager.state, .signedOut)
        XCTAssertTrue(manager.workspaces.isEmpty)
        XCTAssertNil(manager.activeWorkspaceId)

        // Mirrors what actually happens in the app: `RootNavigationView` (and the `WorkspaceViewModel` it owns)
        // is torn down entirely once `AuthenticationManager.state` leaves `.authenticated`, so the very next
        // `WorkspaceViewModel` ever seeded from this manager is a fresh instance seeded from nothing.
        let workspaceViewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        workspaceViewModel.seed(workspaces: manager.workspaces, activeWorkspaceId: manager.activeWorkspaceId)

        XCTAssertTrue(workspaceViewModel.workspaces.isEmpty)
        XCTAssertNil(workspaceViewModel.activeWorkspaceId)
    }
}
