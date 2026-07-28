import Foundation
import Observation

/// Backs the Workflows screen (Phase 2.4, item 5): available workflow
/// definitions, run history, the selected run's step-by-step detail, and
/// the create/execute/pause/resume/cancel actions. Scoped to one
/// workspace, like `TasksViewModel`/`ApprovalsViewModel`/
/// `IntegrationsViewModel`. Uses `@Observable` (not Combine) so this
/// package stays Linux-buildable — see `Package.swift`.
///
/// Mirrors `WorkflowService`'s one-step-at-a-time design
/// (`backend/src/workflows/workflowService.ts`): `executeNextStep` never
/// loops to completion on its own — the UI drives each step, and a
/// Tier 3-gated step surfaces as `awaiting_approval` in `selectedRunDetail`
/// until the corresponding approval is resolved elsewhere (the Approvals
/// screen, or the chat approval card).
@MainActor
@Observable
public final class WorkflowsViewModel {
    public private(set) var definitions: [WorkflowDefinition] = []
    public private(set) var runs: [WorkflowRun] = []
    public private(set) var selectedRunDetail: WorkflowRunDetail?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let definitionsResult = apiClient.listWorkflowDefinitions()
            async let runsResult = apiClient.listWorkflowRuns(workspaceId: workspaceId)
            definitions = try await definitionsResult
            runs = try await runsResult
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func createRun(workflowKey: WorkflowKey, input: [String: String]) async {
        errorMessage = nil
        do {
            let detail = try await apiClient.createWorkflowRun(workspaceId: workspaceId, workflowKey: workflowKey, input: input)
            runs.insert(detail.asRun, at: 0)
            selectedRunDetail = detail
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func selectRun(_ runId: String) async {
        errorMessage = nil
        do {
            selectedRunDetail = try await apiClient.getWorkflowRun(workspaceId: workspaceId, runId: runId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func executeNextStep() async {
        await performRunAction { client, workspaceId, runId in
            try await client.executeWorkflowRunStep(workspaceId: workspaceId, runId: runId)
        }
    }

    public func pause() async {
        await performRunAction { client, workspaceId, runId in
            try await client.pauseWorkflowRun(workspaceId: workspaceId, runId: runId)
        }
    }

    public func resume() async {
        await performRunAction { client, workspaceId, runId in
            try await client.resumeWorkflowRun(workspaceId: workspaceId, runId: runId)
        }
    }

    public func cancel() async {
        await performRunAction { client, workspaceId, runId in
            try await client.cancelWorkflowRun(workspaceId: workspaceId, runId: runId)
        }
    }

    private func performRunAction(
        _ action: (APIClient, String, String) async throws -> WorkflowRunDetail
    ) async {
        guard let runId = selectedRunDetail?.id else { return }
        errorMessage = nil
        do {
            let updated = try await action(apiClient, workspaceId, runId)
            selectedRunDetail = updated
            if let index = runs.firstIndex(where: { $0.id == updated.id }) {
                runs[index] = updated.asRun
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
