import XCTest
@testable import AIMACore

/// Covers `ExecutionsViewModel` against `MockAPIClient`'s reimplementation of
/// `ExecutionService`'s state machine (Phase 2.6, item 9): success,
/// validation failure, approval required, approval denied, provider
/// failure, idempotent retry, and workspace isolation.
@MainActor
final class ExecutionsViewModelTests: XCTestCase {
    /// `mock-ws-rcs` has GitHub connected (not Gmail) in `MockAPIClient`'s seed data.
    private let connectedActionType = "create_github_issue"
    private let connectedPayload: [String: JSONValue] = ["repository": .string("romancreativestudio/aima"), "title": .string("Bug")]

    func testRequestPreviewReturnsProviderTierAndConnectionStatus() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)

        let preview = try XCTUnwrap(viewModel.pendingPreview)
        XCTAssertEqual(preview.provider, .github)
        XCTAssertTrue(preview.requiresApproval, "every built-in execution action type is Tier 3")
        XCTAssertTrue(preview.integrationConnected)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testRequestPreviewForUnsupportedActionTypeSurfacesAnErrorAndSetsNoPreview() async {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.requestPreview(actionType: "delete_everything", payload: [:])

        XCTAssertNil(viewModel.pendingPreview)
        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testConfirmPendingPreviewCreatesAnAwaitingApprovalExecutionAndAddsItToHistory() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)

        await viewModel.confirmPendingPreview()

        let selected = try XCTUnwrap(viewModel.selectedExecution)
        XCTAssertEqual(selected.status, .awaitingApproval, "every built-in execution action type is Tier 3 — nothing auto-executes")
        XCTAssertEqual(selected.actionType, connectedActionType)
        XCTAssertNil(viewModel.pendingPreview, "confirming clears the pending preview")
        XCTAssertEqual(viewModel.history.first?.id, selected.id)
    }

    func testConfirmPendingPreviewRejectsAnUnconnectedIntegrationBeforeCreatingAnything() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        // Gmail is disconnected in `mock-ws-rcs`'s seed data — a validation-failure-like rejection.
        await viewModel.requestPreview(actionType: "send_email", payload: ["to": .string("client@example.com")])
        let preview = try XCTUnwrap(viewModel.pendingPreview)
        XCTAssertFalse(preview.integrationConnected)

        await viewModel.confirmPendingPreview()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.selectedExecution)
        XCTAssertTrue(viewModel.history.isEmpty, "rejecting before creation must not persist anything")
    }

    func testExecuteSelectedAdvancesOnceApprovalIsGranted() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)
        await viewModel.confirmPendingPreview()
        let approvalId = try XCTUnwrap(viewModel.selectedExecution?.pendingApprovalId)

        // Executing before approval must not silently proceed.
        await viewModel.executeSelected()
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.selectedExecution?.status, .awaitingApproval)

        _ = try await apiClient.approveApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)
        await viewModel.executeSelected()

        XCTAssertEqual(viewModel.selectedExecution?.status, .succeeded)
        XCTAssertNotNil(viewModel.selectedExecution?.responseSummary)
        XCTAssertEqual(viewModel.history.first?.status, .succeeded, "history should reflect the same terminal status")
    }

    func testExecuteSelectedFailsWhenApprovalIsRejected() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)
        await viewModel.confirmPendingPreview()
        let approvalId = try XCTUnwrap(viewModel.selectedExecution?.pendingApprovalId)

        _ = try await apiClient.rejectApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)
        await viewModel.executeSelected()

        XCTAssertEqual(viewModel.selectedExecution?.status, .failed)
        XCTAssertEqual(viewModel.selectedExecution?.errorDetails, "Approval was rejected")
    }

    func testExecuteSelectedFailsWhenTheIntegrationDisconnectsBeforeApproval() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)
        await viewModel.confirmPendingPreview()
        let approvalId = try XCTUnwrap(viewModel.selectedExecution?.pendingApprovalId)
        _ = try await apiClient.approveApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)
        _ = try await apiClient.disconnectIntegration(workspaceId: "mock-ws-rcs", provider: .github)

        await viewModel.executeSelected()

        XCTAssertEqual(viewModel.selectedExecution?.status, .failed, "the provider is re-checked fresh, never trusted from creation time")
        XCTAssertNotNil(viewModel.selectedExecution?.errorDetails)
    }

    func testExecuteSelectedIsIdempotentOnATerminalRecord() async throws {
        let apiClient = MockAPIClient()
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)
        await viewModel.confirmPendingPreview()
        let approvalId = try XCTUnwrap(viewModel.selectedExecution?.pendingApprovalId)
        _ = try await apiClient.approveApproval(workspaceId: "mock-ws-rcs", approvalId: approvalId)

        await viewModel.executeSelected()
        let firstResponseId = try XCTUnwrap(viewModel.selectedExecution?.responseSummary?["issueId"])

        await viewModel.executeSelected()
        let secondResponseId = try XCTUnwrap(viewModel.selectedExecution?.responseSummary?["issueId"])

        XCTAssertEqual(viewModel.selectedExecution?.status, .succeeded)
        XCTAssertEqual(firstResponseId, secondResponseId, "a retry after success must never re-contact the provider")
    }

    func testHistoryIsScopedToItsOwnWorkspace() async throws {
        let apiClient = MockAPIClient()
        let rcsViewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await rcsViewModel.requestPreview(actionType: connectedActionType, payload: connectedPayload)
        await rcsViewModel.confirmPendingPreview()
        XCTAssertEqual(rcsViewModel.history.count, 1)

        let otherViewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-mfs")
        await otherViewModel.loadHistory()

        XCTAssertTrue(otherViewModel.history.isEmpty, "an execution created in one workspace must never appear in another's history")
    }

    func testLoadHistorySurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = ExecutionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.loadHistory()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.history.isEmpty)
    }
}
