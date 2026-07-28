import Foundation

/// Mirrors `backend/src/insights/types.ts#ConversationIntelligence` (Phase
/// 2.5, item 3), returned by
/// `GET /api/workspaces/:id/conversations/:conversationId/intelligence`.
/// Unlike `TaskIntelligence`, `summary`/`suggestedFollowUps` genuinely need
/// the AI provider on the backend — there's no deterministic substitute.
/// Purely advisory: fetching this never creates a message, memory, or
/// anything else.
public struct ConversationIntelligence: Codable, Equatable, Sendable {
    public let workspaceId: String
    public let conversationId: String
    public let summary: String
    public let suggestedFollowUps: [String]
    public let recentContext: [Message]
    public let relatedMemories: [RankedMemoryResult]
    public let generatedAt: String

    public init(
        workspaceId: String,
        conversationId: String,
        summary: String,
        suggestedFollowUps: [String],
        recentContext: [Message],
        relatedMemories: [RankedMemoryResult],
        generatedAt: String
    ) {
        self.workspaceId = workspaceId
        self.conversationId = conversationId
        self.summary = summary
        self.suggestedFollowUps = suggestedFollowUps
        self.recentContext = recentContext
        self.relatedMemories = relatedMemories
        self.generatedAt = generatedAt
    }
}
