import Foundation

/// Mirrors `backend/src/conversation/types.ts#Conversation`.
public struct Conversation: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let title: String?
    public let createdAt: String
    public let updatedAt: String

    public init(id: String, workspaceId: String, title: String?, createdAt: String, updatedAt: String) {
        self.id = id
        self.workspaceId = workspaceId
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
