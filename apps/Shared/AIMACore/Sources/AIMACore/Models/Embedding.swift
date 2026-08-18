import Foundation

/// Mirrors `backend/src/embeddings/types.ts#EmbeddingSourceType` — the content types the generic `embeddings`
/// table (Phase 3.6, docs/decisions/0021-semantic-search-and-context-retrieval.md) can index. `.memory` is
/// listed for completeness but never actually indexed through this table — `MemoryRecord` already has its own
/// embedding column and retrieval path.
public enum EmbeddingSourceType: String, Codable, Sendable {
    case memory
    case conversation
    case task
    case note
    case document
}

/// Mirrors `backend/src/embeddings/types.ts#EmbeddingRecord` — one indexed chunk.
public struct EmbeddingRecord: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let sourceType: EmbeddingSourceType
    public let sourceId: String
    public let chunkIndex: Int
    public let content: String
    public let embeddingVersion: Int
    public let indexedAt: String
    public let createdAt: String

    public init(
        id: String,
        workspaceId: String,
        sourceType: EmbeddingSourceType,
        sourceId: String,
        chunkIndex: Int,
        content: String,
        embeddingVersion: Int,
        indexedAt: String,
        createdAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.sourceType = sourceType
        self.sourceId = sourceId
        self.chunkIndex = chunkIndex
        self.content = content
        self.embeddingVersion = embeddingVersion
        self.indexedAt = indexedAt
        self.createdAt = createdAt
    }
}

/// Mirrors `backend/src/embeddings/types.ts#IndexResult` — the per-source summary of one re-indexing pass.
public struct IndexResult: Codable, Equatable, Sendable {
    public let sourceType: EmbeddingSourceType
    public let sourceId: String
    public let chunksIndexed: Int
    public let chunksSkipped: Int
    public let chunksDeleted: Int

    public init(sourceType: EmbeddingSourceType, sourceId: String, chunksIndexed: Int, chunksSkipped: Int, chunksDeleted: Int) {
        self.sourceType = sourceType
        self.sourceId = sourceId
        self.chunksIndexed = chunksIndexed
        self.chunksSkipped = chunksSkipped
        self.chunksDeleted = chunksDeleted
    }
}

/// Mirrors `backend/src/embeddings/types.ts#ReindexWorkspaceResult` — the response of `POST .../retrieval/reindex`
/// (a manual, explicitly-triggered action; never run automatically — see `SearchViewModel.reindex`).
public struct ReindexWorkspaceResult: Codable, Equatable, Sendable {
    public let conversations: [IndexResult]
    public let tasks: [IndexResult]

    public init(conversations: [IndexResult], tasks: [IndexResult]) {
        self.conversations = conversations
        self.tasks = tasks
    }
}
