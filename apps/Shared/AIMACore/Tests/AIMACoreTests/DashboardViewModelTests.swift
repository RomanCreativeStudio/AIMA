import XCTest
@testable import AIMACore

@MainActor
final class DashboardViewModelTests: XCTestCase {
    func testLoadPopulatesWorkspaceHealthApprovalsAndTasks() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        XCTAssertEqual(viewModel.workspace?.id, "mock-ws-rcs")
        XCTAssertNotNil(viewModel.systemHealth)
        XCTAssertEqual(viewModel.pendingApprovals.count, 1)
        XCTAssertEqual(viewModel.tasks.count, 2)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testTaskCountsRollUpByStatus() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let counts = viewModel.taskCounts
        XCTAssertEqual(counts.todo, 1)
        XCTAssertEqual(counts.inProgress, 1)
        XCTAssertEqual(counts.done, 0)
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.workspace)
    }

    func testApproveRemovesTheApprovalFromThePendingList() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        let approval = try! XCTUnwrap(viewModel.pendingApprovals.first)

        await viewModel.approve(approval, workspaceId: "mock-ws-rcs")

        XCTAssertTrue(viewModel.pendingApprovals.isEmpty)
    }

    func testRejectRemovesTheApprovalFromThePendingList() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        let approval = try! XCTUnwrap(viewModel.pendingApprovals.first)

        await viewModel.reject(approval, workspaceId: "mock-ws-rcs")

        XCTAssertTrue(viewModel.pendingApprovals.isEmpty)
    }
}
