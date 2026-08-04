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

    func testLoadActivitySummaryPopulatesTheActiveWorkspacesInsights() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        XCTAssertNil(viewModel.activitySummary, "sanity check: nothing loaded yet")

        await viewModel.loadActivitySummary()

        let summary = try! XCTUnwrap(viewModel.activitySummary)
        XCTAssertEqual(summary.workspaceId, viewModel.activeWorkspaceId)
    }

    func testSwitchWorkspaceClearsTheStaleActivitySummary() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        await viewModel.loadActivitySummary()
        let personal = try! XCTUnwrap(viewModel.workspaces.first { $0.slug == .personal })

        viewModel.switchWorkspace(to: personal.id)

        XCTAssertNil(viewModel.activitySummary)
    }

    func testReindexEmbeddingsPopulatesLastReindexResultForTheActiveWorkspace() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        XCTAssertNil(viewModel.lastReindexResult, "sanity check: nothing reindexed yet")

        await viewModel.reindexEmbeddings()

        XCTAssertNotNil(viewModel.lastReindexResult)
        XCTAssertFalse(viewModel.isReindexing)
    }

    func testSeedPopulatesWorkspacesAndActiveWorkspaceWithoutAnApiCall() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        let workspaces = [
            Workspace(
                id: "seeded-ws", userId: "mock-user", slug: .personal, name: "Seeded",
                type: .personal, instructions: nil, assistantBehavior: [:], metadata: [:],
                createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
            ),
        ]

        viewModel.seed(workspaces: workspaces, activeWorkspaceId: "seeded-ws")

        XCTAssertEqual(viewModel.workspaces.map(\.id), ["seeded-ws"])
        XCTAssertEqual(viewModel.activeWorkspaceId, "seeded-ws")
    }

    func testSeedFallsBackToTheFirstWorkspaceWhenTheGivenActiveIdIsNotInTheList() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        let workspaces = [
            Workspace(
                id: "ws-1", userId: "mock-user", slug: .personal, name: "One",
                type: .personal, instructions: nil, assistantBehavior: [:], metadata: [:],
                createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
            ),
        ]

        viewModel.seed(workspaces: workspaces, activeWorkspaceId: "does-not-exist")

        XCTAssertEqual(viewModel.activeWorkspaceId, "ws-1")
    }

    func testSwitchWorkspaceClearsTheStaleReindexResult() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()
        await viewModel.reindexEmbeddings()
        let personal = try! XCTUnwrap(viewModel.workspaces.first { $0.slug == .personal })

        viewModel.switchWorkspace(to: personal.id)

        XCTAssertNil(viewModel.lastReindexResult)
    }
}
