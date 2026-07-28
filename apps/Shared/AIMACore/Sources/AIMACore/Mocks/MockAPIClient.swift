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

    /// Set by `forceNextMessageToRequireApproval`, consumed by the next
    /// `sendMessage` call — lets tests exercise the Chat screen's approval
    /// card (Phase 2.2) without a real Tier 3 capability being promoted yet
    /// (`backend/README.md`'s "what's intentionally not built yet").
    private var forcedNextApprovalId: String?

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
                    connectedAt: nil, lastValidatedAt: nil, createdAt: "", updatedAt: "",
                    displayName: "Gmail",
                    description: "Read-only access to Gmail messages, plus preparing drafts for review before anything is sent.",
                    capabilities: [
                        IntegrationCapability(actionType: "read_email", tier: "execute_with_approval"),
                        IntegrationCapability(actionType: "draft_gmail_email", tier: "execute_with_approval"),
                    ],
                    requiredCredentialFields: ["accessToken", "refreshToken"]
                ),
                WorkspaceIntegration(
                    workspaceId: rcs.id, provider: .github, enabled: true, status: .connected,
                    connectedAt: now, lastValidatedAt: now, createdAt: now, updatedAt: now,
                    displayName: "GitHub",
                    description: "Read-only access to repositories and issues.",
                    capabilities: [IntegrationCapability(actionType: "read_repositories", tier: "execute_with_approval")],
                    requiredCredentialFields: ["accessToken"]
                ),
                WorkspaceIntegration(
                    workspaceId: rcs.id, provider: .calendar, enabled: false, status: .disconnected,
                    connectedAt: nil, lastValidatedAt: nil, createdAt: "", updatedAt: "",
                    displayName: "Calendar",
                    description: "Read-only access to calendar events.",
                    capabilities: [IntegrationCapability(actionType: "read_calendar", tier: "execute_with_approval")],
                    requiredCredentialFields: ["accessToken", "refreshToken"]
                ),
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
        return SystemHealth(status: "ok", timestamp: ISO8601DateFormatter().string(from: Date()), checks: .init(database: ok, aiProvider: .init(status: "ok", detail: "mock"), memory: ok, knowledge: ok))
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

        return SendMessageResult(
            userMessage: userMessage,
            assistantMessage: assistantMessage,
            retrievedMemories: [],
            retrievedDocumentChunks: [],
            intent: intent,
            approvalDecision: approvalDecision
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
            connectedAt: now, lastValidatedAt: now,
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
            connectedAt: existing.connectedAt, lastValidatedAt: existing.lastValidatedAt,
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
            connectedAt: existing.connectedAt, lastValidatedAt: now,
            createdAt: existing.createdAt, updatedAt: now,
            displayName: existing.displayName, description: existing.description, capabilities: existing.capabilities,
            requiredCredentialFields: existing.requiredCredentialFields
        )
        integrationsByWorkspace[workspaceId] = integrations
        return integrations[index]
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
