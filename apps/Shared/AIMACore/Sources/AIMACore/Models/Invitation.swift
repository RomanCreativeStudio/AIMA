import Foundation

/// Mirrors `backend/src/invitations/types.ts#InvitationStatus`.
public enum InvitationStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case pending
    case accepted
    case expired
}

/// Mirrors `backend/src/invitations/types.ts#Invitation` (Beta Invitations & Notifications sprint) —
/// a founder-issued invite to a prospective beta tester, only ever reachable via
/// `APIClient.createInvitation`/`listInvitations`, which the backend gates to `requireAdmin`.
public struct Invitation: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let invitedBy: String
    public let status: InvitationStatus
    public let createdAt: String

    public init(id: String, email: String, invitedBy: String, status: InvitationStatus, createdAt: String) {
        self.id = id
        self.email = email
        self.invitedBy = invitedBy
        self.status = status
        self.createdAt = createdAt
    }
}

/// Mirrors the POST `/api/admin/invitations` body.
public struct CreateInvitationRequest: Encodable, Sendable {
    public var email: String

    public init(email: String) {
        self.email = email
    }
}
