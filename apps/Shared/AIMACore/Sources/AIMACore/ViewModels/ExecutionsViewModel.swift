import Foundation
import Observation

/// Backs the Executions screen (Phase 2.6, item 8): execution history, a
/// pending preview awaiting confirmation, the selected execution's detail,
/// and the preview/confirm/execute actions. Scoped to one workspace, like
/// `WorkflowsViewModel`/`TasksViewModel`/`ApprovalsViewModel`/
/// `IntegrationsViewModel`. Uses `@Observable` (not Combine) so this
/// package stays Linux-buildable — see `Package.swift`.
///
/// Mirrors `ExecutionService`'s split between "preview" (pure, read-only,
/// never persisted), "create a request" (persists, evaluates approval, never
/// contacts the provider), and "execute" (advances at most one attempt, and
/// is idempotent on a terminal record) — `confirmExecution` always creates a
/// request first; nothing here ever auto-executes it.
@MainActor
@Observable
public final class ExecutionsViewModel {
    public private(set) var history: [ExecutionRecord] = []
    public private(set) var pendingPreview: ExecutionPreview?
    public private(set) var selectedExecution: ExecutionRecord?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func loadHistory() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            history = try await apiClient.listExecutions(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fetches an `ExecutionPreview` for the confirmation dialog (item 8:
    /// "Execution Preview, Confirmation dialog"). Never persists anything.
    public func requestPreview(actionType: String, payload: [String: JSONValue]) async {
        errorMessage = nil
        do {
            pendingPreview = try await apiClient.previewExecution(workspaceId: workspaceId, actionType: actionType, payload: payload)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func dismissPreview() {
        pendingPreview = nil
    }

    /// Confirms the pending preview: creates a persisted execution request
    /// (never contacts the provider) and selects it, ready for `execute()`.
    public func confirmPendingPreview() async {
        guard let preview = pendingPreview else { return }
        errorMessage = nil
        do {
            let created = try await apiClient.createExecutionRequest(
                workspaceId: workspaceId, actionType: preview.actionType, payload: preview.payload
            )
            history.insert(created, at: 0)
            selectedExecution = created
            pendingPreview = nil
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func selectExecution(_ executionId: String) async {
        errorMessage = nil
        do {
            selectedExecution = try await apiClient.getExecution(workspaceId: workspaceId, executionId: executionId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Advances the selected execution by at most one attempt — idempotent
    /// on a terminal record, so calling this again after success/failure is
    /// safe and just returns the stored result.
    public func executeSelected() async {
        guard let executionId = selectedExecution?.id else { return }
        errorMessage = nil
        do {
            let updated = try await apiClient.executeExecution(workspaceId: workspaceId, executionId: executionId)
            selectedExecution = updated
            if let index = history.firstIndex(where: { $0.id == updated.id }) {
                history[index] = updated
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
