import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The real `APIClient` — talks to the AIMA backend over HTTP. Timestamps
/// are decoded as plain `String` (the backend already sends ISO 8601 text,
/// see every `*Service`'s `toIso` helper) rather than `Date`, so no custom
/// `JSONDecoder.dateDecodingStrategy` is needed; a view formats them for
/// display only where it matters.
public final class URLSessionAPIClient: APIClient, @unchecked Sendable {
    private let configuration: APIConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: APIConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Health

    public func getHealth() async throws -> SystemHealth {
        try await send("GET", "/health")
    }

    // MARK: - Users

    public func getUser(id: String) async throws -> UserProfile {
        try await send("GET", "/api/users/\(id)", envelope: UserEnvelope.self).user
    }

    public func updateUserProfile(id: String, request: UpdateUserProfileRequest) async throws -> UserProfile {
        try await send("PATCH", "/api/users/\(id)", body: request, envelope: UserEnvelope.self).user
    }

    // MARK: - Workspaces

    public func createWorkspace(_ request: CreateWorkspaceRequest) async throws -> Workspace {
        try await send("POST", "/api/workspaces", body: request, envelope: WorkspaceEnvelope.self).workspace
    }

    public func listWorkspaces(userId: String) async throws -> [Workspace] {
        try await send("GET", "/api/users/\(userId)/workspaces", envelope: WorkspacesEnvelope.self).workspaces
    }

    public func getWorkspace(id: String) async throws -> Workspace {
        try await send("GET", "/api/workspaces/\(id)", envelope: WorkspaceEnvelope.self).workspace
    }

    public func updateWorkspace(id: String, request: UpdateWorkspaceRequest) async throws -> Workspace {
        try await send("PATCH", "/api/workspaces/\(id)", body: request, envelope: WorkspaceEnvelope.self).workspace
    }

    // MARK: - Conversations

