import Foundation

/// Mirrors `backend/src/proactive/types.ts#PatternType`.
public enum PatternType: String, Codable, Sendable {
    case repeatedTask = "repeated_task"
    case frequentWorkflow = "frequent_workflow"
    case recurringApproval = "recurring_approval"
    case missedDeadline = "missed_deadline"
    case activityTrend = "activity_trend"
    case memoryUsageTrend = "memory_usage_trend"
}

/// Mirrors `backend/src/proactive/types.ts#Pattern` (Phase 3.5, item 3) — one deterministically-detected pattern
/// in a workspace's existing data, with a confidence score. No ML, no training; `Suggestion`s are the curated,
/// actionable subset of these (docs/decisions/0020-proactive-intelligence.md).
public struct Pattern: Codable, Identifiable, Equatable, Sendable {
    public let workspaceId: String
    public let type: PatternType
    public let description: String
    public let confidence: Double
    public let occurrences: Int
    public let detectedAt: String
    public let metadata: [String: JSONValue]

    /// Not a server-assigned id — `detectPatterns()` recomputes patterns fresh on every call rather than
    /// persisting them, so this is only a stable-enough key for a single response's `ForEach`.
    public var id: String { "\(type.rawValue):\(detectedAt):\(description)" }

    public init(
        workspaceId: String,
        type: PatternType,
        description: String,
        confidence: Double,
        occurrences: Int,
        detectedAt: String,
        metadata: [String: JSONValue]
    ) {
        self.workspaceId = workspaceId
        self.type = type
        self.description = description
        self.confidence = confidence
        self.occurrences = occurrences
        self.detectedAt = detectedAt
        self.metadata = metadata
    }
}
