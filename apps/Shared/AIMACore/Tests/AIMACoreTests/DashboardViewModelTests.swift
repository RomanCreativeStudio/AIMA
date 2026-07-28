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

    func testLoadPopulatesTheDailyBriefing() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let briefing = try! XCTUnwrap(viewModel.dailyBriefing)
        XCTAssertEqual(briefing.workspaceId, "mock-ws-rcs")
        XCTAssertEqual(briefing.pendingApprovalCount, 1)
        XCTAssertEqual(briefing.activeWorkflowCount, 0)
        XCTAssertEqual(briefing.priorityTasks.count, 2)
        XCTAssertEqual(briefing.recentActivity.count, 2)
    }

    func testLoadPopulatesTaskIntelligenceRankedByPriority() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let intelligence = try! XCTUnwrap(viewModel.taskIntelligence)
        XCTAssertEqual(intelligence.suggestedPriorities.count, 2)
        XCTAssertEqual(intelligence.suggestedPriorities.first?.id, "mock-task-1", "the high-priority seeded task should rank first")
        XCTAssertEqual(intelligence.dueSoon, [], "neither seeded task has a due date")
        XCTAssertEqual(intelligence.overdue, [])
    }

    func testLoadPopulatesWorkspaceInsights() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let insights = try! XCTUnwrap(viewModel.workspaceInsights)
        XCTAssertEqual(insights.activityMetrics.totalActions, 2)
        XCTAssertEqual(insights.approvalMetrics.total, 1)
        XCTAssertEqual(insights.approvalMetrics.pending, 1)
        XCTAssertEqual(insights.taskMetrics.total, 2)
        XCTAssertEqual(insights.taskMetrics.completionRate, 0)
        XCTAssertEqual(insights.workflowMetrics.totalRuns, 0)
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
