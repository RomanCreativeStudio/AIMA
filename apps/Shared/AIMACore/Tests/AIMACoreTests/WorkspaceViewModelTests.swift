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

    // MARK: - Empty/new-account state (Product Flow & Beta Readiness Audit)

    func testLoadWithNoWorkspacesLeavesTheListEmptyWithoutAnError() async {
        let apiClient = MockAPIClient()
        // No workspace in MockAPIClient's seed data belongs to this id — the same shape a genuinely new
        // account (auto-provisioned via login, but with no workspace ever created for it) would produce.
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "brand-new-user")

        await viewModel.load()

        XCTAssertTrue(viewModel.workspaces.isEmpty)
        XCTAssertNil(viewModel.activeWorkspace, "with no workspaces loaded, there can be no active one to show")
        XCTAssertNil(viewModel.errorMessage, "having zero workspaces is a valid, non-error state")
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

    // MARK: - Cross-Workspace Daily Digest sprint

    func testDigestStartsEmptyBeforeLoadDigestIsCalled() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()

        XCTAssertTrue(viewModel.digest.isEmpty, "loadDigest is an explicit fetch, never automatic")
    }

    func testLoadDigestPopulatesOneEntryPerWorkspace() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")
        await viewModel.load()

        await viewModel.loadDigest()

        XCTAssertEqual(Set(viewModel.digest.map(\.workspaceId)), Set(viewModel.workspaces.map(\.id)))
        XCTAssertFalse(viewModel.isLoadingDigest)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadDigestIsScopedByTheAuthenticatedCallerNotTheViewModelsOwnUserId() async {
        let apiClient = MockAPIClient()
        // A userId with no matching seeded workspace still gets every workspace MockAPIClient's one
        // authenticated user owns — mirrors the backend's `GET /digest`, which takes no userId param at all.
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "brand-new-user")

        await viewModel.loadDigest()

        XCTAssertEqual(viewModel.digest.count, 4)
    }

    func testLoadDigestSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = WorkspaceViewModel(apiClient: apiClient, userId: "mock-user")

        await viewModel.loadDigest()

        XCTAssertTrue(viewModel.digest.isEmpty)
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoadingDigest)
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
