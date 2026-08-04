import Foundation

/// Mirrors `backend/src/conversation/actionSuggestions.ts#ActionSuggestionCategory` (Conversation → Action
/// sprint). `reminder`/`decision`/`completedTask` are reused from the memory-extraction pipeline rather than
/// re-detected — see that file's doc comment — but still appear here since the backend reports them
/// structurally. `blocked`/`postponed`/`delegated` are Executive Assistant Loop sprint additions.
public enum ActionSuggestionCategory: String, Codable, Sendable {
    case todo
    case followUp = "follow_up"
    case reminder
    case meeting
    case decision
    case completedTask = "completed_task"
    case blocked
    case postponed
    case delegated
}

/// Mirrors `backend/src/conversation/actionSuggestions.ts#ActionSuggestion` — an advisory, never-auto-persisted
/// suggestion attached to `SendMessageResult.actionSuggestions`. Accepting one goes through the existing
/// `createTask`/`updateTask` API calls (same as a hand-typed task); dismissing one is simply not calling it —
/// there is no dismiss endpoint, matching "Dismiss → no persistence."
public struct ActionSuggestion: Codable, Equatable, Sendable {
    public let content: String
    public let category: ActionSuggestionCategory
    public let confidence: Double
    public let reason: String
    /// Executive Assistant Loop sprint: the open task `content` most likely refers to (keyword-overlap match,
    /// computed server-side) — populated only for the 4 task-referencing categories (`completedTask`/
    /// `blocked`/`postponed`/`delegated`). `nil` otherwise, or when no open task matched. Optional so a
    /// pre-Executive-Assistant-Loop payload missing this key still decodes (synthesized `Decodable` treats an
    /// `Optional` stored property as absent-tolerant automatically — no custom decoder needed).
    public let matchedTaskId: String?

    public init(content: String, category: ActionSuggestionCategory, confidence: Double, reason: String, matchedTaskId: String? = nil) {
        self.content = content
        self.category = category
        self.confidence = confidence
        self.reason = reason
        self.matchedTaskId = matchedTaskId
    }
}