    public func createConversation(workspaceId: String, title: String?) async throws -> Conversation {
        struct Body: Encodable { let title: String? }
        return try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/conversations",
            body: Body(title: title),
            envelope: ConversationEnvelope.self
        ).conversation
    }

    public func listConversations(workspaceId: String) async throws -> [Conversation] {
        try await send("GET", "/api/workspaces/\(workspaceId)/conversations", envelope: ConversationsEnvelope.self).conversations
    }

    public func listMessages(workspaceId: String, conversationId: String, limit: Int?) async throws -> [Message] {
        var query: [String: String] = [:]
        if let limit { query["limit"] = String(limit) }
        return try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/conversations/\(conversationId)/messages",
            query: query,
            envelope: MessagesEnvelope.self
        ).messages
    }

    public func sendMessage(workspaceId: String, conversationId: String, content: String) async throws -> SendMessageResult {
        struct Body: Encodable { let content: String }
        return try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/conversations/\(conversationId)/messages",
            body: Body(content: content)
        )
    }

    // MARK: - Tasks

    public func listTasks(workspaceId: String, status: TaskStatus?) async throws -> [TaskItem] {
        var query: [String: String] = [:]
        if let status { query["status"] = status.rawValue }
        return try await send("GET", "/api/workspaces/\(workspaceId)/tasks", query: query, envelope: TasksEnvelope.self).tasks
    }

    public func createTask(workspaceId: String, request: CreateTaskRequest) async throws -> TaskItem {
        try await send("POST", "/api/workspaces/\(workspaceId)/tasks", body: request, envelope: TaskEnvelope.self).task
    }

    public func updateTask(workspaceId: String, taskId: String, request: UpdateTaskRequest) async throws -> TaskItem {
        try await send(
            "PATCH",
            "/api/workspaces/\(workspaceId)/tasks/\(taskId)",
            body: request,
            envelope: TaskEnvelope.self
        ).task
    }

    public func deleteTask(workspaceId: String, taskId: String) async throws {
        _ = try await send("DELETE", "/api/workspaces/\(workspaceId)/tasks/\(taskId)") as DeletedEnvelope
    }

    // MARK: - Approvals

    public func listApprovals(workspaceId: String, status: ApprovalStatus?) async throws -> [PendingApproval] {
        var query: [String: String] = [:]
        if let status { query["status"] = status.rawValue }
        return try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/approvals",
            query: query,
            envelope: ApprovalsEnvelope.self
        ).approvals
    }

    public func getApproval(workspaceId: String, approvalId: String) async throws -> PendingApproval {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/approvals/\(approvalId)",
            envelope: ApprovalEnvelope.self
        ).approval
    }

    public func approveApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/approvals/\(approvalId)/approve",
            envelope: DecisionEnvelope.self
        ).decision
    }

    public func rejectApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/approvals/\(approvalId)/reject",
            envelope: DecisionEnvelope.self
        ).decision
    }

    // MARK: - Preferences

    public func listPreferences(workspaceId: String, category: PreferenceCategory?) async throws -> [Preference] {
        var query: [String: String] = [:]
        if let category { query["category"] = category.rawValue }
        return try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/preferences",
            query: query,
            envelope: PreferencesEnvelope.self
        ).preferences
    }

    public func setPreference(workspaceId: String, request: SetPreferenceRequest) async throws -> Preference {
        try await send(
            "PUT",
            "/api/workspaces/\(workspaceId)/preferences",
            body: request,
            envelope: PreferenceEnvelope.self
        ).preference
    }

    // MARK: - Integrations

    public func listIntegrations(workspaceId: String) async throws -> [WorkspaceIntegration] {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/integrations",
            envelope: IntegrationsEnvelope.self
        ).integrations
    }

    public func connectIntegration(
        workspaceId: String,
        provider: IntegrationProvider,
        credentials: [String: String]
    ) async throws -> WorkspaceIntegration {
        struct Body: Encodable { let credentials: [String: String] }
        return try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/integrations/\(provider.rawValue)/connect",
            body: Body(credentials: credentials),
            envelope: IntegrationEnvelope.self
        ).integration
    }

    public func disconnectIntegration(workspaceId: String, provider: IntegrationProvider) async throws -> WorkspaceIntegration {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/integrations/\(provider.rawValue)/disconnect",
            envelope: IntegrationEnvelope.self
        ).integration
    }

    public func rotateIntegrationCredentials(
        workspaceId: String,
        provider: IntegrationProvider,
        credentials: [String: String]
    ) async throws -> WorkspaceIntegration {
        struct Body: Encodable { let credentials: [String: String] }
        return try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/integrations/\(provider.rawValue)/rotate",
            body: Body(credentials: credentials),
            envelope: IntegrationEnvelope.self
        ).integration
    }

    public func startIntegrationOAuth(workspaceId: String, provider: IntegrationProvider) async throws -> String {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/integrations/\(provider.rawValue)/oauth/start",
            envelope: OAuthAuthorizationEnvelope.self
        ).authorizationUrl
    }

    // MARK: - Workflows

    public func listWorkflowDefinitions() async throws -> [WorkflowDefinition] {
        try await send("GET", "/api/workflows", envelope: WorkflowDefinitionsEnvelope.self).workflows
    }

    public func listWorkflowRuns(workspaceId: String) async throws -> [WorkflowRun] {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/workflow-runs",
            envelope: WorkflowRunsEnvelope.self
        ).runs
    }

    public func createWorkflowRun(
        workspaceId: String,
        workflowKey: WorkflowKey,
        input: [String: String]
    ) async throws -> WorkflowRunDetail {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/workflow-runs",
            body: CreateWorkflowRunRequest(workflowKey: workflowKey, input: input),
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    public func getWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/workflow-runs/\(runId)",
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    public func executeWorkflowRunStep(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/workflow-runs/\(runId)/execute",
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    public func pauseWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/workflow-runs/\(runId)/pause",
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    public func resumeWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/workflow-runs/\(runId)/resume",
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    public func cancelWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/workflow-runs/\(runId)/cancel",
            envelope: WorkflowRunEnvelope.self
        ).run
    }

    // MARK: - Productivity Intelligence

    public func getDailyBriefing(workspaceId: String) async throws -> DailyBriefing {
        try await send("GET", "/api/workspaces/\(workspaceId)/briefing", envelope: BriefingEnvelope.self).briefing
    }

    public func getTaskIntelligence(workspaceId: String) async throws -> TaskIntelligence {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/task-intelligence",
            envelope: TaskIntelligenceEnvelope.self
        ).taskIntelligence
    }

    public func getConversationIntelligence(workspaceId: String, conversationId: String) async throws -> ConversationIntelligence {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/conversations/\(conversationId)/intelligence",
            envelope: ConversationIntelligenceEnvelope.self
        ).conversationIntelligence
    }

    public func getWorkspaceInsights(workspaceId: String) async throws -> WorkspaceInsights {
        try await send("GET", "/api/workspaces/\(workspaceId)/insights", envelope: WorkspaceInsightsEnvelope.self).insights
    }

    // MARK: - Action Execution

    public func previewExecution(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionPreview {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/executions/preview",
            body: CreateExecutionRequest(actionType: actionType, payload: payload),
            envelope: ExecutionPreviewEnvelope.self
        ).preview
    }

    public func createExecutionRequest(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionRecord {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/executions",
            body: CreateExecutionRequest(actionType: actionType, payload: payload),
            envelope: ExecutionEnvelope.self
        ).execution
    }

    public func executeExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/executions/\(executionId)/execute",
            envelope: ExecutionEnvelope.self
        ).execution
    }

    public func listExecutions(workspaceId: String) async throws -> [ExecutionRecord] {
        try await send("GET", "/api/workspaces/\(workspaceId)/executions", envelope: ExecutionsEnvelope.self).executions
    }

    public func getExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/executions/\(executionId)",
            envelope: ExecutionEnvelope.self
        ).execution
    }

    public func startVoiceSession(workspaceId: String) async throws -> VoiceSession {
        try await send("POST", "/api/workspaces/\(workspaceId)/voice/sessions", envelope: VoiceSessionEnvelope.self).session
    }

    public func endVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/voice/sessions/\(voiceSessionId)/end",
            envelope: VoiceSessionEnvelope.self
        ).session
    }

    public func listVoiceSessions(workspaceId: String) async throws -> [VoiceSession] {
        try await send("GET", "/api/workspaces/\(workspaceId)/voice/sessions", envelope: VoiceSessionsEnvelope.self).sessions
    }

    public func getVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession {
        try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/voice/sessions/\(voiceSessionId)",
            envelope: VoiceSessionEnvelope.self
        ).session
    }

    public func submitVoiceRequest(
        workspaceId: String,
        voiceSessionId: String,
        audioData: Data,
        audioMimeType: String,
        configuration: VoiceConfiguration?
    ) async throws -> VoiceResponse {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/voice/sessions/\(voiceSessionId)/turns",
            body: SubmitVoiceRequest(audioBase64: audioData.base64EncodedString(), audioMimeType: audioMimeType, configuration: configuration)
        )
    }

    public func listVoiceTurns(workspaceId: String, voiceSessionId: String) async throws -> [VoiceTurn] {
        try await send("GET", "/api/workspaces/\(workspaceId)/voice/sessions/\(voiceSessionId)/turns", envelope: VoiceTurnsEnvelope.self).turns
    }

    public func listMemories(
        workspaceId: String,
        scope: MemoryScope?,
        memoryType: MemoryType?,
        includeArchived: Bool
    ) async throws -> [MemoryRecord] {
        var query: [String: String] = [:]
        if let scope { query["scope"] = scope.rawValue }
        if let memoryType { query["memoryType"] = memoryType.rawValue }
        if includeArchived { query["includeArchived"] = "true" }
        return try await send("GET", "/api/workspaces/\(workspaceId)/memories", query: query, envelope: MemoriesEnvelope.self).memories
    }

    public func searchMemories(workspaceId: String, query: String, scope: MemoryScope?, limit: Int?) async throws -> [RankedMemoryResult] {
        var params: [String: String] = ["q": query]
        if let scope { params["scope"] = scope.rawValue }
        if let limit { params["limit"] = String(limit) }
        return try await send(
            "GET",
            "/api/workspaces/\(workspaceId)/memories/search",
            query: params,
            envelope: MemorySearchResultsEnvelope.self
        ).results
    }

    public func createMemory(workspaceId: String, request: CreateMemoryRequest) async throws -> MemoryRecord {
        try await send("POST", "/api/workspaces/\(workspaceId)/memories", body: request, envelope: MemoryEnvelope.self).memory
    }

    public func updateMemory(workspaceId: String, memoryId: String, request: UpdateMemoryRequest) async throws -> MemoryRecord {
        try await send(
            "PATCH",
            "/api/workspaces/\(workspaceId)/memories/\(memoryId)",
            body: request,
            envelope: MemoryEnvelope.self
        ).memory
    }

    public func archiveMemory(workspaceId: String, memoryId: String) async throws -> MemoryRecord {
        try await send(
            "POST",
            "/api/workspaces/\(workspaceId)/memories/\(memoryId)/archive",
            envelope: MemoryEnvelope.self
        ).memory
    }

    public func deleteMemory(workspaceId: String, memoryId: String) async throws {
        _ = try await send("DELETE", "/api/workspaces/\(workspaceId)/memories/\(memoryId)") as DeletedEnvelope
    }

    // MARK: - Core request plumbing

    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: Encodable? = nil
    ) async throws -> Response {
        try await send(method, path, query: query, body: body, envelope: Response.self)
    }

    /// `envelope` exists purely to pin the generic `Response` type at call
    /// sites that want `T.self` directly (e.g. `SendMessageResult`, which
    /// the backend returns unwrapped) versus a small envelope struct (e.g.
    /// `{ "user": UserProfile }`) that most other routes use.
    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: Encodable? = nil,
        envelope: Response.Type
    ) async throws -> Response {
        guard var components = URLComponents(url: configuration.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url, timeoutInterval: configuration.requestTimeout)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try encoder.encode(AnyEncodable(body))
            } catch {
                throw APIError.decoding(error.localizedDescription)
            }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.network("No HTTP response received")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = try? decoder.decode(ErrorEnvelope.self, from: data).error
            throw APIError.server(statusCode: httpResponse.statusCode, message: message)
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }
}

