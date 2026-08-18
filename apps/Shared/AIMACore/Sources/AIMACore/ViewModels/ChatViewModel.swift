import Foundation
import Observation

/// Backs the Chat screen (Phase 2.1, item 2): conversation list, message
/// history for the selected conversation, and sending a new message.
/// Scoped to one workspace at a time — switching workspaces means
/// constructing (or reloading) a `ChatViewModel` for the new workspace,
/// the same isolation boundary the backend enforces server-side. Uses
/// `@Observable` (not Combine's `ObservableObject`) so this package stays
/// Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class ChatViewModel {
    public private(set) var conversations: [Conversation] = []
    public private(set) var selectedConversationId: String?
    public private(set) var messages: [Message] = []
    public var draftMessage: String = ""
    public private(set) var isLoadingConversations = false
    public private(set) var isSending = false
    public private(set) var errorMessage: String?
    public private(set) var lastIntent: IntentAnalysis?
    public private(set) var lastApprovalDecision: ApprovalDecision?
    /// The full approval record for `lastApprovalDecision`, when it refers to
    /// a real one (Phase 2.2's chat approval card) — fetched separately
    /// since `SendMessageResult.approvalDecision` only carries an id, not
    /// the full `PendingApproval` (action type, payload, expiry) a card
    /// needs to render.
    public private(set) var lastPendingApproval: PendingApproval?
    /// An advisory workflow preview (Phase 2.4) for the most recent reply — never itself a running `WorkflowRun`, just a suggestion the user can act on from the Workflows screen.
    public private(set) var lastWorkflowSuggestion: WorkflowSuggestion?
    /// An advisory execution preview (Phase 2.6) for the most recent reply — never itself a running `ExecutionRecord`, just a suggestion the user can act on from the Executions screen.
    public private(set) var lastExecutionSuggestion: ExecutionSuggestion?
    /// Advisory actionable items detected in the most recent reply (Conversation → Action sprint: todo/follow-up/
    /// reminder/meeting/decision) — never persisted automatically. Accepting one (`acceptActionSuggestion`) goes
    /// through the existing `createTask` API call; dismissing one (`dismissActionSuggestion`) just removes it
    /// from this array, no API call at all — "Dismiss → no persistence."
    public private(set) var lastActionSuggestions: [ActionSuggestion] = []
    /// The selected conversation's Conversation Intelligence (Phase 2.5, item 3) — summary, suggested follow-ups, and related memories. Fetched only on explicit request (`loadConversationIntelligence`), never automatically, matching the phase's "no automatic actions" rule.
    public private(set) var conversationIntelligence: ConversationIntelligence?
    public private(set) var isLoadingIntelligence = false
    /// Advisory recommendation cards for the active workspace (Phase 3.5, item 8) — workspace-scoped, not tied
    /// to any single message, so it isn't reset on `selectConversation`. Fetched only on explicit request
    /// (`loadWorkspaceSuggestions`), never automatically — the same "no automatic actions" rule
    /// `loadConversationIntelligence` follows, and never itself creates/executes/sends anything.
    public private(set) var workspaceSuggestions: [Suggestion] = []
    public private(set) var isLoadingSuggestions = false
    /// The most recent reply's retrieved context (Phase 3.6) — merged memories, related conversations, and
    /// related tasks. Purely advisory/display: it played no part in generating the reply, and is `nil` when
    /// the backend has no `RetrievalService` configured. Reset on `selectConversation` like the other
    /// per-turn advisory fields.
    public private(set) var lastRetrievedContext: RetrievedContext?
    /// Context Assembly Engine sprint: how many memories/tasks/decisions were actually injected into the most
    /// recent reply's system prompt — counts only (`SendMessageResult.retrievedMemories`/`contextTasks`/
    /// `contextDecisions` are loosely-typed `[JSONValue]`, so `.count` is all this phase's UI needs). Backs the
    /// debug-only "Context Used" section; reset on `selectConversation` like the other per-turn advisory fields.
    public private(set) var lastContextMemoriesUsedCount = 0
    public private(set) var lastContextTasksUsedCount = 0
    public private(set) var lastContextDecisionsUsedCount = 0

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func loadConversations() async {
        isLoadingConversations = true
        errorMessage = nil
        defer { isLoadingConversations = false }

        do {
            conversations = try await apiClient.listConversations(workspaceId: workspaceId)
            if selectedConversationId == nil, let first = conversations.first {
                await selectConversation(first.id)
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func startNewConversation(title: String? = nil) async {
        do {
            let conversation = try await apiClient.createConversation(workspaceId: workspaceId, title: title)
            conversations.insert(conversation, at: 0)
            await selectConversation(conversation.id)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func selectConversation(_ conversationId: String) async {
        selectedConversationId = conversationId
        errorMessage = nil
        // A different conversation means the previous turn's intent/approval
        // banner and approval card no longer apply — leaving them in place
        // would show stale, wrongly-scoped state over the newly loaded history.
        lastIntent = nil
        lastApprovalDecision = nil
        lastPendingApproval = nil
        lastWorkflowSuggestion = nil
        lastExecutionSuggestion = nil
        lastActionSuggestions = []
        conversationIntelligence = nil
        lastRetrievedContext = nil
        lastContextMemoriesUsedCount = 0
        lastContextTasksUsedCount = 0
        lastContextDecisionsUsedCount = 0
        do {
            messages = try await apiClient.listMessages(workspaceId: workspaceId, conversationId: conversationId, limit: nil)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func sendDraftMessage() async {
        let content = draftMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, let conversationId = selectedConversationId, !isSending else { return }

        isSending = true
        errorMessage = nil
        defer { isSending = false }

        do {
            let result = try await apiClient.sendMessage(workspaceId: workspaceId, conversationId: conversationId, content: content)
            messages.append(contentsOf: [result.userMessage, result.assistantMessage])
            lastIntent = result.intent
            lastApprovalDecision = result.approvalDecision
            lastPendingApproval = nil
            lastWorkflowSuggestion = result.workflowSuggestion
            lastExecutionSuggestion = result.executionSuggestion
            lastActionSuggestions = result.actionSuggestions
            lastRetrievedContext = result.retrievedContext
            lastContextMemoriesUsedCount = result.retrievedMemories.count
            lastContextTasksUsedCount = result.contextTasks.count
            lastContextDecisionsUsedCount = result.contextDecisions.count
            if let approvalId = result.approvalDecision.pendingApprovalId {
                lastPendingApproval = try? await apiClient.getApproval(workspaceId: workspaceId, approvalId: approvalId)
            }
            draftMessage = ""

            // A reply is the same "recently active" signal the backend
            // uses to reorder its own list — move this conversation to the
            // top locally rather than re-fetching the whole list.
            if let index = conversations.firstIndex(where: { $0.id == conversationId }) {
                let conversation = conversations.remove(at: index)
                conversations.insert(conversation, at: 0)
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Accept an action suggestion (Conversation → Action sprint): creates a real task via the same
    /// `createTask` API call a hand-typed task would use — `source: "conversation_suggestion"` and
    /// `metadata.category` record where it came from, so `BriefingService`/`DailyBriefing` can surface it
    /// as an accepted task. Never bypasses `PermissionEngine`/`ApprovalEngine`: it's the identical route the
    /// Tasks screen's "Add Task" button hits. Removes the suggestion from `lastActionSuggestions` on success
    /// so the card disappears once acted on.
    public func acceptActionSuggestion(_ suggestion: ActionSuggestion) async {
        errorMessage = nil
        do {
            _ = try await apiClient.createTask(
                workspaceId: workspaceId,
                request: CreateTaskRequest(
                    title: suggestion.content,
                    source: "conversation_suggestion",
                    metadata: ["category": .string(suggestion.category.rawValue)]
                )
            )
            lastActionSuggestions.removeAll { $0 == suggestion }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Dismiss an action suggestion (Conversation → Action sprint): no API call at all — "Dismiss → no
    /// persistence" means there's nothing to tell the backend, since nothing was ever saved. Just removes
    /// the card from local state.
    public func dismissActionSuggestion(_ suggestion: ActionSuggestion) {
        lastActionSuggestions.removeAll { $0 == suggestion }
    }

    /// Accept a "completed" suggestion (Executive Assistant Loop sprint): closes the matched task via the
    /// existing `updateTask` API call — the same route the Tasks screen's status picker uses. No duplicate
    /// task-closing logic.
    public func completeActionSuggestion(_ suggestion: ActionSuggestion) async {
        await applyTaskUpdate(for: suggestion, request: UpdateTaskRequest(status: .done))
    }

    /// Accept a "postponed" suggestion: pushes the matched task's due date out by a fixed 7 days (client-side
    /// default — no date-parsing needed on either side) via `updateTask`, and tags `metadata.category` so
    /// `DailyBriefing.postponedItems` can surface it later.
    public func postponeActionSuggestion(_ suggestion: ActionSuggestion) async {
        let newDueDate = ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 24 * 60 * 60))
        await applyTaskUpdate(
            for: suggestion,
            request: UpdateTaskRequest(dueDate: newDueDate, metadata: ["category": .string("postponed")])
        )
    }

    /// Accept a "blocked" suggestion: metadata only — tags `metadata.category` on the matched task via
    /// `updateTask`, without touching `status`/`dueDate`.
    public func blockActionSuggestion(_ suggestion: ActionSuggestion) async {
        await applyTaskUpdate(for: suggestion, request: UpdateTaskRequest(metadata: ["category": .string("blocked")]))
    }

    /// Accept a "delegated" suggestion: metadata only — tags `metadata.category` on the matched task via
    /// `updateTask`, without touching `status`/`dueDate`.
    public func delegateActionSuggestion(_ suggestion: ActionSuggestion) async {
        await applyTaskUpdate(for: suggestion, request: UpdateTaskRequest(metadata: ["category": .string("delegated")]))
    }

    /// Shared plumbing for the 4 task-referencing accept actions above: resolves `suggestion.matchedTaskId`,
    /// calls `updateTask`, and removes the card from `lastActionSuggestions` on success.
    private func applyTaskUpdate(for suggestion: ActionSuggestion, request: UpdateTaskRequest) async {
        errorMessage = nil
        guard let taskId = suggestion.matchedTaskId else {
            errorMessage = "No matching task found for this suggestion."
            return
        }
        do {
            _ = try await apiClient.updateTask(workspaceId: workspaceId, taskId: taskId, request: request)
            lastActionSuggestions.removeAll { $0 == suggestion }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Resolves the chat approval card (Phase 2.2, item 3) in place — the
    /// same action the Approvals/Dashboard screens perform, just reachable
    /// without leaving the conversation.
    public func approveLastApproval() async {
        await resolveLastApproval { client, workspaceId, approvalId in
            try await client.approveApproval(workspaceId: workspaceId, approvalId: approvalId)
        }
    }

    public func rejectLastApproval() async {
        await resolveLastApproval { client, workspaceId, approvalId in
            try await client.rejectApproval(workspaceId: workspaceId, approvalId: approvalId)
        }
    }

    /// Fetches Conversation Intelligence (Phase 2.5, item 3) for the selected conversation — a summary, suggested
    /// follow-ups, and related memories. Purely a read: never creates a message, memory, or anything else.
    /// Explicit-only by design ("no automatic actions"), so this is never called from `selectConversation`/
    /// `sendDraftMessage` — a view must call it itself, e.g. from a button.
    public func loadConversationIntelligence() async {
        guard let conversationId = selectedConversationId else { return }
        isLoadingIntelligence = true
        errorMessage = nil
        defer { isLoadingIntelligence = false }

        do {
            conversationIntelligence = try await apiClient.getConversationIntelligence(workspaceId: workspaceId, conversationId: conversationId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fetches the Proactive Intelligence Engine's suggestions (Phase 3.5) for this workspace — a summary read,
    /// same posture as `loadConversationIntelligence`. Never creates, executes, or sends anything; a view
    /// renders these as dismissible advisory cards, not a popup or notification.
    public func loadWorkspaceSuggestions() async {
        isLoadingSuggestions = true
        errorMessage = nil
        defer { isLoadingSuggestions = false }

        do {
            workspaceSuggestions = try await apiClient.getProactiveSuggestions(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func resolveLastApproval(
        _ action: (APIClient, String, String) async throws -> ApprovalDecision
    ) async {
        guard let approval = lastPendingApproval else { return }
        errorMessage = nil
        do {
            let decision = try await action(apiClient, workspaceId, approval.id)
            lastApprovalDecision = decision
            lastPendingApproval = nil
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
