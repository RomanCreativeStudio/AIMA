import Foundation

/// Mirrors `backend/src/memory/types.ts#MemoryScope`.
public enum MemoryScope: String, Codable, Sendable {
    case user
    case workspace
    case conversation
    case project
}

/// Mirrors `backend/src/memory/types.ts#MemoryRecord`. Not needed before
/// Phase 2.5 — `SendMessageResult.retrievedMemories` deliberately stayed a
/// loosely-typed `[JSONValue]` (Phase 2.1) since nothing rendered it
/// structurally yet. Conversation Intelligence's related memories are the
/// first real consumer, so a fixed type is no longer speculative.
public struct MemoryRecord: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let scope: MemoryScope
    public let content: String
    public let source: String?
    public let conversationId: String?
    public let projectKey: String?
    public let metadata: [String: JSONValue]
    public let createdAt: String

    public init(
        id: String,
        workspaceId: String,
        scope: MemoryScope,
        content: String,
        source: String?,
        conversationId: String?,
        projectKey: String?,
        metadata: [String: JSONValue],
        createdAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.scope = scope
        self.content = content
        self.source = source
        self.conversationId = conversationId
        self.projectKey = projectKey
        self.metadata = metadata
        self.createdAt = createdAt
    }
}

/// Mirrors `backend/src/memory/types.ts#RankedMemoryResult` — a `MemoryRecord` plus a similarity `score`. A separate,
/// field-duplicating struct rather than composing `MemoryRecord`, since the backend's `mapRow` spreads the score
/// into the same flat JSON object (the same reason `WorkflowRunDetail` duplicates `WorkflowRun`'s fields).
public struct RankedMemoryResult: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let scope: MemoryScope
    public let content: String
    public let source: String?
    public let conversationId: String?
    public let projectKey: String?
    public let metadata: [String: JSONValue]
    public let createdAt: String
    /// Cosine similarity, typically in [0, 1] for text embeddings — higher is more relevant.
    public let score: Double

    public init(
        id: String,
        workspaceId: String,
        scope: MemoryScope,
        content: String,
        source: String?,
        conversationId: String?,
        projectKey: String?,
        metadata: [String: JSONValue],
        createdAt: String,
        score: Double
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.scope = scope
        self.content = content
        self.source = source
        self.conversationId = conversationId
        self.projectKey = projectKey
        self.metadata = metadata
        self.createdAt = createdAt
        self.score = score
    }
}
