import XCTest
@testable import AIMACore

@MainActor
final class WorkflowsViewModelTests: XCTestCase {
    func testLoadPopulatesTheFourBuiltInDefinitions() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertEqual(viewModel.definitions.count, 4)
        XCTAssertTrue(viewModel.definitions.contains { $0.key == .dailyWorkspaceBriefing })
        XCTAssertNil(viewModel.errorMessage)
    }

    func testCreateRunSeedsAllStepsAsPendingAndSelectsIt() async throws {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])

        let detail = try XCTUnwrap(viewModel.selectedRunDetail)
        XCTAssertEqual(detail.status, .pending)
        XCTAssertEqual(detail.steps.count, 2)
        XCTAssertTrue(detail.steps.allSatisfy { $0.status == .pending })
        XCTAssertEqual(viewModel.runs.first?.id, detail.id)
    }

    func testExecuteNextStepOnlyAdvancesOneStepAtATime() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])

        await viewModel.executeNextStep()

        XCTAssertEqual(viewModel.selectedRunDetail?.status, .running)
        XCTAssertEqual(viewModel.selectedRunDetail?.currentStepIndex, 1)
        XCTAssertEqual(viewModel.selectedRunDetail?.steps[0].status, .completed)
        XCTAssertEqual(viewModel.selectedRunDetail?.steps[1].status, .pending, "a second internal step must not auto-run in the same call")
    }

    func testExecutingBothStepsOfAnAllInternalWorkflowCompletesTheRun() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])

        await viewModel.executeNextStep()
        await viewModel.executeNextStep()

        XCTAssertEqual(viewModel.selectedRunDetail?.status, .completed)
        XCTAssertNotNil(viewModel.selectedRunDetail?.result)
        XCTAssertEqual(viewModel.runs.first?.status, .completed, "run history should reflect the same terminal status")
    }

    func testTier3GatedStepPausesForApprovalAndNeverInvokesTheHandlerUntilApproved() async throws {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .summarizeUnreadEmail, input: [:])

        await viewModel.executeNextStep()

        XCTAssertEqual(viewModel.selectedRunDetail?.status, .awaitingApproval)
        let gatedStep = try XCTUnwrap(viewModel.selectedRunDetail?.steps[0])
        XCTAssertEqual(gatedStep.status, .awaitingApproval)
        XCTAssertNil(gatedStep.output, "the handler must never run before approval")
        let approvalId = try XCTUnwrap(gatedStep.pendingApprovalId)

        // Resuming before the approval is resolved must not silently proceed.
        await viewModel.resume()
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.selectedRunDetail?.status, .awaitingApproval)

        _ = try await apiClient.approveApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)
        await viewModel.resume()

        XCTAssertEqual(viewModel.selectedRunDetail?.steps[0].status, .completed)
        XCTAssertNotNil(viewModel.selectedRunDetail?.steps[0].output)
        XCTAssertEqual(viewModel.selectedRunDetail?.status, .running)
    }

    func testRejectedApprovalFailsTheStepAndTheRunOnResume() async throws {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .summarizeUnreadEmail, input: [:])
        await viewModel.executeNextStep()
        let approvalId = try XCTUnwrap(viewModel.selectedRunDetail?.steps[0].pendingApprovalId)

        _ = try await apiClient.rejectApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)
        await viewModel.resume()

        XCTAssertEqual(viewModel.selectedRunDetail?.status, .failed)
        XCTAssertEqual(viewModel.selectedRunDetail?.steps[0].status, .failed)
    }

    func testPauseAndResumeARunningRunWithoutTouchingItsSteps() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])
        await viewModel.executeNextStep()

        await viewModel.pause()
        XCTAssertEqual(viewModel.selectedRunDetail?.status, .paused)

        await viewModel.resume()
        XCTAssertEqual(viewModel.selectedRunDetail?.status, .running)
        XCTAssertEqual(viewModel.selectedRunDetail?.currentStepIndex, 1)
    }

    func testCancelMarksTheRunCancelledAndSkipsTheOutstandingStep() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])

        await viewModel.cancel()

        XCTAssertEqual(viewModel.selectedRunDetail?.status, .cancelled)
        XCTAssertEqual(viewModel.selectedRunDetail?.steps[0].status, .skipped)
    }

    func testCancellingAnAlreadyCompletedRunSurfacesAnError() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])
        await viewModel.executeNextStep()
        await viewModel.executeNextStep()
        precondition(viewModel.selectedRunDetail?.status == .completed)

        await viewModel.cancel()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.selectedRunDetail?.status, .completed, "a rejected cancel must not change the run's terminal status")
    }

    func testSelectRunLoadsAPreviouslyCreatedRunByID() async {
        let apiClient = MockAPIClient()
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        await viewModel.createRun(workflowKey: .createGithubIssueDraft, input: ["title": "Bug in login"])
        let runId = try! XCTUnwrap(viewModel.selectedRunDetail?.id)

        let otherViewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await otherViewModel.selectRun(runId)

        XCTAssertEqual(otherViewModel.selectedRunDetail?.id, runId)
        XCTAssertEqual(otherViewModel.selectedRunDetail?.input["title"], "Bug in login")
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = WorkflowsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.definitions.isEmpty)
    }
}
