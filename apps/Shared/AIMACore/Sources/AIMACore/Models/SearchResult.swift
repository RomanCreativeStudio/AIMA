import Foundation

/// Mirrors `backend/src/embeddings/types.ts#RankedEmbeddingResult` — one row from `GET .../retrieval/search`,
/// an `EmbeddingRecord` plus a cosine similarity `score`. A separate, field-duplicating struct rather than
/// composing `EmbeddingRecord`, the same reason `RankedMemoryResult` duplicates `MemoryRecord`'s fields
/// (the backend's `mapRow` spreads the score into the same flat JSON object).
public struct SearchResult: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let sourceType: EmbeddingSourceType
    public let sourceId: String
    public let chunkIndex: Int
    public let content: String
    public let embeddingVersion: Int
    public let indexedAt: String
    public let createdAt: String
    /// Cosine similarity, typically in [0, 1] for text embeddings — higher is more relevant.
    public let score: Double

    public init(
        id: String,
        workspaceId: String,
        sourceType: EmbeddingSourceType,
        sourceId: String,
        chunkIndex: Int,
        content: String,
        embeddingVersion: Int,
        indexedAt: String,
        createdAt: String,
        score: Double
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
        self.score = score
    }
}
