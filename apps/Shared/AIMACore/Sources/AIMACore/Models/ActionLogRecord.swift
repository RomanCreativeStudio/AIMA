import Foundation

/// Mirrors `backend/src/actionLog/logger.ts#ActionLogRecord` (Phase 2.5) —
/// one workspace's logged action, as read back for the Daily Briefing's
/// "recent activity" feed. `tier` is a plain `String`, not a typed enum,
/// matching `IntegrationCapability.tier`'s existing precedent (Phase 2.3).
public struct ActionLogRecord: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    /// Null when the action wasn't gated by any capability (e.g. an internal workflow step).
    public let actionType: String?
    public let tier: String
    public let summary: String
    public let payload: JSONValue?
    public let outcome: ActionOutcome
    public let createdAt: String

    public init(
        id: String,
        workspaceId: String,
        actionType: String?,
        tier: String,
        summary: String,
        payload: JSONValue?,
        outcome: ActionOutcome,
        createdAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.actionType = actionType
        self.tier = tier
        self.summary = summary
        self.payload = payload
        self.outcome = outcome
        self.createdAt = createdAt
    }
}

/// Mirrors `backend/src/actionLog/logger.ts#ActionLogEntry['outcome']`.
public enum ActionOutcome: String, Codable, Sendable {
    case success
    case failure
}
