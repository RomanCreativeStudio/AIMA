import Foundation

/// Mirrors `backend/src/memory/types.ts#MemoryScope`.
public enum MemoryScope: String, Codable, Sendable {
    case user
    case workspace
    case conversation
    case project
}

/// Mirrors `backend/src/memory/types.ts#MemoryType` (Phase 3.4, the lifecycle dimension added alongside
/// `MemoryScope`'s existing "category" dimension — see `docs/decisions/0019-advanced-memory-system.md`).
public enum MemoryType: String, Codable, Sendable {
    case shortTerm = "short_term"
    case longTerm = "long_term"
}

/// Mirrors `backend/src/memory/types.ts#MemoryRecord`. Not needed before
/// Phase 2.5 — `SendMessageResult.retrievedMemories` deliberately stayed a
/// loosely-typed `[JSONValue]` (Phase 2.1) since nothing rendered it
/// structurally yet. Conversation Intelligence's related memories are the
/// first real consumer, so a fixed type is no longer speculative.
///
/// The scoring/lifecycle fields (Phase 3.4) are Optional even though the backend always populates them, so a
/// fixture or cached payload from before this phase still decodes — the same backward-compatible-decode
/// posture as `HealthService.integrationReadiness` (Phase 3.1).
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
    public let importanceScore: Double?
    public let confidenceScore: Double?
    public let memoryType: MemoryType?
    public let lastAccessedAt: String?
    public let expiresAt: String?
    public let archivedAt: String?

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
        importanceScore: Double? = 0.5,
        confidenceScore: Double? = 1.0,
        memoryType: MemoryType? = .longTerm,
        lastAccessedAt: String? = nil,
        expiresAt: String? = nil,
        archivedAt: String? = nil
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
        self.importanceScore = importanceScore
        self.confidenceScore = confidenceScore
        self.memoryType = memoryType
        self.lastAccessedAt = lastAccessedAt
        self.expiresAt = expiresAt
        self.archivedAt = archivedAt
    }

    /// Convenience read of `archivedAt` for view code, mirroring the backend's own `archivedAt !== null` check.
    public var isArchived: Bool { archivedAt != nil }

    /// A cheap, display-only convenience wrapper — not the backend's weighted `relevanceScore` (that also folds
    /// in query similarity, which isn't available client-side outside a search response).
    public var memoryScore: MemoryScore {
        MemoryScore(importance: importanceScore ?? 0.5, confidence: confidenceScore ?? 1.0)
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
    public let importanceScore: Double?
    public let confidenceScore: Double?
    public let memoryType: MemoryType?
    public let lastAccessedAt: String?
    public let expiresAt: String?
    public let archivedAt: String?

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
        score: Double,
        importanceScore: Double? = 0.5,
        confidenceScore: Double? = 1.0,
        memoryType: MemoryType? = .longTerm,
        lastAccessedAt: String? = nil,
        expiresAt: String? = nil,
        archivedAt: String? = nil
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
        self.importanceScore = importanceScore
        self.confidenceScore = confidenceScore
        self.memoryType = memoryType
        self.lastAccessedAt = lastAccessedAt
        self.expiresAt = expiresAt
        self.archivedAt = archivedAt
    }

    public var memoryScore: MemoryScore {
        MemoryScore(importance: importanceScore ?? 0.5, confidence: confidenceScore ?? 1.0)
    }
}

/// A cheap, computed, display-only pairing of importance/confidence (Phase 3.4, item 6) — not a network model
/// itself, and not the backend's weighted relevance blend (`backend/src/memory/ranking.ts`); just a convenience
/// the Memory Management UI reads to render two scores together.
public struct MemoryScore: Equatable, Sendable {
    public let importance: Double
    public let confidence: Double

    public init(importance: Double, confidence: Double) {
        self.importance = importance
        self.confidence = confidence
    }
}

/// Mirrors `ai-engine/src/memory/types.ts#MemoryCandidateCategory` — what kind of thing an extracted memory
/// suggestion is, distinct from `MemoryScope` (where it would be stored).
public enum MemoryCategory: String, Codable, Sendable {
    case fact
    case preference
}

/// Mirrors `ai-engine/src/memory/types.ts#MemoryCandidate` — an advisory, never-auto-saved suggestion attached to
/// `SendMessageResult.memorySuggestions` (Phase 3.4), the same "advisory, never auto-executed" shape as
/// `WorkflowSuggestion`/`ExecutionSuggestion`.
public struct MemorySuggestion: Codable, Equatable, Sendable {
    public let content: String
    public let category: MemoryCategory
    public let importance: Double
    public let confidence: Double
    public let reason: String

    public init(content: String, category: MemoryCategory, importance: Double, confidence: Double, reason: String) {
        self.content = content
        self.category = category
        self.importance = importance
        self.confidence = confidence
        self.reason = reason
    }
}

/// Mirrors `backend/src/memory/types.ts#CreateMemoryInput` — the body of `POST .../memories`.
public struct CreateMemoryRequest: Encodable, Sendable {
    public var scope: MemoryScope
    public var content: String
    public var source: String?
    public var conversationId: String?
    public var projectKey: String?
    public var importanceScore: Double?
    public var confidenceScore: Double?
    public var memoryType: MemoryType?

    public init(
        scope: MemoryScope,
        content: String,
        source: String? = nil,
        conversationId: String? = nil,
        projectKey: String? = nil,
        importanceScore: Double? = nil,
        confidenceScore: Double? = nil,
        memoryType: MemoryType? = nil
    ) {
        self.scope = scope
        self.content = content
        self.source = source
        self.conversationId = conversationId
        self.projectKey = projectKey
        self.importanceScore = importanceScore
        self.confidenceScore = confidenceScore
        self.memoryType = memoryType
    }
}

/// Mirrors `backend/src/memory/types.ts#UpdateMemoryInput` — the body of `PATCH .../memories/:id`.
public struct UpdateMemoryRequest: Encodable, Sendable {
    public var content: String?
    public var importanceScore: Double?
    public var confidenceScore: Double?

    public init(content: String? = nil, importanceScore: Double? = nil, confidenceScore: Double? = nil) {
        self.content = content
        self.importanceScore = importanceScore
        self.confidenceScore = confidenceScore
    }
}
