import Foundation

/// Mirrors `backend/src/feedback/types.ts#FeedbackType`.
public enum FeedbackType: String, Codable, CaseIterable, Identifiable, Sendable {
    case bug
    case feature
    case general

    public var id: String { rawValue }

    /// The display label used by the feedback form (Beta Tester Infrastructure sprint).
    public var displayName: String {
        switch self {
        case .bug: return "Bug Report"
        case .feature: return "Feature Request"
        case .general: return "General Feedback"
        }
    }
}

/// Mirrors `backend/src/feedback/types.ts#Feedback` (Beta Tester Infrastructure sprint) — a single feedback/
/// bug-report/feature-request submission, workspace-scoped like every other resource in this package.
public struct Feedback: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let userId: String
    public let type: FeedbackType
    public let message: String
    public let createdAt: String

    public init(id: String, workspaceId: String, userId: String, type: FeedbackType, message: String, createdAt: String) {
        self.id = id
        self.workspaceId = workspaceId
        self.userId = userId
        self.type = type
        self.message = message
        self.createdAt = createdAt
    }
}

/// Mirrors `backend/src/feedback/types.ts#CreateFeedbackInput`'s client-facing subset — `workspaceId`/
/// `userId` are path/auth-derived on the backend, never sent by the client.
public struct CreateFeedbackRequest: Encodable, Sendable {
    public var type: FeedbackType?
    public var message: String

    public init(type: FeedbackType? = nil, message: String) {
        self.type = type
        self.message = message
    }
}
