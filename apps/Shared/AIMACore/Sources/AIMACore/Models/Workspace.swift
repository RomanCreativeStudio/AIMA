import Foundation

/// The fixed identity from `docs/PRODUCT_BIBLE.md` §1 — mirrors
/// `backend/src/types/workspace.ts#WorkspaceSlug`. This set is closed by
/// product decision, not user-extensible.
public enum WorkspaceSlug: String, Codable, CaseIterable, Identifiable, Sendable {
    case personal
    case rcs
    case mfs
    case development

    public var id: String { rawValue }

    /// The display name used throughout the app for each fixed workspace (docs/PRODUCT_BIBLE.md §1).
    public var displayName: String {
        switch self {
        case .personal: return "Personal"
        case .rcs: return "Roman Creative Studio"
        case .mfs: return "Mythic Forge Studios"
        case .development: return "Development"
        }
    }
}

/// Mirrors `backend/src/types/workspace.ts#WorkspaceType` (Phase 1.8) — a
/// generic behavioral category independent of `slug`.
public enum WorkspaceType: String, Codable, CaseIterable, Sendable {
    case personal
    case business
    case creative
    case development
}

/// Mirrors `backend/src/workspaces/types.ts#Workspace` (Phase 1.8).
public struct Workspace: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let userId: String
    public let slug: WorkspaceSlug
    public let name: String
    public let type: WorkspaceType
    public let instructions: String?
    public let assistantBehavior: [String: JSONValue]
    public let metadata: [String: JSONValue]
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        userId: String,
        slug: WorkspaceSlug,
        name: String,
        type: WorkspaceType,
        instructions: String?,
        assistantBehavior: [String: JSONValue],
        metadata: [String: JSONValue],
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.userId = userId
        self.slug = slug
        self.name = name
        self.type = type
        self.instructions = instructions
        self.assistantBehavior = assistantBehavior
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `backend/src/workspaces/types.ts#CreateWorkspaceInput`.
public struct CreateWorkspaceRequest: Encodable, Sendable {
    public var userId: String
    public var slug: WorkspaceSlug
    public var name: String
    public var type: WorkspaceType?
    public var instructions: String?
    public var assistantBehavior: [String: JSONValue]?
    public var metadata: [String: JSONValue]?

    public init(
        userId: String,
        slug: WorkspaceSlug,
        name: String,
        type: WorkspaceType? = nil,
        instructions: String? = nil,
        assistantBehavior: [String: JSONValue]? = nil,
        metadata: [String: JSONValue]? = nil
    ) {
        self.userId = userId
        self.slug = slug
        self.name = name
        self.type = type
        self.instructions = instructions
        self.assistantBehavior = assistantBehavior
        self.metadata = metadata
    }
}

/// Mirrors `backend/src/workspaces/types.ts#UpdateWorkspaceInput`.
public struct UpdateWorkspaceRequest: Encodable, Sendable {
    public var name: String?
    public var type: WorkspaceType?
    public var instructions: String?
    public var assistantBehavior: [String: JSONValue]?
    public var metadata: [String: JSONValue]?

    public init(
        name: String? = nil,
        type: WorkspaceType? = nil,
        instructions: String? = nil,
        assistantBehavior: [String: JSONValue]? = nil,
        metadata: [String: JSONValue]? = nil
    ) {
        self.name = name
        self.type = type
        self.instructions = instructions
        self.assistantBehavior = assistantBehavior
        self.metadata = metadata
    }
}
