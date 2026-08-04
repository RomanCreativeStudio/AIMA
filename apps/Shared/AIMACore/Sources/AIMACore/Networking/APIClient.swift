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

    /// Requires an explicit call — there is no automatic or background session creation (Phase 3.2).
    func startVoiceSession(workspaceId: String) async throws -> VoiceSession
    func endVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession
    func listVoiceSessions(workspaceId: String) async throws -> [VoiceSession]
    func getVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession
    /// Audio in, audio out — `audioData` is never persisted server-side, only its transcript and the reply's text.
    func submitVoiceRequest(
        workspaceId: String,
        voiceSessionId: String,
        audioData: Data,
        audioMimeType: String,
        configuration: VoiceConfiguration?
    ) async throws -> VoiceResponse
    func listVoiceTurns(workspaceId: String, voiceSessionId: String) async throws -> [VoiceTurn]

    func listMemories(workspaceId: String, scope: MemoryScope?, memoryType: MemoryType?, includeArchived: Bool) async throws -> [MemoryRecord]
    func searchMemories(workspaceId: String, query: String, scope: MemoryScope?, limit: Int?) async throws -> [RankedMemoryResult]
    func createMemory(workspaceId: String, request: CreateMemoryRequest) async throws -> MemoryRecord
    func updateMemory(workspaceId: String, memoryId: String, request: UpdateMemoryRequest) async throws -> MemoryRecord
    func archiveMemory(workspaceId: String, memoryId: String) async throws -> MemoryRecord
    func deleteMemory(workspaceId: String, memoryId: String) async throws

    func getProactivePatterns(workspaceId: String) async throws -> [Pattern]
    func getProactiveSuggestions(workspaceId: String) async throws -> [Suggestion]

    /// Manual semantic search across a workspace's indexed content (Phase 3.6) — never triggered automatically.
    func searchSemantic(workspaceId: String, query: String, sourceTypes: [EmbeddingSourceType]?, limit: Int?) async throws -> [SearchResult]
    /// Merged memories/conversations/tasks for a query — the same read `ConversationService.sendMessage` computes
    /// advisorily server-side, exposed here for a manual "why did it retrieve this" view.
    func getRetrievedContext(
        workspaceId: String,
        query: String,
        conversationId: String?,
        memoryLimit: Int?,
        embeddingLimit: Int?
    ) async throws -> RetrievedContext
    /// Re-chunks and re-embeds a workspace's conversations/tasks — requires an explicit call (a reindex button),
    /// never run automatically or in the background.
    func reindexEmbeddings(workspaceId: String) async throws -> ReindexWorkspaceResult

    /// Beta Tester Infrastructure sprint: submit/list feedback, bug reports, and feature requests.
    func submitFeedback(workspaceId: String, request: CreateFeedbackRequest) async throws -> Feedback
    func listFeedback(workspaceId: String) async throws -> [Feedback]

    /// Internal Operator Dashboard sprint: the founder/admin-only surface — the backend 403s any caller not
    /// on its `ADMIN_USER_IDS` allowlist, or 404s (route not mounted) if no admin is configured at all.
    /// `query`, if given, filters case-insensitively by email/displayName (Beta Tester Management sprint).
    func listBetaUsers(query: String?) async throws -> [AdminBetaUserSummary]
    func listAdminFeedback(limit: Int?) async throws -> [AdminFeedbackEntry]
    /// Feedback Triage Workflow sprint: advances a submission one step along new -> reviewed -> resolved.
    /// The backend rejects any other transition with a 409, and an unknown `feedbackId` with a 404.
    func updateFeedbackStatus(feedbackId: String, status: FeedbackStatus) async throws -> AdminFeedbackEntry

    /// Beta Tester Management sprint: every account, not just current beta testers — the view used to find a
    /// candidate to promote/demote or annotate. `query`, if given, filters case-insensitively by
    /// email/displayName.
    func listAllUsers(query: String?) async throws -> [AdminUserSummary]
    /// Toggles `betaTester` and/or records `adminNotes`/`adminTags` — any subset of the three, matching
    /// `UpdateBetaTesterRequest`'s optional fields.
    func updateBetaTesterStatus(userId: String, request: UpdateBetaTesterRequest) async throws -> AdminUserSummary

    /// Founder Analytics Dashboard sprint: platform-wide totals for the founder dashboard's metric cards.
    func fetchAdminAnalytics() async throws -> AdminAnalytics

    /// Beta Invitations & Notifications sprint: founder-issued invites to prospective beta testers. The
    /// backend rejects an email already belonging to an active beta tester with a 409
    /// (`UserAlreadyBetaTesterError`).
    func createInvitation(email: String) async throws -> Invitation
    /// Every invitation ever issued, newest first — platform-wide, not scoped to any one workspace.
    func listInvitations() async throws -> [Invitation]
}
