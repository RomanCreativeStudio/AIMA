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

    func testLoadPopulatesRecentMemoriesAndOpenCommitmentsOnTheDailyBriefing() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let briefing = try! XCTUnwrap(viewModel.dailyBriefing)
        XCTAssertEqual(briefing.recentMemories.count, 2, "the seeded workspace/user-scope memories surface as recentMemories")
        XCTAssertEqual(briefing.openCommitments, [], "neither seeded memory is source: auto_extracted, so openCommitments stays empty")
    }

    func testLoadPopulatesAcceptedTasksUnresolvedFollowUpsAndRecentDecisions() async {
        let apiClient = MockAPIClient()
        _ = try! await apiClient.createTask(
            workspaceId: "mock-ws-rcs",
            request: CreateTaskRequest(title: "Follow up on the Acme contract", source: "conversation_suggestion", metadata: ["category": .string("follow_up")])
        )
        _ = try! await apiClient.createTask(workspaceId: "mock-ws-rcs", request: CreateTaskRequest(title: "A hand-typed task"))
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let briefing = try! XCTUnwrap(viewModel.dailyBriefing)
        XCTAssertEqual(briefing.acceptedTasks.count, 1)
        XCTAssertEqual(briefing.acceptedTasks[0].title, "Follow up on the Acme contract")
        XCTAssertEqual(briefing.unresolvedFollowUps.count, 1)
        XCTAssertEqual(briefing.recentDecisions, [], "no seeded auto_extracted decision memories in this workspace")
    }

    func testLoadPopulatesCompletedYesterdayBlockedItemsAndPostponedItems() async {
        let apiClient = MockAPIClient()
        let done = try! await apiClient.createTask(workspaceId: "mock-ws-rcs", request: CreateTaskRequest(title: "Ship it"))
        _ = try! await apiClient.updateTask(workspaceId: "mock-ws-rcs", taskId: done.id, request: UpdateTaskRequest(status: .done))
        let blocked = try! await apiClient.createTask(workspaceId: "mock-ws-rcs", request: CreateTaskRequest(title: "Design review"))
        _ = try! await apiClient.updateTask(workspaceId: "mock-ws-rcs", taskId: blocked.id, request: UpdateTaskRequest(metadata: ["category": .string("blocked")]))
        let postponed = try! await apiClient.createTask(workspaceId: "mock-ws-rcs", request: CreateTaskRequest(title: "Launch"))
        _ = try! await apiClient.updateTask(workspaceId: "mock-ws-rcs", taskId: postponed.id, request: UpdateTaskRequest(metadata: ["category": .string("postponed")]))
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        let briefing = try! XCTUnwrap(viewModel.dailyBriefing)
        XCTAssertEqual(briefing.completedYesterday.count, 1)
        XCTAssertEqual(briefing.completedYesterday[0].id, done.id)
        XCTAssertEqual(briefing.blockedItems.count, 1)
        XCTAssertEqual(briefing.blockedItems[0].id, blocked.id)
        XCTAssertEqual(briefing.postponedItems.count, 1)
        XCTAssertEqual(briefing.postponedItems[0].id, postponed.id)
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

    func testLoadPopulatesPatternsAndSuggestions() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        XCTAssertFalse(viewModel.patterns.isEmpty)
        XCTAssertFalse(viewModel.suggestions.isEmpty)
        XCTAssertTrue(viewModel.patterns.allSatisfy { $0.workspaceId == "mock-ws-rcs" })
    }

    func testNudgesSurfacesOnlyOverdueBlockedAndDecisionWithoutFollowUpSuggestions() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-rcs")

        XCTAssertFalse(viewModel.nudges.isEmpty, "sanity check: mock-ws-rcs has seeded nudge suggestions")
        XCTAssertTrue(viewModel.nudges.allSatisfy { suggestion in
            ["missed_deadline_pattern", "blocked_task_stale_pattern", "decision_without_followup_pattern"].contains(suggestion.source)
        })
        XCTAssertTrue(viewModel.nudges.count < viewModel.suggestions.count, "nudges must be a strict subset of every advisory suggestion")
        XCTAssertFalse(viewModel.nudges.contains { $0.source == "frequent_workflow_pattern" })
    }

    func testNudgesIsEmptyWhenNoNudgeSuggestionsArePresent() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)

        await viewModel.load(workspaceId: "mock-ws-personal")

        XCTAssertTrue(viewModel.nudges.isEmpty)
    }

    // MARK: - Nudge dismissal (Nudge Learning Loop sprint)

    func testDismissRemovesTheNudgeFromSuggestionsAndNudges() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        let nudge = try! XCTUnwrap(viewModel.nudges.first)

        await viewModel.dismiss(nudge, workspaceId: "mock-ws-rcs")

        XCTAssertFalse(viewModel.suggestions.contains { $0.id == nudge.id })
        XCTAssertFalse(viewModel.nudges.contains { $0.id == nudge.id })
        XCTAssertNil(viewModel.errorMessage)
    }

    func testDismissedNudgeDoesNotReappearOnReload() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        let nudge = try! XCTUnwrap(viewModel.nudges.first)

        await viewModel.dismiss(nudge, workspaceId: "mock-ws-rcs")
        await viewModel.load(workspaceId: "mock-ws-rcs")

        XCTAssertFalse(viewModel.suggestions.contains { $0.id == nudge.id }, "a dismissed nudge must stay suppressed after a fresh load")
    }

    func testDismissRestoresTheSuggestionAndSetsAnErrorMessageWhenTheAPICallFails() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        let nudge = try! XCTUnwrap(viewModel.nudges.first)
        await apiClient.setShouldFail(true)

        await viewModel.dismiss(nudge, workspaceId: "mock-ws-rcs")

        XCTAssertTrue(viewModel.suggestions.contains { $0.id == nudge.id }, "a failed dismissal must restore the optimistically-removed suggestion")
        XCTAssertNotNil(viewModel.errorMessage)
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

    // MARK: - Workspace scoping (Proactive Intelligence Experience sprint)

    func testLoadingADifferentWorkspaceReplacesPatternsAndSuggestionsRatherThanLeavingStaleOnes() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        XCTAssertFalse(viewModel.patterns.isEmpty, "sanity check: mock-ws-rcs has seeded patterns")
        XCTAssertFalse(viewModel.suggestions.isEmpty, "sanity check: mock-ws-rcs has seeded suggestions")

        await viewModel.load(workspaceId: "mock-ws-personal")

        XCTAssertTrue(viewModel.patterns.isEmpty, "a pattern detected in one workspace must never leak into another's dashboard")
        XCTAssertTrue(viewModel.suggestions.isEmpty, "a suggestion generated in one workspace must never leak into another's dashboard")
        XCTAssertEqual(viewModel.workspace?.id, "mock-ws-personal")
    }

    func testLoadingADifferentWorkspaceReplacesPendingApprovalsRatherThanLeavingStaleOnes() async {
        let apiClient = MockAPIClient()
        let viewModel = DashboardViewModel(apiClient: apiClient)
        await viewModel.load(workspaceId: "mock-ws-rcs")
        XCTAssertFalse(viewModel.pendingApprovals.isEmpty, "sanity check: mock-ws-rcs has a seeded pending approval")

        await viewModel.load(workspaceId: "mock-ws-personal")

        XCTAssertTrue(viewModel.pendingApprovals.isEmpty, "an approval pending in one workspace must never leak into another's dashboard")
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
