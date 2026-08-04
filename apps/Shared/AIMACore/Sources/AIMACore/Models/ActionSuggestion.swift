import Foundation

/// Mirrors `backend/src/conversation/actionSuggestions.ts#ActionSuggestionCategory` (Conversation → Action
/// sprint). `reminder`/`decision` are reused from the memory-extraction pipeline rather than re-detected —
/// see that file's doc comment — but still appear here since the backend reports them structurally.
public enum ActionSuggestionCategory: String, Codable, Sendable {
    case todo
    case followUp = "follow_up"
    case reminder
    case meeting
    case decision
}

/// Mirrors `backend/src/conversation/actionSuggestions.ts#ActionSuggestion` — an advisory, never-auto-persisted
/// suggestion attached to `SendMessageResult.actionSuggestions`. Accepting one goes through the existing
/// `createTask` API call (same as a hand-typed task); dismissing one is simply not calling it — there is no
/// dismiss endpoint, matching "Dismiss → no persistence."
public struct ActionSuggestion: Codable, Equatable, Sendable {
    public let content: String
    public let category: ActionSuggestionCategory
    public let confidence: Double
    public let reason: String

    public init(content: String, category: ActionSuggestionCategory, confidence: Double, reason: String) {
        self.content = content
        self.category = category
        self.confidence = confidence
        self.reason = reason
    }
}
