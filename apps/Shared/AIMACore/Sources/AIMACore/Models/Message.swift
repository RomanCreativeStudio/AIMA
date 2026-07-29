import Foundation

/// Mirrors `backend/src/conversation/types.ts#MessageRole`.
public enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
    case system
}

/// Mirrors `backend/src/conversation/types.ts#Message`.
public struct Message: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let conversationId: String
    public let workspaceId: String
    public let role: MessageRole
    public let content: String
    public let createdAt: String

    public init(
        id: String,
        conversationId: String,
        workspaceId: String,
        role: MessageRole,
        content: String,
        createdAt: String
    ) {
        self.id = id
        self.conversationId = conversationId
        self.workspaceId = workspaceId
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

/// The advisory "would this need approval" flag (Phase 1.7) — mirrors
/// `backend/src/intent/types.ts#ApprovalRequirement`. Distinct from
/// `ApprovalStatus` (the real, DB-backed lifecycle).
public enum ApprovalRequirement: String, Codable, Sendable {
    case noApprovalNeeded = "no_approval_needed"
    case approvalRequired = "approval_required"
}

/// Mirrors `backend/src/intent/types.ts#IntentAnalysis`.
public struct IntentAnalysis: Codable, Equatable, Sendable {
    public let intent: String
    public let confidence: Double
    public let parameters: [String: String]
    public let approval: ApprovalRequirement
    public let suggestedNextAction: String

    public init(
        intent: String,
        confidence: Double,
        parameters: [String: String],
        approval: ApprovalRequirement,
        suggestedNextAction: String
    ) {
        self.intent = intent
        self.confidence = confidence
        self.parameters = parameters
        self.approval = approval
        self.suggestedNextAction = suggestedNextAction
    }
}

/// Mirrors `backend/src/conversation/types.ts#SendMessageResult` (the
/// response of `POST .../conversations/:id/messages`). `retrievedMemories`
/// and `retrievedDocumentChunks` are kept as loosely-typed `JSONValue`
/// arrays — this phase's UI only surfaces messages/intent/approval, not the
/// full ranked-retrieval shape, so a fixed struct for them would be
/// speculative.
public struct SendMessageResult: Codable, Sendable {
    public let userMessage: Message
    public let assistantMessage: Message
    public let retrievedMemories: [JSONValue]
    public let retrievedDocumentChunks: [JSONValue]
    public let intent: IntentAnalysis
    public let approvalDecision: ApprovalDecision
    /// An advisory workflow preview (Phase 2.4), present when the message matched one of the built-in workflows. Never itself creates or executes a run.
    public let workflowSuggestion: WorkflowSuggestion?
    /// An advisory execution preview (Phase 2.6), present when the message matched a real external action. Never itself creates or runs an execution.
    public let executionSuggestion: ExecutionSuggestion?
    /// Advisory candidate memories detected in the user's message (Phase 3.4) — never persisted automatically;
    /// the user must explicitly save one via the memory creation endpoint. Empty when nothing was detected.
    public let memorySuggestions: [MemorySuggestion]
    /// Semantically retrieved context for this turn — merged memories, related conversations, and related tasks
    /// (Phase 3.6). Purely advisory: never wired into the AI prompt itself, never writes anything. `nil` when
    /// no `RetrievalService` was configured server-side.
    public let retrievedContext: RetrievedContext?

    public init(
        userMessage: Message,
        assistantMessage: Message,
        retrievedMemories: [JSONValue],
        retrievedDocumentChunks: [JSONValue],
        intent: IntentAnalysis,
        approvalDecision: ApprovalDecision,
        workflowSuggestion: WorkflowSuggestion?,
        executionSuggestion: ExecutionSuggestion?,
        memorySuggestions: [MemorySuggestion] = [],
        retrievedContext: RetrievedContext? = nil
    ) {
        self.userMessage = userMessage
        self.assistantMessage = assistantMessage
        self.retrievedMemories = retrievedMemories
        self.retrievedDocumentChunks = retrievedDocumentChunks
        self.intent = intent
        self.approvalDecision = approvalDecision
        self.workflowSuggestion = workflowSuggestion
        self.executionSuggestion = executionSuggestion
        self.memorySuggestions = memorySuggestions
        self.retrievedContext = retrievedContext
    }

    private enum CodingKeys: String, CodingKey {
        case userMessage, assistantMessage, retrievedMemories, retrievedDocumentChunks, intent, approvalDecision
        case workflowSuggestion, executionSuggestion, memorySuggestions, retrievedContext
    }

    /// Custom decode so a payload from before Phase 3.4 (missing `memorySuggestions` entirely) still decodes,
    /// defaulting to an empty array — the same backward-compatible-decode posture as `MemoryRecord`'s new fields.
    /// `retrievedContext` (Phase 3.6) is similarly optional, decoding to `nil` when absent.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userMessage = try container.decode(Message.self, forKey: .userMessage)
        assistantMessage = try container.decode(Message.self, forKey: .assistantMessage)
        retrievedMemories = try container.decode([JSONValue].self, forKey: .retrievedMemories)
        retrievedDocumentChunks = try container.decode([JSONValue].self, forKey: .retrievedDocumentChunks)
        intent = try container.decode(IntentAnalysis.self, forKey: .intent)
        approvalDecision = try container.decode(ApprovalDecision.self, forKey: .approvalDecision)
        workflowSuggestion = try container.decodeIfPresent(WorkflowSuggestion.self, forKey: .workflowSuggestion)
        executionSuggestion = try container.decodeIfPresent(ExecutionSuggestion.self, forKey: .executionSuggestion)
        memorySuggestions = try container.decodeIfPresent([MemorySuggestion].self, forKey: .memorySuggestions) ?? []
        retrievedContext = try container.decodeIfPresent(RetrievedContext.self, forKey: .retrievedContext)
    }
}
