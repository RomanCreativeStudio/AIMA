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

    public init(
        userMessage: Message,
        assistantMessage: Message,
        retrievedMemories: [JSONValue],
        retrievedDocumentChunks: [JSONValue],
        intent: IntentAnalysis,
        approvalDecision: ApprovalDecision,
        workflowSuggestion: WorkflowSuggestion?,
        executionSuggestion: ExecutionSuggestion?
    ) {
        self.userMessage = userMessage
        self.assistantMessage = assistantMessage
        self.retrievedMemories = retrievedMemories
        self.retrievedDocumentChunks = retrievedDocumentChunks
        self.intent = intent
        self.approvalDecision = approvalDecision
        self.workflowSuggestion = workflowSuggestion
        self.executionSuggestion = executionSuggestion
    }
}
