import Foundation

/// Everything a view model needs from the backend (Phase 2.1, item 3–4).
/// A protocol — not a concrete class — so views/view models depend on this
/// abstraction, never on `URLSessionAPIClient` directly; `MockAPIClient`
/// implements the same interface for SwiftUI previews and tests, mirroring
/// the provider-abstraction pattern already used throughout `backend/` and
/// `ai-engine/` (`AIProvider`, `EmbeddingProvider`, `IntentClassifier`).
public protocol APIClient: Sendable {
    func getHealth() async throws -> SystemHealth

    func getUser(id: String) async throws -> UserProfile
    func updateUserProfile(id: String, request: UpdateUserProfileRequest) async throws -> UserProfile

    func createWorkspace(_ request: CreateWorkspaceRequest) async throws -> Workspace
    func listWorkspaces(userId: String) async throws -> [Workspace]
    func getWorkspace(id: String) async throws -> Workspace
    func updateWorkspace(id: String, request: UpdateWorkspaceRequest) async throws -> Workspace

    func createConversation(workspaceId: String, title: String?) async throws -> Conversation
    func listConversations(workspaceId: String) async throws -> [Conversation]
    func listMessages(workspaceId: String, conversationId: String, limit: Int?) async throws -> [Message]
    func sendMessage(workspaceId: String, conversationId: String, content: String) async throws -> SendMessageResult

    func listTasks(workspaceId: String, status: TaskStatus?) async throws -> [TaskItem]
    func createTask(workspaceId: String, request: CreateTaskRequest) async throws -> TaskItem
    func updateTask(workspaceId: String, taskId: String, request: UpdateTaskRequest) async throws -> TaskItem
    func deleteTask(workspaceId: String, taskId: String) async throws

    func listApprovals(workspaceId: String, status: ApprovalStatus?) async throws -> [PendingApproval]
    func getApproval(workspaceId: String, approvalId: String) async throws -> PendingApproval
    func approveApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision
    func rejectApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision

    func listPreferences(workspaceId: String, category: PreferenceCategory?) async throws -> [Preference]
    func setPreference(workspaceId: String, request: SetPreferenceRequest) async throws -> Preference

    func listIntegrations(workspaceId: String) async throws -> [WorkspaceIntegration]
    func connectIntegration(workspaceId: String, provider: IntegrationProvider, credentials: [String: String]) async throws -> WorkspaceIntegration
    func disconnectIntegration(workspaceId: String, provider: IntegrationProvider) async throws -> WorkspaceIntegration
    func rotateIntegrationCredentials(workspaceId: String, provider: IntegrationProvider, credentials: [String: String]) async throws -> WorkspaceIntegration
    /// Starts an OAuth 2.0 authorization flow (Phase 2.7) — returns the URL the client should open in the system browser. The connection itself completes server-side once the provider redirects back; the client learns about it only by re-fetching `listIntegrations`.
    func startIntegrationOAuth(workspaceId: String, provider: IntegrationProvider) async throws -> String

    func listWorkflowDefinitions() async throws -> [WorkflowDefinition]
    func listWorkflowRuns(workspaceId: String) async throws -> [WorkflowRun]
    func createWorkflowRun(workspaceId: String, workflowKey: WorkflowKey, input: [String: String]) async throws -> WorkflowRunDetail
    func getWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail
    func executeWorkflowRunStep(workspaceId: String, runId: String) async throws -> WorkflowRunDetail
    func pauseWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail
    func resumeWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail
    func cancelWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail

    func getDailyBriefing(workspaceId: String) async throws -> DailyBriefing
    func getTaskIntelligence(workspaceId: String) async throws -> TaskIntelligence
    func getConversationIntelligence(workspaceId: String, conversationId: String) async throws -> ConversationIntelligence
    func getWorkspaceInsights(workspaceId: String) async throws -> WorkspaceInsights

    func previewExecution(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionPreview
    func createExecutionRequest(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionRecord
    func executeExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord
    func listExecutions(workspaceId: String) async throws -> [ExecutionRecord]
    func getExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord
}
