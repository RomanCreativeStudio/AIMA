import Foundation

/// Mirrors `backend/src/proactive/types.ts#SuggestionType`.
public enum SuggestionType: String, Codable, Sendable {
    case workflow
    case execution
    case memory
    case task
    case integration
}

/// Mirrors `backend/src/proactive/types.ts#Suggestion` (Phase 3.5, item 4) — the unified, advisory suggestion
/// shape the Proactive Intelligence Engine returns. Never itself creates, executes, or sends anything; it only
/// describes what a user could do next, with `explanation`/`source`/`confidence`/`timestamp` for
/// explainability (docs/decisions/0020-proactive-intelligence.md).
public struct Suggestion: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let type: SuggestionType
    public let title: String
    public let explanation: String
    public let confidence: Double
    public let source: String
    public let timestamp: String
    public let payload: [String: JSONValue]

    public init(
        id: String,
        workspaceId: String,
        type: SuggestionType,
        title: String,
        explanation: String,
        confidence: Double,
        source: String,
        timestamp: String,
        payload: [String: JSONValue]
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.type = type
        self.title = title
        self.explanation = explanation
        self.confidence = confidence
        self.source = source
        self.timestamp = timestamp
        self.payload = payload
    }
}
