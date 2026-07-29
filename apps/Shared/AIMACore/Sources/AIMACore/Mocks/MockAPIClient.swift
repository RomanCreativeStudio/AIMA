import Foundation

/// An in-memory `APIClient` seeded with sample data across all four fixed
/// workspaces — used by SwiftUI previews (no backend required to render a
/// view) and by `AIMACoreTests`'s ViewModel tests. An `actor` so its mutable
/// in-memory state is safe to call from Swift concurrency without extra
/// locking, mirroring how `ai-engine`'s `MockProvider`/`MockEmbeddingProvider`
/// stand in for a real provider in backend tests.
public actor MockAPIClient: APIClient {
    public var shouldFail = false
    public var artificialDelayNanoseconds: UInt64 = 0

    /// Actor-isolated mutation entry point for tests — Swift's actor isolation
    /// doesn't allow `await client.shouldFail = true` from outside the actor.
    public func setShouldFail(_ value: Bool) {
        shouldFail = value
    }

    private var user: UserProfile
    private var workspaces: [Workspace]
    private var conversations: [Conversation]
    private var messagesByConversation: [String: [Message]]
    private var tasksByWorkspace: [String: [TaskItem]]
    private var approvalsByWorkspace: [String: [PendingApproval]]
    private var preferencesByWorkspace: [String: [Preference]]
    private var integrationsByWorkspace: [String: [WorkspaceIntegration]]
    private var workflowRunsByWorkspace: [String: [WorkflowRunDetail]] = [:]
    private var executionsByWorkspace: [String: [ExecutionRecord]] = [:]
    private var voiceSessionsByWorkspace: [String: [VoiceSession]] = [:]
    private var voiceTurnsBySession: [String: [VoiceTurn]] = [:]
    private var memoriesByWorkspace: [String: [MemoryRecord]] = [:]
    /// Set by `forceNextVoiceRequestToFailWithProviderError`, consumed by the
    /// next `submitVoiceRequest` call — simulates the backend's
    /// `VoiceProviderError` (HTTP 502) without needing a real vendor outage
    /// (Phase 3.3).
    private var forcedNextVoiceProviderFailure = false
    /// Phase 2.5's "recent activity" source — `MockAPIClient` has no write-side `ActionLogger` equivalent, so this
    /// is seeded fixed data rather than something `createTask`/etc. append to.
    private var actionLogByWorkspace: [String: [ActionLogRecord]]

    /// Set by `forceNextMessageToRequireApproval`, consumed by the next
    /// `sendMessage` call — lets tests exercise the Chat screen's approval
    /// card (Phase 2.2) without a real Tier 3 capability being promoted yet
    /// (`backend/README.md`'s "what's intentionally not built yet").
    private var forcedNextApprovalId: String?

    /// Set by `forceNextMessageToSuggestWorkflow`, consumed by the next
    /// `sendMessage` call — lets tests/previews exercise the Chat screen's
    /// workflow-suggestion card (Phase 2.4) without needing to type one of
    /// `WorkflowIntentMatcher`'s exact trigger phrases.
    private var forcedNextWorkflowSuggestion: WorkflowSuggestion?

    /// Set by `forceNextMessageToSuggestExecution`, consumed by the next
    /// `sendMessage` call — lets tests/previews exercise the Chat screen's
    /// execution-suggestion card (Phase 2.6) without needing to type one of
    /// `ExecutionIntentMatcher`'s exact trigger phrases.
    private var forcedNextExecutionSuggestion: ExecutionSuggestion?

    /// Mirrors `backend/src/permissions/registry.ts`: all four built-in execution action types are permanently
    /// tier-locked at Tier 3 (`execute_with_approval`) — none of them auto-execute.
    private static let executionTier = "execute_with_approval"

    /// Mirrors `backend/src/execution/registry.ts`'s seeded executors — which provider handles each action type.
    private static let executionActionProviders: [String: IntegrationProvider] = [
        "send_email": .gmail,
        "draft_gmail_email": .gmail,
        "create_github_issue": .github,
        "create_github_pull_request": .github,
    ]

    /// Mirrors `backend/src/workflows/registry.ts#DEFAULT_WORKFLOWS` — the
    /// four built-in workflow definitions `GET /api/workflows` returns.
    private static let workflowDefinitions: [WorkflowDefinition] = [
        WorkflowDefinition(
            key: .draftEmailReply,
            displayName: "Draft Email Reply",
            description: "Compose a reply and save it to the local draft queue for review. Never sends anything.",
            steps: [
                WorkflowStepDefinition(key: "compose_reply", displayName: "Compose reply", capability: nil),
                WorkflowStepDefinition(key: "save_draft", displayName: "Save as email draft", capability: "draft_email"),
            ],
            triggerPhrases: ["draft a reply", "draft an email reply", "reply to"]
        ),
        WorkflowDefinition(
            key: .createGithubIssueDraft,
            displayName: "Create GitHub Issue Draft",
            description: "Compose a GitHub issue title and body and save it to the local draft queue. Never creates anything on GitHub — the read-only GitHub integration has no write capability, by design.",
            steps: [
                WorkflowStepDefinition(key: "compose_issue", displayName: "Compose issue", capability: nil),
                WorkflowStepDefinition(key: "save_draft", displayName: "Save as GitHub issue draft", capability: "draft_github_issue"),
            ],
            triggerPhrases: ["create a github issue", "draft a github issue", "file an issue"]
        ),
        WorkflowDefinition(
            key: .summarizeUnreadEmail,
            displayName: "Summarize Unread Email",
            description: "Read recent messages from a connected Gmail integration and summarize them — the read step requires your approval.",
            steps: [
                WorkflowStepDefinition(key: "read_unread_email", displayName: "Read unread email", capability: "read_email"),
                WorkflowStepDefinition(key: "summarize", displayName: "Summarize messages", capability: nil),
            ],
            triggerPhrases: ["summarize my unread email", "summarize unread email", "summarize my inbox"]
        ),
        WorkflowDefinition(
            key: .dailyWorkspaceBriefing,
            displayName: "Daily Workspace Briefing",
            description: "Gather this workspace's tasks, pending approvals, and system status into a short daily briefing. Entirely internal — nothing to approve.",
            steps: [
                WorkflowStepDefinition(key: "gather_snapshot", displayName: "Gather workspace snapshot", capability: nil),
                WorkflowStepDefinition(key: "compose_briefing", displayName: "Compose briefing", capability: nil),
            ],
            triggerPhrases: ["daily briefing", "workspace briefing", "give me my briefing"]
        ),
    ]

    public init() {
        let now = ISO8601DateFormatter().string(from: Date())
        let userId = "mock-user"

        let personal = Workspace(
            id: "mock-ws-personal", userId: userId, slug: .personal, name: "Personal",
            type: .personal, instructions: nil, assistantBehavior: [:], metadata: [:],
            createdAt: now, updatedAt: now
        )
        let rcs = Workspace(
            id: "mock-ws-rcs", userId: userId, slug: .rcs, name: "Roman Creative Studio",
            type: .business, instructions: "Treat client communication as a draft needing approval.",
            assistantBehavior: ["tone": .string("formal")], metadata: [:],
            createdAt: now, updatedAt: now
        )
        let mfs = Workspace(
            id: "mock-ws-mfs", userId: userId, slug: .mfs, name: "Mythic Forge Studios",
            type: .creative, instructions: nil, assistantBehavior: [:], metadata: [:],
            createdAt: now, updatedAt: now
        )
        let development = Workspace(
            id: "mock-ws-development", userId: userId, slug: .development, name: "Development",
            type: .development, instructions: nil, assistantBehavior: [:], metadata: [:],
            createdAt: now, updatedAt: now
        )
        self.workspaces = [personal, rcs, mfs, development]

        self.user = UserProfile(
            id: userId, email: "you@example.com", displayName: "Roman",
            preferences: [:], communicationStyle: "direct and concise",
            defaultWorkspaceId: rcs.id, createdAt: now, updatedAt: now
        )

        let conversation = Conversation(id: "mock-conv-1", workspaceId: rcs.id, title: "Acme follow-up", createdAt: now, updatedAt: now)
        self.conversations = [conversation]
        self.messagesByConversation = [
            conversation.id: [
                Message(id: "mock-msg-1", conversationId: conversation.id, workspaceId: rcs.id, role: .user, content: "What should I tell Acme about the timeline?", createdAt: now),
                Message(id: "mock-msg-2", conversationId: conversation.id, workspaceId: rcs.id, role: .assistant, content: "I'd suggest confirming the revised delivery date before promising anything further.", createdAt: now),
            ],
        ]

        self.tasksByWorkspace = [
            rcs.id: [
                TaskItem(id: "mock-task-1", workspaceId: rcs.id, title: "Send Acme proposal", description: nil, status: .todo, priority: .high, dueDate: nil, createdAt: now, updatedAt: now),
                TaskItem(id: "mock-task-2", workspaceId: rcs.id, title: "Review contract terms", description: nil, status: .inProgress, priority: .medium, dueDate: nil, createdAt: now, updatedAt: now),
            ],
        ]

        self.memoriesByWorkspace = [
            rcs.id: [
                MemoryRecord(
                    id: "mock-memory-1", workspaceId: rcs.id, scope: .workspace,
                    content: "Acme's project timeline was pushed back two weeks last quarter.",
                    source: nil, conversationId: nil, projectKey: nil, metadata: [:], createdAt: now,
                    importanceScore: 0.8, confidenceScore: 0.9, memoryType: .longTerm
                ),
                MemoryRecord(
                    id: "mock-memory-2", workspaceId: rcs.id, scope: .user,
                    content: "Prefers concise, formal-toned client emails.",
                    source: nil, conversationId: nil, projectKey: nil, metadata: [:], createdAt: now,
                    importanceScore: 0.6, confidenceScore: 0.8, memoryType: .longTerm
                ),
            ],
        ]

        self.approvalsByWorkspace = [
            rcs.id: [
                PendingApproval(id: "mock-approval-1", workspaceId: rcs.id, actionType: "send_email", payload: .object(["to": .string("client@example.com")]), status: .pending, createdAt: now, expiresAt: now, resolvedAt: nil),
            ],
        ]

        self.preferencesByWorkspace = [
            rcs.id: [
                Preference(id: "mock-pref-1", workspaceId: rcs.id, category: .writingStyle, key: "tone", value: "formal", createdAt: now, updatedAt: now),
            ],
        ]

        self.integrationsByWorkspace = [
            rcs.id: [
                WorkspaceIntegration(
                    workspaceId: rcs.id, provider: .gmail, enabled: false, status: .disconnected,
                    connectedAt: nil, lastValidatedAt: nil, tokenExpiresAt: nil, createdAt: "", updatedAt: "",
                    displayName: "Gmail",
                    description: "Send, save drafts, read the inbox/unread messages, and search a connected Gmail account.",
                    capabilities: [
                        IntegrationCapability(actionType: "read_email", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "send_email", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "draft_gmail_email", tier: "execute_with_approval"),
                    ],
                    requiredCredentialFields: ["accessToken", "refreshToken"]
                ),
                WorkspaceIntegration(
                    workspaceId: rcs.id, provider: .github, enabled: true, status: .connected,
                    connectedAt: now, lastValidatedAt: now, tokenExpiresAt: nil, createdAt: now, updatedAt: now,
                    displayName: "GitHub",
                    description: "Read repositories, issues, and pull requests, plus creating issues and pull requests on a connected repository.",
                    capabilities: [
                        IntegrationCapability(actionType: "read_repositories", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "create_github_issue", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "create_github_pull_request", tier: "execute_with_approval"),
                    ],
                    requiredCredentialFields: ["accessToken"]
                ),
                WorkspaceIntegration(
                    workspaceId: rcs.id, provider: .calendar, enabled: false, status: .disconnected,
                    connectedAt: nil, lastValidatedAt: nil, tokenExpiresAt: nil, createdAt: "", updatedAt: "",
                    displayName: "Calendar",
                    description: "List calendars, read events, and create/update/delete events on a connected Calendar account.",
                    capabilities: [
                        IntegrationCapability(actionType: "read_calendar", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "create_calendar_event", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "update_calendar_event", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "delete_calendar_event", tier: "execute_with_approval"),
                    ],
                    requiredCredentialFields: ["accessToken", "refreshToken"]
                ),
            ],
        ]

        self.actionLogByWorkspace = [
            rcs.id: [
                ActionLogRecord(id: "mock-action-1", workspaceId: rcs.id, actionType: "create_task", tier: "automatic_safe", summary: "Created a task", payload: nil, outcome: .success, createdAt: now),
                ActionLogRecord(id: "mock-action-2", workspaceId: rcs.id, actionType: "send_email", tier: "execute_with_approval", summary: "Requested approval to send an email", payload: nil, outcome: .success, createdAt: now),
            ],
        ]
    }

    private func maybeFail() async throws {
        if artificialDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: artificialDelayNanoseconds)
        }
        if shouldFail {
            throw APIError.network("mock failure")
        }
    }

    public func getHealth() async throws -> SystemHealth {
        try await maybeFail()
        let ok = SystemHealth.CheckResult(status: "ok", detail: nil)
        return SystemHealth(
            status: "ok",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            checks: .init(
                database: ok,
                aiProvider: .init(status: "ok", detail: "mock"),
                memory: ok,
                knowledge: ok,
                integrations: .init(status: "ok", detail: "gmail, github, calendar"),
                voiceProviders: .init(status: "ok", detail: "mock / mock")
            )
        )
    }

    public func getUser(id: String) async throws -> UserProfile {
        try await maybeFail()
        return user
    }

    public func updateUserProfile(id: String, request: UpdateUserProfileRequest) async throws -> UserProfile {
        try await maybeFail()
        if let displayName = request.displayName { user = withDisplayName(user, displayName) }
        return user
    }

    public func createWorkspace(_ request: CreateWorkspaceRequest) async throws -> Workspace {
        try await maybeFail()
        let now = ISO8601DateFormatter().string(from: Date())
        let workspace = Workspace(
            id: UUID().uuidString, userId: request.userId, slug: request.slug, name: request.name,
            type: request.type ?? .personal, instructions: request.instructions,
            assistantBehavior: request.assistantBehavior ?? [:], metadata: request.metadata ?? [:],
            createdAt: now, updatedAt: now
        )
        workspaces.append(workspace)
        return workspace
    }

    public func listWorkspaces(userId: String) async throws -> [Workspace] {
        try await maybeFail()
        return workspaces.filter { $0.userId == userId }
    }

    public func getWorkspace(id: String) async throws -> Workspace {
        try await maybeFail()
        guard let workspace = workspaces.first(where: { $0.id == id }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(id)")
        }
        return workspace
    }

    public func updateWorkspace(id: String, request: UpdateWorkspaceRequest) async throws -> Workspace {
        try await maybeFail()
        guard let index = workspaces.firstIndex(where: { $0.id == id }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(id)")
        }
        var workspace = workspaces[index]
        workspace = Workspace(
            id: workspace.id, userId: workspace.userId, slug: workspace.slug,
            name: request.name ?? workspace.name, type: request.type ?? workspace.type,
            instructions: request.instructions ?? workspace.instructions,
            assistantBehavior: request.assistantBehavior ?? workspace.assistantBehavior,
            metadata: request.metadata ?? workspace.metadata,
            createdAt: workspace.createdAt, updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        workspaces[index] = workspace
        return workspace
    }

    public func createConversation(workspaceId: String, title: String?) async throws -> Conversation {
        try await maybeFail()
        let now = ISO8601DateFormatter().string(from: Date())
        let conversation = Conversation(id: UUID().uuidString, workspaceId: workspaceId, title: title, createdAt: now, updatedAt: now)
        conversations.append(conversation)
        messagesByConversation[conversation.id] = []
        return conversation
    }

    public func listConversations(workspaceId: String) async throws -> [Conversation] {
        try await maybeFail()
        // Newest-active-first, mirroring `ConversationService.listConversations` (Phase 2.1) — the mock has no
        // real `updated_at`/`sequence` bookkeeping, so it approximates recency with reverse insertion order.
        return conversations.filter { $0.workspaceId == workspaceId }.reversed()
    }

    public func listMessages(workspaceId: String, conversationId: String, limit: Int?) async throws -> [Message] {
        try await maybeFail()
        let all = messagesByConversation[conversationId] ?? []
        guard let limit else { return all }
        return Array(all.suffix(limit))
    }

    public func sendMessage(workspaceId: String, conversationId: String, content: String) async throws -> SendMessageResult {
        try await maybeFail()
        let now = ISO8601DateFormatter().string(from: Date())
        let userMessage = Message(id: UUID().uuidString, conversationId: conversationId, workspaceId: workspaceId, role: .user, content: content, createdAt: now)
        let assistantMessage = Message(id: UUID().uuidString, conversationId: conversationId, workspaceId: workspaceId, role: .assistant, content: "[mock response] You said: \"\(content)\"", createdAt: now)
        messagesByConversation[conversationId, default: []].append(contentsOf: [userMessage, assistantMessage])
        touchConversation(conversationId)

        let intent: IntentAnalysis
        let approvalDecision: ApprovalDecision
        if let approvalId = forcedNextApprovalId {
            forcedNextApprovalId = nil
            intent = IntentAnalysis(intent: "draft_email", confidence: 0.9, parameters: [:], approval: .approvalRequired, suggestedNextAction: "Awaiting your approval before drafting.")
            approvalDecision = ApprovalDecision(state: ApprovalStatus.pending.rawValue, pendingApprovalId: approvalId)
        } else {
            intent = IntentAnalysis(intent: "chat", confidence: 0.5, parameters: [:], approval: .noApprovalNeeded, suggestedNextAction: "No action needed — this is a conversational response.")
            approvalDecision = ApprovalDecision(state: "no_approval_needed", pendingApprovalId: nil)
        }

        let workflowSuggestion = forcedNextWorkflowSuggestion
        forcedNextWorkflowSuggestion = nil

        let executionSuggestion = forcedNextExecutionSuggestion
        forcedNextExecutionSuggestion = nil

        // Mirrors the backend's advisory retrievedContext (Phase 3.6) — populated whenever a workspace has
        // seeded searchable content, nil otherwise, the same "only present when configured" shape as the
        // real RetrievalService-optional ConversationService.
        let retrievedContext: RetrievedContext? = workspaceId == "mock-ws-rcs"
            ? RetrievedContext(memories: Self.seedRelatedMemories, relatedConversations: [], relatedTasks: [Self.seedSearchResults[1]])
            : nil

        return SendMessageResult(
            userMessage: userMessage,
            assistantMessage: assistantMessage,
            retrievedMemories: [],
            retrievedDocumentChunks: [],
            intent: intent,
            approvalDecision: approvalDecision,
            workflowSuggestion: workflowSuggestion,
            executionSuggestion: executionSuggestion,
            retrievedContext: retrievedContext
        )
    }

    /// Test hook (Phase 2.2): makes the next `sendMessage` call return an
    /// `ApprovalDecision` pointing at a real, freshly-seeded `PendingApproval`
    /// — simulating a Tier 3 capability being triggered, which no shipped
    /// capability default does yet. Returns the seeded approval's id.
    public func forceNextMessageToRequireApproval(workspaceId: String, actionType: String) -> String {
        let now = ISO8601DateFormatter().string(from: Date())
        let approval = PendingApproval(
            id: UUID().uuidString, workspaceId: workspaceId, actionType: actionType,
            payload: nil, status: .pending, createdAt: now, expiresAt: now, resolvedAt: nil
        )
        approvalsByWorkspace[workspaceId, default: []].append(approval)
        forcedNextApprovalId = approval.id
        return approval.id
    }

    /// Test hook (Phase 2.4): makes the next `sendMessage` call return the
    /// given `WorkflowSuggestion` — simulating `WorkflowIntentMatcher`
    /// matching the user's message, without needing to type an exact
    /// trigger phrase.
    public func forceNextMessageToSuggestWorkflow(_ suggestion: WorkflowSuggestion) {
        forcedNextWorkflowSuggestion = suggestion
    }

    /// Test hook (Phase 2.6): makes the next `sendMessage` call return the
    /// given `ExecutionSuggestion` — simulating `ExecutionIntentMatcher`
    /// matching the user's message, without needing to type an exact
    /// trigger phrase.
    public func forceNextMessageToSuggestExecution(_ suggestion: ExecutionSuggestion) {
        forcedNextExecutionSuggestion = suggestion
    }

    /// Test hook (Phase 3.3): makes the next `submitVoiceRequest` call fail
    /// as the backend's `VoiceProviderError` would (HTTP 502) — lets
    /// `VoiceSessionViewModel`'s provider-error UI state be exercised
    /// without a real vendor outage.
    public func forceNextVoiceRequestToFailWithProviderError() {
        forcedNextVoiceProviderFailure = true
    }

    public func listTasks(workspaceId: String, status: TaskStatus?) async throws -> [TaskItem] {
        try await maybeFail()
        let all = tasksByWorkspace[workspaceId] ?? []
        guard let status else { return all }
        return all.filter { $0.status == status }
    }

    public func createTask(workspaceId: String, request: CreateTaskRequest) async throws -> TaskItem {
        try await maybeFail()
        let now = ISO8601DateFormatter().string(from: Date())
        let task = TaskItem(
            id: UUID().uuidString, workspaceId: workspaceId, title: request.title,
            description: request.description, status: .todo, priority: request.priority ?? .medium,
            dueDate: request.dueDate, createdAt: now, updatedAt: now
        )
        tasksByWorkspace[workspaceId, default: []].append(task)
        return task
    }

    public func updateTask(workspaceId: String, taskId: String, request: UpdateTaskRequest) async throws -> TaskItem {
        try await maybeFail()
        guard var tasks = tasksByWorkspace[workspaceId], let index = tasks.firstIndex(where: { $0.id == taskId }) else {
            throw APIError.server(statusCode: 404, message: "Task not found: \(taskId)")
        }
        let existing = tasks[index]
        let updated = TaskItem(
            id: existing.id, workspaceId: existing.workspaceId,
            title: request.title ?? existing.title, description: request.description ?? existing.description,
            status: request.status ?? existing.status, priority: request.priority ?? existing.priority,
            dueDate: request.dueDate ?? existing.dueDate, createdAt: existing.createdAt,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        tasks[index] = updated
        tasksByWorkspace[workspaceId] = tasks
        return updated
    }

    public func deleteTask(workspaceId: String, taskId: String) async throws {
        try await maybeFail()
        tasksByWorkspace[workspaceId]?.removeAll { $0.id == taskId }
    }

    public func listMemories(
        workspaceId: String,
        scope: MemoryScope?,
        memoryType: MemoryType?,
        includeArchived: Bool
    ) async throws -> [MemoryRecord] {
        try await maybeFail()
        var results = memoriesByWorkspace[workspaceId] ?? []
        if !includeArchived { results = results.filter { !$0.isArchived } }
        if let scope { results = results.filter { $0.scope == scope } }
        if let memoryType { results = results.filter { $0.memoryType == memoryType } }
        return results
    }

    public func searchMemories(workspaceId: String, query: String, scope: MemoryScope?, limit: Int?) async throws -> [RankedMemoryResult] {
        try await maybeFail()
        let lowered = query.lowercased()
        var matches = (memoriesByWorkspace[workspaceId] ?? [])
            .filter { !$0.isArchived }
            .filter { scope == nil || $0.scope == scope }
            .filter { $0.content.lowercased().contains(lowered) }
            .map { memory in
                RankedMemoryResult(
                    id: memory.id, workspaceId: memory.workspaceId, scope: memory.scope, content: memory.content,
                    source: memory.source, conversationId: memory.conversationId, projectKey: memory.projectKey,
                    metadata: memory.metadata, createdAt: memory.createdAt, score: 1.0,
                    importanceScore: memory.importanceScore, confidenceScore: memory.confidenceScore,
                    memoryType: memory.memoryType, lastAccessedAt: memory.lastAccessedAt,
                    expiresAt: memory.expiresAt, archivedAt: memory.archivedAt
                )
            }
        if let limit { matches = Array(matches.prefix(limit)) }
        return matches
    }

    public func createMemory(workspaceId: String, request: CreateMemoryRequest) async throws -> MemoryRecord {
        try await maybeFail()
        let memory = MemoryRecord(
            id: UUID().uuidString, workspaceId: workspaceId, scope: request.scope, content: request.content,
            source: request.source, conversationId: request.conversationId, projectKey: request.projectKey,
            metadata: [:], createdAt: ISO8601DateFormatter().string(from: Date()),
            importanceScore: request.importanceScore ?? 0.5, confidenceScore: request.confidenceScore ?? 1.0,
            memoryType: request.memoryType ?? .longTerm
        )
        memoriesByWorkspace[workspaceId, default: []].append(memory)
        return memory
    }

    public func updateMemory(workspaceId: String, memoryId: String, request: UpdateMemoryRequest) async throws -> MemoryRecord {
        try await maybeFail()
        guard var memories = memoriesByWorkspace[workspaceId], let index = memories.firstIndex(where: { $0.id == memoryId }) else {
            throw APIError.server(statusCode: 404, message: "Memory not found: \(memoryId)")
        }
        let existing = memories[index]
        let updated = MemoryRecord(
            id: existing.id, workspaceId: existing.workspaceId, scope: existing.scope,
            content: request.content ?? existing.content,
            source: existing.source, conversationId: existing.conversationId, projectKey: existing.projectKey,
            metadata: existing.metadata, createdAt: existing.createdAt,
            importanceScore: request.importanceScore ?? existing.importanceScore,
            confidenceScore: request.confidenceScore ?? existing.confidenceScore,
            memoryType: existing.memoryType, lastAccessedAt: existing.lastAccessedAt,
            expiresAt: existing.expiresAt, archivedAt: existing.archivedAt
        )
        memories[index] = updated
        memoriesByWorkspace[workspaceId] = memories
        return updated
    }

    public func archiveMemory(workspaceId: String, memoryId: String) async throws -> MemoryRecord {
        try await maybeFail()
        guard var memories = memoriesByWorkspace[workspaceId], let index = memories.firstIndex(where: { $0.id == memoryId }) else {
            throw APIError.server(statusCode: 404, message: "Memory not found: \(memoryId)")
        }
        let existing = memories[index]
        let archived = MemoryRecord(
            id: existing.id, workspaceId: existing.workspaceId, scope: existing.scope, content: existing.content,
            source: existing.source, conversationId: existing.conversationId, projectKey: existing.projectKey,
            metadata: existing.metadata, createdAt: existing.createdAt,
            importanceScore: existing.importanceScore, confidenceScore: existing.confidenceScore,
            memoryType: existing.memoryType, lastAccessedAt: existing.lastAccessedAt,
            expiresAt: existing.expiresAt, archivedAt: ISO8601DateFormatter().string(from: Date())
        )
        memories[index] = archived
        memoriesByWorkspace[workspaceId] = memories
        return archived
    }

    public func deleteMemory(workspaceId: String, memoryId: String) async throws {
        try await maybeFail()
        memoriesByWorkspace[workspaceId]?.removeAll { $0.id == memoryId }
    }

    public func listApprovals(workspaceId: String, status: ApprovalStatus?) async throws -> [PendingApproval] {
        try await maybeFail()
        let all = approvalsByWorkspace[workspaceId] ?? []
        guard let status else { return all }
        return all.filter { $0.status == status }
    }

    public func getApproval(workspaceId: String, approvalId: String) async throws -> PendingApproval {
        try await maybeFail()
        guard let approval = (approvalsByWorkspace[workspaceId] ?? []).first(where: { $0.id == approvalId }) else {
            throw APIError.server(statusCode: 404, message: "Approval not found: \(approvalId)")
        }
        return approval
    }

    public func approveApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision {
        try await maybeFail()
        try resolveApproval(workspaceId: workspaceId, approvalId: approvalId, to: .approved)
        return ApprovalDecision(state: ApprovalStatus.approved.rawValue, pendingApprovalId: approvalId)
    }

    public func rejectApproval(workspaceId: String, approvalId: String) async throws -> ApprovalDecision {
        try await maybeFail()
        try resolveApproval(workspaceId: workspaceId, approvalId: approvalId, to: .rejected)
        return ApprovalDecision(state: ApprovalStatus.rejected.rawValue, pendingApprovalId: approvalId)
    }

    private func resolveApproval(workspaceId: String, approvalId: String, to status: ApprovalStatus) throws {
        guard var approvals = approvalsByWorkspace[workspaceId], let index = approvals.firstIndex(where: { $0.id == approvalId }) else {
            throw APIError.server(statusCode: 404, message: "Approval not found: \(approvalId)")
        }
        let existing = approvals[index]
        approvals[index] = PendingApproval(
            id: existing.id, workspaceId: existing.workspaceId, actionType: existing.actionType,
            payload: existing.payload, status: status, createdAt: existing.createdAt,
            expiresAt: existing.expiresAt, resolvedAt: ISO8601DateFormatter().string(from: Date())
        )
        approvalsByWorkspace[workspaceId] = approvals
    }

    public func listPreferences(workspaceId: String, category: PreferenceCategory?) async throws -> [Preference] {
        try await maybeFail()
        let all = preferencesByWorkspace[workspaceId] ?? []
        guard let category else { return all }
        return all.filter { $0.category == category }
    }

    public func setPreference(workspaceId: String, request: SetPreferenceRequest) async throws -> Preference {
        try await maybeFail()
        let now = ISO8601DateFormatter().string(from: Date())
        var existing = preferencesByWorkspace[workspaceId] ?? []
        if let index = existing.firstIndex(where: { $0.category == request.category && $0.key == request.key }) {
            let updated = Preference(id: existing[index].id, workspaceId: workspaceId, category: request.category, key: request.key, value: request.value, createdAt: existing[index].createdAt, updatedAt: now)
            existing[index] = updated
            preferencesByWorkspace[workspaceId] = existing
            return updated
        }
        let created = Preference(id: UUID().uuidString, workspaceId: workspaceId, category: request.category, key: request.key, value: request.value, createdAt: now, updatedAt: now)
        existing.append(created)
        preferencesByWorkspace[workspaceId] = existing
        return created
    }

    public func listIntegrations(workspaceId: String) async throws -> [WorkspaceIntegration] {
        try await maybeFail()
        return integrationsByWorkspace[workspaceId] ?? []
    }

    public func connectIntegration(
        workspaceId: String,
        provider: IntegrationProvider,
        credentials: [String: String]
    ) async throws -> WorkspaceIntegration {
        try await maybeFail()
        try validateIntegrationCredentials(provider: provider, credentials: credentials)

        guard var integrations = integrationsByWorkspace[workspaceId],
              let index = integrations.firstIndex(where: { $0.provider == provider }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let existing = integrations[index]
        integrations[index] = WorkspaceIntegration(
            workspaceId: workspaceId, provider: provider, enabled: true, status: .connected,
            connectedAt: now, lastValidatedAt: now, tokenExpiresAt: Self.mockTokenExpiry(from: now),
            createdAt: existing.createdAt.isEmpty ? now : existing.createdAt, updatedAt: now,
            displayName: existing.displayName, description: existing.description, capabilities: existing.capabilities,
            requiredCredentialFields: existing.requiredCredentialFields
        )
        integrationsByWorkspace[workspaceId] = integrations
        return integrations[index]
    }

    public func disconnectIntegration(workspaceId: String, provider: IntegrationProvider) async throws -> WorkspaceIntegration {
        try await maybeFail()
        guard var integrations = integrationsByWorkspace[workspaceId],
              let index = integrations.firstIndex(where: { $0.provider == provider && $0.enabled }) else {
            throw APIError.server(statusCode: 404, message: "No connected \(provider.rawValue) integration")
        }

        let existing = integrations[index]
        integrations[index] = WorkspaceIntegration(
            workspaceId: workspaceId, provider: provider, enabled: false, status: .disconnected,
            connectedAt: existing.connectedAt, lastValidatedAt: existing.lastValidatedAt, tokenExpiresAt: nil,
            createdAt: existing.createdAt, updatedAt: ISO8601DateFormatter().string(from: Date()),
            displayName: existing.displayName, description: existing.description, capabilities: existing.capabilities,
            requiredCredentialFields: existing.requiredCredentialFields
        )
        integrationsByWorkspace[workspaceId] = integrations
        return integrations[index]
    }

    public func rotateIntegrationCredentials(
        workspaceId: String,
        provider: IntegrationProvider,
        credentials: [String: String]
    ) async throws -> WorkspaceIntegration {
        try await maybeFail()
        try validateIntegrationCredentials(provider: provider, credentials: credentials)

        guard var integrations = integrationsByWorkspace[workspaceId],
              let index = integrations.firstIndex(where: { $0.provider == provider && $0.enabled }) else {
            throw APIError.server(statusCode: 404, message: "No connected \(provider.rawValue) integration")
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let existing = integrations[index]
        integrations[index] = WorkspaceIntegration(
            workspaceId: workspaceId, provider: provider, enabled: true, status: .connected,
            connectedAt: existing.connectedAt, lastValidatedAt: now, tokenExpiresAt: Self.mockTokenExpiry(from: now),
            createdAt: existing.createdAt, updatedAt: now,
            displayName: existing.displayName, description: existing.description, capabilities: existing.capabilities,
            requiredCredentialFields: existing.requiredCredentialFields
        )
        integrationsByWorkspace[workspaceId] = integrations
        return integrations[index]
    }

    /// Mirrors `OAuthService.startAuthorization` — never connects anything itself; only `simulateOAuthCallback` (the mock's stand-in for the backend's real callback) actually marks the integration connected.
    public func startIntegrationOAuth(workspaceId: String, provider: IntegrationProvider) async throws -> String {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        return "https://example.test/oauth/\(provider.rawValue)/authorize?state=mock-state"
    }

    /// Test hook (Phase 2.7): simulates the backend's OAuth callback completing server-side — the real flow the
    /// macOS app drives is "open a browser to `startIntegrationOAuth`'s URL, then refresh status," since the
    /// backend itself completes the connection once the provider redirects back, with no client-side step in
    /// between. This lets `IntegrationsViewModel`/UI tests exercise "OAuth connect finished" without a real browser.
    public func simulateOAuthCallback(workspaceId: String, provider: IntegrationProvider) {
        guard var integrations = integrationsByWorkspace[workspaceId],
              let index = integrations.firstIndex(where: { $0.provider == provider }) else {
            return
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let existing = integrations[index]
        integrations[index] = WorkspaceIntegration(
            workspaceId: workspaceId, provider: provider, enabled: true, status: .connected,
            connectedAt: now, lastValidatedAt: now, tokenExpiresAt: Self.mockTokenExpiry(from: now),
            createdAt: existing.createdAt.isEmpty ? now : existing.createdAt, updatedAt: now,
            displayName: existing.displayName, description: existing.description, capabilities: existing.capabilities,
            requiredCredentialFields: existing.requiredCredentialFields
        )
        integrationsByWorkspace[workspaceId] = integrations
    }

    private static func mockTokenExpiry(from now: String) -> String? {
        guard let date = ISO8601DateFormatter().date(from: now) else { return nil }
        return ISO8601DateFormatter().string(from: date.addingTimeInterval(3600))
    }

    /// Mirrors `IntegrationRegistry`'s `requiredCredentialFields` (backend/src/integrations/registry.ts) so the mock
    /// rejects the same malformed input the real backend would.
    private func validateIntegrationCredentials(provider: IntegrationProvider, credentials: [String: String]) throws {
        let required: [String]
        switch provider {
        case .gmail: required = ["accessToken", "refreshToken"]
        case .github: required = ["accessToken"]
        case .calendar: required = ["accessToken", "refreshToken"]
        }
        let missing = required.filter { credentials[$0]?.isEmpty ?? true }
        if !missing.isEmpty {
            throw APIError.server(statusCode: 400, message: "Missing required credential field(s): \(missing.joined(separator: ", "))")
        }
    }

    public func listWorkflowDefinitions() async throws -> [WorkflowDefinition] {
        try await maybeFail()
        return Self.workflowDefinitions
    }

    public func listWorkflowRuns(workspaceId: String) async throws -> [WorkflowRun] {
        try await maybeFail()
        // Newest-first, approximating the real `sequence DESC` ordering (workflowService.ts#listRuns) with reverse insertion order.
        return (workflowRunsByWorkspace[workspaceId] ?? []).reversed().map(\.asRun)
    }

    public func createWorkflowRun(workspaceId: String, workflowKey: WorkflowKey, input: [String: String]) async throws -> WorkflowRunDetail {
        try await maybeFail()
        guard let definition = Self.workflowDefinitions.first(where: { $0.key == workflowKey }) else {
            throw APIError.server(statusCode: 400, message: "Unknown workflow: \(workflowKey.rawValue)")
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let runId = UUID().uuidString
        let steps = definition.steps.enumerated().map { index, stepDefinition in
            WorkflowStepRun(
                id: UUID().uuidString, workflowRunId: runId, stepIndex: index, stepKey: stepDefinition.key,
                status: .pending, capability: stepDefinition.capability, pendingApprovalId: nil, output: nil,
                createdAt: now, updatedAt: now
            )
        }
        let run = WorkflowRunDetail(
            id: runId, workspaceId: workspaceId, workflowKey: workflowKey, status: .pending,
            currentStepIndex: 0, input: input, result: nil, createdAt: now, updatedAt: now,
            completedAt: nil, steps: steps
        )
        workflowRunsByWorkspace[workspaceId, default: []].append(run)
        return run
    }

    public func getWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await maybeFail()
        return try findWorkflowRun(workspaceId: workspaceId, runId: runId)
    }

    /// Mirrors `WorkflowService.executeNextStep` (backend/src/workflows/workflowService.ts): advances exactly one
    /// step. A step gated by a capability that requires approval (only `read_email` in this mock, matching that
    /// capability's real Tier 3 default) pauses the run at `awaiting_approval` with a real seeded
    /// `PendingApproval` — the step's mock output is never produced until `resumeWorkflowRun` confirms approval.
    public func executeWorkflowRunStep(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await maybeFail()
        let run = try findWorkflowRun(workspaceId: workspaceId, runId: runId)
        guard run.status == .pending || run.status == .running else {
            throw APIError.server(statusCode: 409, message: "Cannot execute a step on a run with status \(run.status.rawValue)")
        }

        let stepIndex = run.currentStepIndex
        let step = run.steps[stepIndex]

        if let capability = step.capability, capabilityRequiresApproval(capability) {
            let now = ISO8601DateFormatter().string(from: Date())
            let approval = PendingApproval(
                id: UUID().uuidString, workspaceId: workspaceId, actionType: capability,
                payload: .object(["workflowRunId": .string(runId), "stepKey": .string(step.stepKey)]),
                status: .pending, createdAt: now, expiresAt: now, resolvedAt: nil
            )
            approvalsByWorkspace[workspaceId, default: []].append(approval)

            let pausedStep = withStepStatus(step, status: .awaitingApproval, pendingApprovalId: approval.id, output: nil)
            let paused = withRunStatus(
                run, status: .awaitingApproval,
                steps: replacingStep(run.steps, at: stepIndex, with: pausedStep)
            )
            saveWorkflowRun(paused, workspaceId: workspaceId)
            return paused
        }

        let updated = performStep(run: run, stepIndex: stepIndex)
        saveWorkflowRun(updated, workspaceId: workspaceId)
        return updated
    }

    public func pauseWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await maybeFail()
        let run = try findWorkflowRun(workspaceId: workspaceId, runId: runId)
        guard run.status == .pending || run.status == .running else {
            throw APIError.server(statusCode: 409, message: "Cannot pause a run with status \(run.status.rawValue)")
        }
        let paused = withRunStatus(run, status: .paused)
        saveWorkflowRun(paused, workspaceId: workspaceId)
        return paused
    }

    public func resumeWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await maybeFail()
        let run = try findWorkflowRun(workspaceId: workspaceId, runId: runId)

        switch run.status {
        case .paused:
            let resumed = withRunStatus(run, status: .running)
            saveWorkflowRun(resumed, workspaceId: workspaceId)
            return resumed

        case .awaitingApproval:
            let stepIndex = run.currentStepIndex
            let step = run.steps[stepIndex]
            guard let approvalId = step.pendingApprovalId,
                  let approval = (approvalsByWorkspace[workspaceId] ?? []).first(where: { $0.id == approvalId }) else {
                throw APIError.server(statusCode: 404, message: "Pending approval not found for run: \(runId)")
            }
            switch approval.status {
            case .pending:
                throw APIError.server(statusCode: 409, message: "Approval has not yet been granted for this step")
            case .approved:
                let updated = performStep(run: run, stepIndex: stepIndex)
                saveWorkflowRun(updated, workspaceId: workspaceId)
                return updated
            case .rejected, .expired:
                let failedStep = withStepStatus(step, status: .failed, pendingApprovalId: approvalId, output: ["error": .string("Approval was \(approval.status.rawValue)")])
                let failed = withRunStatus(
                    run, status: .failed,
                    steps: replacingStep(run.steps, at: stepIndex, with: failedStep)
                )
                saveWorkflowRun(failed, workspaceId: workspaceId)
                return failed
            }

        default:
            throw APIError.server(statusCode: 409, message: "Cannot resume a run with status \(run.status.rawValue)")
        }
    }

    public func cancelWorkflowRun(workspaceId: String, runId: String) async throws -> WorkflowRunDetail {
        try await maybeFail()
        let run = try findWorkflowRun(workspaceId: workspaceId, runId: runId)
        guard run.status != .completed, run.status != .failed, run.status != .cancelled else {
            throw APIError.server(statusCode: 409, message: "Cannot cancel a run with status \(run.status.rawValue)")
        }

        var steps = run.steps
        let stepIndex = run.currentStepIndex
        if stepIndex < steps.count, steps[stepIndex].status == .pending || steps[stepIndex].status == .awaitingApproval {
            steps = replacingStep(steps, at: stepIndex, with: withStepStatus(steps[stepIndex], status: .skipped, pendingApprovalId: steps[stepIndex].pendingApprovalId, output: nil))
        }
        let cancelled = withRunStatus(run, status: .cancelled, steps: steps)
        saveWorkflowRun(cancelled, workspaceId: workspaceId)
        return cancelled
    }

    public func getDailyBriefing(workspaceId: String) async throws -> DailyBriefing {
        try await maybeFail()
        guard let workspace = workspaces.first(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }

        let now = Date()
        let openTasks = (tasksByWorkspace[workspaceId] ?? []).filter(Self.isOpenTask)
        let pendingApprovals = (approvalsByWorkspace[workspaceId] ?? []).filter { $0.status == .pending }
        let activeWorkflows = (workflowRunsByWorkspace[workspaceId] ?? []).map(\.asRun).filter { Self.activeWorkflowRunStatuses.contains($0.status) }
        let priorityTasks = Array(Self.rankTasksByPriority(openTasks, now: now, dueSoonWindow: Self.defaultDueSoonWindow).prefix(5))
        let recentActivity = actionLogByWorkspace[workspaceId] ?? []
        let recentMemories = memoriesByWorkspace[workspaceId] ?? []
        let suggestedNextActions = Array((workspaceId == "mock-ws-rcs" ? Self.seedSuggestions : []).prefix(3))

        return DailyBriefing(
            workspaceId: workspaceId, workspaceName: workspace.name,
            pendingApprovalCount: pendingApprovals.count, pendingApprovals: pendingApprovals,
            activeWorkflowCount: activeWorkflows.count, activeWorkflows: activeWorkflows,
            priorityTasks: priorityTasks, recentActivity: recentActivity,
            recentMemories: recentMemories, calendarHighlights: [],
            suggestedNextActions: suggestedNextActions,
            generatedAt: ISO8601DateFormatter().string(from: now)
        )
    }

    public func getProactivePatterns(workspaceId: String) async throws -> [Pattern] {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        return workspaceId == "mock-ws-rcs" ? Self.seedPatterns : []
    }

    public func getProactiveSuggestions(workspaceId: String) async throws -> [Suggestion] {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        return workspaceId == "mock-ws-rcs" ? Self.seedSuggestions : []
    }

    // MARK: - Retrieval (Phase 3.6)

    public func searchSemantic(workspaceId: String, query: String, sourceTypes: [EmbeddingSourceType]?, limit: Int?) async throws -> [SearchResult] {
        try await maybeFail()
        let lowered = query.lowercased()
        var matches = (workspaceId == "mock-ws-rcs" ? Self.seedSearchResults : [])
            .filter { sourceTypes == nil || sourceTypes!.contains($0.sourceType) }
            .filter { $0.content.lowercased().contains(lowered) }
        if let limit { matches = Array(matches.prefix(limit)) }
        return matches
    }

    public func getRetrievedContext(
        workspaceId: String,
        query: String,
        conversationId: String?,
        memoryLimit: Int?,
        embeddingLimit: Int?
    ) async throws -> RetrievedContext {
        try await maybeFail()
        let memories = try await searchMemories(workspaceId: workspaceId, query: query, scope: nil, limit: memoryLimit)
        let relatedConversations = try await searchSemantic(workspaceId: workspaceId, query: query, sourceTypes: [.conversation], limit: embeddingLimit)
        let relatedTasks = try await searchSemantic(workspaceId: workspaceId, query: query, sourceTypes: [.task], limit: embeddingLimit)
        return RetrievedContext(memories: memories, relatedConversations: relatedConversations, relatedTasks: relatedTasks)
    }

    /// A deterministic canned summary — `MockAPIClient` has no real indexing pipeline to actually re-run, unlike
    /// the backend's `RetrievalService.reindexWorkspace`.
    public func reindexEmbeddings(workspaceId: String) async throws -> ReindexWorkspaceResult {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        guard workspaceId == "mock-ws-rcs" else {
            return ReindexWorkspaceResult(conversations: [], tasks: [])
        }
        return ReindexWorkspaceResult(
            conversations: [IndexResult(sourceType: .conversation, sourceId: "mock-conversation-1", chunksIndexed: 1, chunksSkipped: 0, chunksDeleted: 0)],
            tasks: [IndexResult(sourceType: .task, sourceId: "mock-task-1", chunksIndexed: 1, chunksSkipped: 0, chunksDeleted: 0)]
        )
    }

    public func getTaskIntelligence(workspaceId: String) async throws -> TaskIntelligence {
        try await maybeFail()
        let now = Date()
        let openTasks = (tasksByWorkspace[workspaceId] ?? []).filter(Self.isOpenTask)

        return TaskIntelligence(
            workspaceId: workspaceId,
            suggestedPriorities: Self.rankTasksByPriority(openTasks, now: now, dueSoonWindow: Self.defaultDueSoonWindow),
            dueSoon: Self.findDueSoon(openTasks, now: now, window: Self.defaultDueSoonWindow),
            overdue: Self.findOverdue(openTasks, now: now),
            relatedGroups: Self.groupRelatedTasks(openTasks),
            generatedAt: ISO8601DateFormatter().string(from: now)
        )
    }

    public func getConversationIntelligence(workspaceId: String, conversationId: String) async throws -> ConversationIntelligence {
        try await maybeFail()
        guard conversations.contains(where: { $0.id == conversationId && $0.workspaceId == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Conversation not found: \(conversationId)")
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let recentContext = Array((messagesByConversation[conversationId] ?? []).suffix(10))

        guard !recentContext.isEmpty else {
            return ConversationIntelligence(
                workspaceId: workspaceId, conversationId: conversationId, summary: "", suggestedFollowUps: [],
                recentContext: [], relatedMemories: [], generatedAt: now
            )
        }

        let summary = "[mock summary] \(recentContext.count) recent message(s); most recent: \"\(recentContext.last?.content ?? "")\""
        let suggestedFollowUps = ["Follow up on the open item", "Confirm next steps", "Check in with the team"]
        let relatedMemories = workspaceId == "mock-ws-rcs" ? Self.seedRelatedMemories : []

        return ConversationIntelligence(
            workspaceId: workspaceId, conversationId: conversationId, summary: summary,
            suggestedFollowUps: suggestedFollowUps, recentContext: recentContext,
            relatedMemories: relatedMemories, generatedAt: now
        )
    }

    public func getWorkspaceInsights(workspaceId: String) async throws -> WorkspaceInsights {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }

        let tasks = tasksByWorkspace[workspaceId] ?? []
        let approvals = approvalsByWorkspace[workspaceId] ?? []
        let workflowRuns = (workflowRunsByWorkspace[workspaceId] ?? []).map(\.asRun)
        let activityEntries = actionLogByWorkspace[workspaceId] ?? []

        let activityMetrics = ActivityMetrics(
            totalActions: activityEntries.count,
            successfulActions: activityEntries.filter { $0.outcome == .success }.count,
            failedActions: activityEntries.filter { $0.outcome == .failure }.count
        )

        return WorkspaceInsights(
            workspaceId: workspaceId,
            activityMetrics: activityMetrics,
            workflowMetrics: Self.summarizeWorkflowRuns(workflowRuns),
            approvalMetrics: Self.summarizeApprovals(approvals.map(\.status)),
            taskMetrics: Self.summarizeTasks(tasks),
            generatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    // MARK: - Action Execution

    /// Mirrors `ExecutionService.preview` (backend/src/execution/executionService.ts): pure, read-only, never persists anything.
    public func previewExecution(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionPreview {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        guard let provider = Self.executionActionProviders[actionType] else {
            throw APIError.server(statusCode: 400, message: "Unsupported action type: \(actionType)")
        }
        let integrationConnected = (integrationsByWorkspace[workspaceId] ?? []).contains { $0.provider == provider && $0.enabled }
        return ExecutionPreview(
            actionType: actionType, provider: provider, tier: Self.executionTier,
            requiresApproval: true, integrationConnected: integrationConnected, payload: payload
        )
    }

    /// Mirrors `ExecutionService.createExecutionRequest`: rejects before creating anything if the integration isn't
    /// connected, then persists a real `awaiting_approval` execution backed by a real seeded `PendingApproval` —
    /// every built-in execution action type is Tier 3, so none of them auto-execute.
    public func createExecutionRequest(workspaceId: String, actionType: String, payload: [String: JSONValue]) async throws -> ExecutionRecord {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        guard let provider = Self.executionActionProviders[actionType] else {
            throw APIError.server(statusCode: 400, message: "Unsupported action type: \(actionType)")
        }
        let integrationConnected = (integrationsByWorkspace[workspaceId] ?? []).contains { $0.provider == provider && $0.enabled }
        guard integrationConnected else {
            throw APIError.server(statusCode: 404, message: "No connected \(provider.rawValue) integration")
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let approval = PendingApproval(
            id: UUID().uuidString, workspaceId: workspaceId, actionType: actionType,
            payload: .object(payload), status: .pending, createdAt: now, expiresAt: now, resolvedAt: nil
        )
        approvalsByWorkspace[workspaceId, default: []].append(approval)

        let execution = ExecutionRecord(
            id: UUID().uuidString, workspaceId: workspaceId, provider: provider, actionType: actionType,
            status: .awaitingApproval, requestPayload: payload, responseSummary: nil, errorDetails: nil,
            pendingApprovalId: approval.id, startedAt: nil, completedAt: nil, createdAt: now, updatedAt: now
        )
        executionsByWorkspace[workspaceId, default: []].append(execution)
        return execution
    }

    /// Mirrors `ExecutionService.execute`: advances at most one attempt and is idempotent on a terminal record —
    /// calling this again after success/failure just returns the stored result, no provider re-contact.
    public func executeExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord {
        try await maybeFail()
        let execution = try findExecution(workspaceId: workspaceId, executionId: executionId)
        if execution.status == .succeeded || execution.status == .failed {
            return execution
        }

        if execution.status == .awaitingApproval {
            guard let approvalId = execution.pendingApprovalId,
                  let approval = (approvalsByWorkspace[workspaceId] ?? []).first(where: { $0.id == approvalId }) else {
                throw APIError.server(statusCode: 404, message: "Pending approval not found for execution: \(executionId)")
            }
            switch approval.status {
            case .pending:
                throw APIError.server(statusCode: 409, message: "Approval has not yet been granted for this execution")
            case .rejected, .expired:
                return finishExecution(execution, status: .failed, responseSummary: nil, errorDetails: "Approval was \(approval.status.rawValue)")
            case .approved:
                break
            }
        }

        return runMockExecutor(execution)
    }

    public func listExecutions(workspaceId: String) async throws -> [ExecutionRecord] {
        try await maybeFail()
        // Newest-first, approximating the real `sequence DESC` ordering (executionService.ts#listHistory) with reverse insertion order.
        return (executionsByWorkspace[workspaceId] ?? []).reversed()
    }

    public func getExecution(workspaceId: String, executionId: String) async throws -> ExecutionRecord {
        try await maybeFail()
        return try findExecution(workspaceId: workspaceId, executionId: executionId)
    }

    /// Requires an explicit call — mirrors `VoiceService.startSession`: creates a real, listable conversation
    /// the session drives (Phase 3.2).
    public func startVoiceSession(workspaceId: String) async throws -> VoiceSession {
        try await maybeFail()
        guard workspaces.contains(where: { $0.id == workspaceId }) else {
            throw APIError.server(statusCode: 404, message: "Workspace not found: \(workspaceId)")
        }
        let conversation = try await createConversation(workspaceId: workspaceId, title: "Voice Session")
        let now = ISO8601DateFormatter().string(from: Date())
        let session = VoiceSession(
            id: UUID().uuidString, workspaceId: workspaceId, conversationId: conversation.id,
            status: .active, startedAt: now, endedAt: nil, createdAt: now, updatedAt: now
        )
        voiceSessionsByWorkspace[workspaceId, default: []].append(session)
        return session
    }

    public func endVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession {
        try await maybeFail()
        let session = try findVoiceSession(workspaceId: workspaceId, voiceSessionId: voiceSessionId)
        guard session.status == .active else {
            throw APIError.server(statusCode: 409, message: "Cannot end a voice session that is currently \"\(session.status.rawValue)\"")
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let ended = VoiceSession(
            id: session.id, workspaceId: session.workspaceId, conversationId: session.conversationId,
            status: .ended, startedAt: session.startedAt, endedAt: now, createdAt: session.createdAt, updatedAt: now
        )
        updateVoiceSession(ended)
        return ended
    }

    public func listVoiceSessions(workspaceId: String) async throws -> [VoiceSession] {
        try await maybeFail()
        // Newest-first, approximating the real `sequence DESC` ordering with reverse insertion order.
        return (voiceSessionsByWorkspace[workspaceId] ?? []).reversed()
    }

    public func getVoiceSession(workspaceId: String, voiceSessionId: String) async throws -> VoiceSession {
        try await maybeFail()
        return try findVoiceSession(workspaceId: workspaceId, voiceSessionId: voiceSessionId)
    }

    /// Mirrors `VoiceService.submitVoiceRequest`: transcribes (decodes the audio buffer as UTF-8 text, matching
    /// `MockSpeechToTextProvider`), runs the real `sendMessage` pipeline, then "synthesizes" the reply by encoding
    /// its text back to a buffer (matching `MockTextToSpeechProvider`). No audio is persisted.
    public func submitVoiceRequest(
        workspaceId: String,
        voiceSessionId: String,
        audioData: Data,
        audioMimeType: String,
        configuration: VoiceConfiguration?
    ) async throws -> VoiceResponse {
        try await maybeFail()
        let session = try findVoiceSession(workspaceId: workspaceId, voiceSessionId: voiceSessionId)
        guard session.status == .active else {
            throw APIError.server(
                statusCode: 409,
                message: "Cannot submit a voice request to a voice session that is currently \"\(session.status.rawValue)\""
            )
        }
        if forcedNextVoiceProviderFailure {
            forcedNextVoiceProviderFailure = false
            throw APIError.server(statusCode: 502, message: "The speech-to-text provider failed to process this request")
        }

        let transcriptText = String(data: audioData, encoding: .utf8) ?? ""
        let sendResult = try await sendMessage(workspaceId: workspaceId, conversationId: session.conversationId, content: transcriptText)

        let now = ISO8601DateFormatter().string(from: Date())
        let turn = VoiceTurn(
            id: UUID().uuidString,
            voiceSessionId: voiceSessionId,
            workspaceId: workspaceId,
            transcript: Transcript(text: transcriptText, confidence: transcriptText.isEmpty ? 0 : 1),
            responseText: sendResult.assistantMessage.content,
            createdAt: now
        )
        voiceTurnsBySession[voiceSessionId, default: []].append(turn)

        return VoiceResponse(
            turn: turn,
            audioBase64: Data(sendResult.assistantMessage.content.utf8).base64EncodedString(),
            audioMimeType: "text/plain",
            intent: sendResult.intent,
            approvalDecision: sendResult.approvalDecision,
            workflowSuggestion: sendResult.workflowSuggestion,
            executionSuggestion: sendResult.executionSuggestion
        )
    }

    public func listVoiceTurns(workspaceId: String, voiceSessionId: String) async throws -> [VoiceTurn] {
        try await maybeFail()
        _ = try findVoiceSession(workspaceId: workspaceId, voiceSessionId: voiceSessionId)
        return voiceTurnsBySession[voiceSessionId] ?? []
    }

    private func findVoiceSession(workspaceId: String, voiceSessionId: String) throws -> VoiceSession {
        guard let session = (voiceSessionsByWorkspace[workspaceId] ?? []).first(where: { $0.id == voiceSessionId }) else {
            throw APIError.server(statusCode: 404, message: "Voice session not found: \(voiceSessionId)")
        }
        return session
    }

    private func updateVoiceSession(_ session: VoiceSession) {
        guard var sessions = voiceSessionsByWorkspace[session.workspaceId],
              let index = sessions.firstIndex(where: { $0.id == session.id }) else { return }
        sessions[index] = session
        voiceSessionsByWorkspace[session.workspaceId] = sessions
    }

    /// Mirrors `ExecutionService.runExecutor`: re-checks the integration is still connected immediately before
    /// producing a mock provider response, since credentials/connection state are never trusted from creation time.
    private func runMockExecutor(_ execution: ExecutionRecord) -> ExecutionRecord {
        let integrationConnected = (integrationsByWorkspace[execution.workspaceId] ?? []).contains { $0.provider == execution.provider && $0.enabled }
        guard integrationConnected else {
            return finishExecution(execution, status: .failed, responseSummary: nil, errorDetails: "Integration not connected: \(execution.provider.rawValue)")
        }
        let responseSummary = mockExecutionResponse(actionType: execution.actionType)
        return finishExecution(execution, status: .succeeded, responseSummary: responseSummary, errorDetails: nil)
    }

    /// A plausible mock effect for each built-in execution action type — not wired to any real provider, mirroring
    /// `StubGmailConnector`/`StubGitHubConnector`'s deterministic synthesized-ID responses.
    private func mockExecutionResponse(actionType: String) -> [String: JSONValue] {
        switch actionType {
        case "send_email":
            return ["messageId": .string("mock-message-\(UUID().uuidString)")]
        case "draft_gmail_email":
            return ["draftId": .string("mock-draft-\(UUID().uuidString)")]
        case "create_github_issue":
            return ["issueId": .string("mock-issue-\(UUID().uuidString)"), "number": .number(1)]
        case "create_github_pull_request":
            return ["pullRequestId": .string("mock-pr-\(UUID().uuidString)"), "number": .number(1)]
        default:
            return [:]
        }
    }

    private func finishExecution(_ execution: ExecutionRecord, status: ExecutionStatus, responseSummary: [String: JSONValue]?, errorDetails: String?) -> ExecutionRecord {
        let now = ISO8601DateFormatter().string(from: Date())
        let updated = ExecutionRecord(
            id: execution.id, workspaceId: execution.workspaceId, provider: execution.provider, actionType: execution.actionType,
            status: status, requestPayload: execution.requestPayload, responseSummary: responseSummary,
            errorDetails: errorDetails, pendingApprovalId: execution.pendingApprovalId,
            startedAt: execution.startedAt ?? now, completedAt: now, createdAt: execution.createdAt, updatedAt: now
        )
        saveExecution(updated)
        return updated
    }

    private func findExecution(workspaceId: String, executionId: String) throws -> ExecutionRecord {
        guard let execution = (executionsByWorkspace[workspaceId] ?? []).first(where: { $0.id == executionId }) else {
            throw APIError.server(statusCode: 404, message: "Execution not found: \(executionId)")
        }
        return execution
    }

    private func saveExecution(_ execution: ExecutionRecord) {
        guard var executions = executionsByWorkspace[execution.workspaceId], let index = executions.firstIndex(where: { $0.id == execution.id }) else { return }
        executions[index] = execution
        executionsByWorkspace[execution.workspaceId] = executions
    }

    // MARK: - Productivity Intelligence pure helpers (mirror backend/src/insights/taskAnalysis.ts and workspaceInsightsService.ts)

    private static let defaultDueSoonWindow: TimeInterval = 3 * 24 * 60 * 60 // 3 days
    private static let activeWorkflowRunStatuses: Set<WorkflowRunStatus> = [.pending, .running, .awaitingApproval, .paused]

    private static func isOpenTask(_ task: TaskItem) -> Bool {
        task.status == .todo || task.status == .inProgress
    }

    private static func scoreTaskPriority(_ task: TaskItem, now: Date, dueSoonWindow: TimeInterval) -> Double {
        var score: Double
        switch task.priority {
        case .high: score = 30
        case .medium: score = 20
        case .low: score = 10
        }

        if let dueDate = task.dueDate.flatMap({ ISO8601DateFormatter().date(from: $0) }) {
            let secondsUntilDue = dueDate.timeIntervalSince(now)
            if secondsUntilDue < 0 {
                score += 1000 + min(-secondsUntilDue / 3600, 1000)
            } else if secondsUntilDue <= dueSoonWindow {
                score += 500 - secondsUntilDue / 3600
            }
        }

        return score
    }

    private static func rankTasksByPriority(_ tasks: [TaskItem], now: Date, dueSoonWindow: TimeInterval) -> [TaskItem] {
        let formatter = ISO8601DateFormatter()
        return tasks.sorted { lhs, rhs in
            let lhsScore = scoreTaskPriority(lhs, now: now, dueSoonWindow: dueSoonWindow)
            let rhsScore = scoreTaskPriority(rhs, now: now, dueSoonWindow: dueSoonWindow)
            if lhsScore != rhsScore { return lhsScore > rhsScore }

            let lhsDue = lhs.dueDate.flatMap { formatter.date(from: $0) }?.timeIntervalSince1970 ?? .greatestFiniteMagnitude
            let rhsDue = rhs.dueDate.flatMap { formatter.date(from: $0) }?.timeIntervalSince1970 ?? .greatestFiniteMagnitude
            if lhsDue != rhsDue { return lhsDue < rhsDue }

            let lhsCreated = formatter.date(from: lhs.createdAt)?.timeIntervalSince1970 ?? 0
            let rhsCreated = formatter.date(from: rhs.createdAt)?.timeIntervalSince1970 ?? 0
            return lhsCreated < rhsCreated
        }
    }

    private static func findOverdue(_ tasks: [TaskItem], now: Date) -> [TaskItem] {
        let formatter = ISO8601DateFormatter()
        return tasks.filter { task in
            guard let dueDate = task.dueDate.flatMap({ formatter.date(from: $0) }) else { return false }
            return dueDate < now
        }
    }

    private static func findDueSoon(_ tasks: [TaskItem], now: Date, window: TimeInterval) -> [TaskItem] {
        let formatter = ISO8601DateFormatter()
        return tasks.filter { task in
            guard let dueDate = task.dueDate.flatMap({ formatter.date(from: $0) }) else { return false }
            let secondsUntilDue = dueDate.timeIntervalSince(now)
            return secondsUntilDue >= 0 && secondsUntilDue <= window
        }
    }

    private static let taskKeywordStopwords: Set<String> = [
        "the", "and", "for", "with", "from", "this", "that", "about", "into", "over", "after", "before",
        "follow", "up", "review", "update", "send", "draft", "task", "todo",
    ]

    private static func extractKeywords(_ title: String) -> [String] {
        let words = title.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
        var seen = Set<String>()
        var keywords: [String] = []
        for word in words where word.count > 3 && !taskKeywordStopwords.contains(word) {
            if seen.insert(word).inserted {
                keywords.append(word)
            }
        }
        return keywords
    }

    private static func groupRelatedTasks(_ tasks: [TaskItem]) -> [RelatedTaskGroup] {
        var taskIdsByKeyword: [String: [String]] = [:]
        for task in tasks {
            for keyword in extractKeywords(task.title) {
                taskIdsByKeyword[keyword, default: []].append(task.id)
            }
        }

        let groups = taskIdsByKeyword.compactMap { keyword, taskIds -> RelatedTaskGroup? in
            taskIds.count >= 2 ? RelatedTaskGroup(keyword: keyword, taskIds: taskIds) : nil
        }
        return groups.sorted { lhs, rhs in
            lhs.taskIds.count != rhs.taskIds.count ? lhs.taskIds.count > rhs.taskIds.count : lhs.keyword < rhs.keyword
        }
    }

    private static func summarizeTasks(_ tasks: [TaskItem]) -> TaskCompletionMetrics {
        var todo = 0, inProgress = 0, done = 0, cancelled = 0
        for task in tasks {
            switch task.status {
            case .todo: todo += 1
            case .inProgress: inProgress += 1
            case .done: done += 1
            case .cancelled: cancelled += 1
            }
        }
        let total = tasks.count
        return TaskCompletionMetrics(
            total: total, todo: todo, inProgress: inProgress, done: done, cancelled: cancelled,
            completionRate: total > 0 ? Double(done) / Double(total) : 0
        )
    }

    private static func summarizeApprovals(_ statuses: [ApprovalStatus]) -> ApprovalMetrics {
        var pending = 0, approved = 0, rejected = 0, expired = 0
        for status in statuses {
            switch status {
            case .pending: pending += 1
            case .approved: approved += 1
            case .rejected: rejected += 1
            case .expired: expired += 1
            }
        }
        return ApprovalMetrics(total: statuses.count, pending: pending, approved: approved, rejected: rejected, expired: expired)
    }

    private static func summarizeWorkflowRuns(_ runs: [WorkflowRun]) -> WorkflowMetrics {
        var byStatus = Dictionary(uniqueKeysWithValues: WorkflowRunStatus.allCases.map { ($0.rawValue, 0) })
        for run in runs {
            byStatus[run.status.rawValue, default: 0] += 1
        }
        let activeRuns = runs.filter { activeWorkflowRunStatuses.contains($0.status) }.count
        return WorkflowMetrics(totalRuns: runs.count, activeRuns: activeRuns, completedRuns: byStatus["completed"] ?? 0, byStatus: byStatus)
    }

    private static let seedRelatedMemories: [RankedMemoryResult] = [
        RankedMemoryResult(
            id: "mock-memory-1", workspaceId: "mock-ws-rcs", scope: .workspace,
            content: "Acme's project timeline was pushed back two weeks last quarter.",
            source: nil, conversationId: nil, projectKey: nil, metadata: [:],
            createdAt: "2026-01-01T00:00:00.000Z", score: 0.82
        ),
    ]

    private static let seedPatterns: [Pattern] = [
        Pattern(
            workspaceId: "mock-ws-rcs", type: .frequentWorkflow,
            description: "The \"daily_workspace_briefing\" workflow has been run 3 times.",
            confidence: 0.75, occurrences: 3,
            detectedAt: "2026-01-01T00:00:00.000Z",
            metadata: ["workflowKey": .string("daily_workspace_briefing")]
        ),
    ]

    private static let seedSuggestions: [Suggestion] = [
        Suggestion(
            id: "workflow:daily_workspace_briefing", workspaceId: "mock-ws-rcs", type: .workflow,
            title: "Run \"daily_workspace_briefing\" again",
            explanation: "The \"daily_workspace_briefing\" workflow has been run 3 times.",
            confidence: 0.75, source: "frequent_workflow_pattern",
            timestamp: "2026-01-01T00:00:00.000Z",
            payload: ["workflowKey": .string("daily_workspace_briefing")]
        ),
        Suggestion(
            id: "integration:calendar", workspaceId: "mock-ws-rcs", type: .integration,
            title: "Connect Calendar",
            explanation: "Calendar isn't connected yet — connecting it lets AIMA read and, with your approval, act on that account.",
            confidence: 0.3, source: "integration_not_connected",
            timestamp: "2026-01-01T00:00:00.000Z",
            payload: ["provider": .string("calendar")]
        ),
    ]

    private static let seedSearchResults: [SearchResult] = [
        SearchResult(
            id: "mock-embedding-1", workspaceId: "mock-ws-rcs", sourceType: .conversation,
            sourceId: "mock-conversation-1", chunkIndex: 0,
            content: "user: Can we schedule a call with the client this week?",
            embeddingVersion: 1, indexedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
            score: 0.79
        ),
        SearchResult(
            id: "mock-embedding-2", workspaceId: "mock-ws-rcs", sourceType: .task,
            sourceId: "mock-task-1", chunkIndex: 0,
            content: "Schedule client call\n\nCoordinate with the client on timing.",
            embeddingVersion: 1, indexedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
            score: 0.74
        ),
    ]

    private func findWorkflowRun(workspaceId: String, runId: String) throws -> WorkflowRunDetail {
        guard let run = (workflowRunsByWorkspace[workspaceId] ?? []).first(where: { $0.id == runId }) else {
            throw APIError.server(statusCode: 404, message: "Workflow run not found: \(runId)")
        }
        return run
    }

    private func saveWorkflowRun(_ run: WorkflowRunDetail, workspaceId: String) {
        guard var runs = workflowRunsByWorkspace[workspaceId], let index = runs.firstIndex(where: { $0.id == run.id }) else { return }
        runs[index] = run
        workflowRunsByWorkspace[workspaceId] = runs
    }

    /// Mirrors the real `Capabilities` defaults (`backend/src/permissions/registry.ts`): only reading a connected
    /// Gmail inbox is Tier 3 (`execute_with_approval`); the two draft-saving capabilities are Tier 2 (`prepare`)
    /// and auto-execute.
    private func capabilityRequiresApproval(_ capability: String) -> Bool {
        capability == "read_email"
    }

    /// Executes one step's mock effect, mirroring `WorkflowService`'s private `performStep`: marks the step
    /// completed with its output, advances `currentStepIndex`, and — on the last step — completes the run with
    /// that step's output as the run's `result`.
    private func performStep(run: WorkflowRunDetail, stepIndex: Int) -> WorkflowRunDetail {
        let step = run.steps[stepIndex]
        let output = mockStepOutput(stepKey: step.stepKey, input: run.input)
        let completedStep = withStepStatus(step, status: .completed, pendingApprovalId: step.pendingApprovalId, output: output)
        let steps = replacingStep(run.steps, at: stepIndex, with: completedStep)

        let isLastStep = stepIndex == run.steps.count - 1
        if isLastStep {
            return withRunStatus(
                run, status: .completed, currentStepIndex: stepIndex, steps: steps,
                result: output, completedAt: ISO8601DateFormatter().string(from: Date())
            )
        }
        return withRunStatus(run, status: .running, currentStepIndex: stepIndex + 1, steps: steps)
    }

    /// A plausible mock effect for each built-in workflow's step keys — not wired to any real AI provider or
    /// integration, unlike the backend's handlers (`backend/src/workflows/handlers/`).
    private func mockStepOutput(stepKey: String, input: [String: String]) -> [String: JSONValue] {
        switch stepKey {
        case "compose_reply":
            return [
                "subject": .string("Re: \(input["topic"] ?? "your message")"),
                "body": .string("[mock draft] Thanks for your message — here's a suggested reply."),
            ]
        case "compose_issue":
            return [
                "title": .string(input["title"] ?? "Untitled issue"),
                "body": .string("[mock draft] Issue details go here."),
                "repository": .string(input["repository"] ?? "unknown/repo"),
            ]
        case "save_draft":
            return ["draftId": .string(UUID().uuidString)]
        case "read_unread_email":
            return ["messages": .array([.object(["from": .string("client@example.com"), "subject": .string("Project update")])])]
        case "summarize":
            return [
                "summary": .string("[mock summary] 1 unread message about a project update."),
                "messageCount": .number(1),
            ]
        case "gather_snapshot":
            let openTasks = tasksByWorkspace.values.flatMap { $0 }.filter { $0.status != .done }.count
            let pendingApprovals = approvalsByWorkspace.values.flatMap { $0 }.filter { $0.status == .pending }.count
            return [
                "openTaskCount": .number(Double(openTasks)),
                "pendingApprovalCount": .number(Double(pendingApprovals)),
                "systemHealthy": .bool(true),
            ]
        case "compose_briefing":
            return ["briefing": .string("[mock briefing] Here's your daily summary.")]
        default:
            return [:]
        }
    }

    private func withStepStatus(_ step: WorkflowStepRun, status: WorkflowStepStatus, pendingApprovalId: String?, output: [String: JSONValue]?) -> WorkflowStepRun {
        WorkflowStepRun(
            id: step.id, workflowRunId: step.workflowRunId, stepIndex: step.stepIndex, stepKey: step.stepKey,
            status: status, capability: step.capability, pendingApprovalId: pendingApprovalId, output: output,
            createdAt: step.createdAt, updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private func withRunStatus(
        _ run: WorkflowRunDetail,
        status: WorkflowRunStatus,
        currentStepIndex: Int? = nil,
        steps: [WorkflowStepRun]? = nil,
        result: [String: JSONValue]? = nil,
        completedAt: String? = nil
    ) -> WorkflowRunDetail {
        WorkflowRunDetail(
            id: run.id, workspaceId: run.workspaceId, workflowKey: run.workflowKey, status: status,
            currentStepIndex: currentStepIndex ?? run.currentStepIndex, input: run.input,
            result: result ?? run.result,
            createdAt: run.createdAt, updatedAt: ISO8601DateFormatter().string(from: Date()),
            completedAt: completedAt ?? run.completedAt,
            steps: steps ?? run.steps
        )
    }

    private func replacingStep(_ steps: [WorkflowStepRun], at index: Int, with step: WorkflowStepRun) -> [WorkflowStepRun] {
        var copy = steps
        copy[index] = step
        return copy
    }

    /// Moves a conversation to the end of insertion order so `listConversations`'s `.reversed()` surfaces it first — approximating `sequence`-based recency without real timestamps.
    private func touchConversation(_ conversationId: String) {
        guard let index = conversations.firstIndex(where: { $0.id == conversationId }) else { return }
        let conversation = conversations.remove(at: index)
        conversations.append(conversation)
    }

    private func withDisplayName(_ profile: UserProfile, _ displayName: String) -> UserProfile {
        UserProfile(
            id: profile.id, email: profile.email, displayName: displayName,
            preferences: profile.preferences, communicationStyle: profile.communicationStyle,
            defaultWorkspaceId: profile.defaultWorkspaceId, createdAt: profile.createdAt,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }
}
