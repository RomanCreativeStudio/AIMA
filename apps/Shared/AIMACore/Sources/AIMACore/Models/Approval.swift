import Foundation

/// Mirrors `backend/src/approval/types.ts#ApprovalStatus` (Phase 1.7).
/// `expired` is derived by the backend at read time, never persisted, but
/// is a real value this app can receive and must render.
public enum ApprovalStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case approved
    case rejected
    case expired
}

/// Mirrors `backend/src/approval/types.ts#PendingApproval`.
public struct PendingApproval: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let actionType: String
    public let payload: JSONValue?
    public let status: ApprovalStatus
    public let createdAt: String
    public let expiresAt: String
    public let resolvedAt: String?

    public init(
        id: String,
        workspaceId: String,
        actionType: String,
        payload: JSONValue?,
        status: ApprovalStatus,
        createdAt: String,
        expiresAt: String,
        resolvedAt: String?
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.actionType = actionType
        self.payload = payload
        self.status = status
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.resolvedAt = resolvedAt
    }
}

/// Mirrors `backend/src/approval/types.ts#ApprovalDecision`. `state` is
/// intentionally a plain string rather than an enum: it can be either
/// `"no_approval_needed"` (advisory, no backing row) or any `ApprovalStatus`
/// value, and modeling that union faithfully as a Swift enum would need a
/// case for every `ApprovalStatus` value duplicated under a different name —
/// callers that need the real lifecycle should fetch the full
/// `PendingApproval` instead.
public struct ApprovalDecision: Codable, Equatable, Sendable {
    public let state: String
    public let pendingApprovalId: String?

    public init(state: String, pendingApprovalId: String?) {
        self.state = state
        self.pendingApprovalId = pendingApprovalId
    }
}
