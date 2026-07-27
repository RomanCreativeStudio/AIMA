import XCTest
@testable import AIMACore

@MainActor
final class WorkspaceViewModelTests: XCTestCase {
    func testLoadListsAllFourFixedWorkspacesAndDefaultsToTheUsersDefault() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")

        await viewModel.load()

        XCTAssertEqual(viewModel.workspaces.count, 4)
        XCTAssertEqual(Set(viewModel.workspaces.map(\.slug)), Set(WorkspaceSlug.allCases))
        // MockAPIClient seeds the user's defaultWorkspaceId as the RCS workspace.
        XCTAssertEqual(viewModel.activeWorkspace?.slug, .rcs)
    }

    func testSwitchWorkspaceChangesTheActiveWorkspace() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        let personal = try! XCTUnwrap(viewModel.workspaces.first { $0.slug == .personal })

        viewModel.switchWorkspace(to: personal.id)

        XCTAssertEqual(viewModel.activeWorkspaceId, personal.id)
        XCTAssertEqual(viewModel.activeWorkspace?.slug, .personal)
    }

    func testSwitchWorkspaceIgnoresAnIdNotInTheLoadedList() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        let originalActiveId = viewModel.activeWorkspaceId

        viewModel.switchWorkspace(to: "does-not-exist")

        XCTAssertEqual(viewModel.activeWorkspaceId, originalActiveId)
    }
}