/// Type-erases an `Encodable` body so `send` can accept any request struct without becoming generic over the request type too.
private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        self.encodeClosure = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

// MARK: - Response envelopes (matching each route's exact JSON shape)

private struct ErrorEnvelope: Decodable { let error: String }
private struct UserEnvelope: Decodable { let user: UserProfile }
private struct WorkspaceEnvelope: Decodable { let workspace: Workspace }
private struct WorkspacesEnvelope: Decodable { let workspaces: [Workspace] }
private struct ConversationEnvelope: Decodable { let conversation: Conversation }
private struct ConversationsEnvelope: Decodable { let conversations: [Conversation] }
private struct MessagesEnvelope: Decodable { let messages: [Message] }
private struct TaskEnvelope: Decodable { let task: TaskItem }
private struct TasksEnvelope: Decodable { let tasks: [TaskItem] }
private struct ApprovalsEnvelope: Decodable { let approvals: [PendingApproval] }
private struct ApprovalEnvelope: Decodable { let approval: PendingApproval }
private struct DecisionEnvelope: Decodable { let decision: ApprovalDecision }
private struct PreferenceEnvelope: Decodable { let preference: Preference }
private struct PreferencesEnvelope: Decodable { let preferences: [Preference] }
private struct DeletedEnvelope: Decodable { let deleted: Bool }
private struct IntegrationsEnvelope: Decodable { let integrations: [WorkspaceIntegration] }
private struct IntegrationEnvelope: Decodable { let integration: WorkspaceIntegration }
private struct OAuthAuthorizationEnvelope: Decodable { let authorizationUrl: String }
private struct WorkflowDefinitionsEnvelope: Decodable { let workflows: [WorkflowDefinition] }
private struct WorkflowRunsEnvelope: Decodable { let runs: [WorkflowRun] }
private struct WorkflowRunEnvelope: Decodable { let run: WorkflowRunDetail }
private struct BriefingEnvelope: Decodable { let briefing: DailyBriefing }
private struct TaskIntelligenceEnvelope: Decodable { let taskIntelligence: TaskIntelligence }
private struct ConversationIntelligenceEnvelope: Decodable { let conversationIntelligence: ConversationIntelligence }
private struct WorkspaceInsightsEnvelope: Decodable { let insights: WorkspaceInsights }
private struct ExecutionPreviewEnvelope: Decodable { let preview: ExecutionPreview }
private struct ExecutionEnvelope: Decodable { let execution: ExecutionRecord }
private struct ExecutionsEnvelope: Decodable { let executions: [ExecutionRecord] }
private struct VoiceSessionEnvelope: Decodable { let session: VoiceSession }
private struct VoiceSessionsEnvelope: Decodable { let sessions: [VoiceSession] }
private struct VoiceTurnsEnvelope: Decodable { let turns: [VoiceTurn] }
private struct MemoryEnvelope: Decodable { let memory: MemoryRecord }
private struct MemoriesEnvelope: Decodable { let memories: [MemoryRecord] }
private struct MemorySearchResultsEnvelope: Decodable { let results: [RankedMemoryResult] }
