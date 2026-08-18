import Foundation

/// Mirrors `backend/src/embeddings/types.ts#RetrievedContext` — merged memories, related conversations, and
/// related tasks for one query (Phase 3.6, docs/decisions/0021-semantic-search-and-context-retrieval.md).
/// Attached to `SendMessageResult.retrievedContext` and returned by `GET .../retrieval/context`. Purely
/// advisory in both places: display-only metadata that never itself feeds AI generation or writes anything.
public struct RetrievedContext: Codable, Equatable, Sendable {
    public let memories: [RankedMemoryResult]
    public let relatedConversations: [SearchResult]
    public let relatedTasks: [SearchResult]

    public init(memories: [RankedMemoryResult], relatedConversations: [SearchResult], relatedTasks: [SearchResult]) {
        self.memories = memories
        self.relatedConversations = relatedConversations
        self.relatedTasks = relatedTasks
    }
}
