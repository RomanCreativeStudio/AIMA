import Foundation

/// Mirrors `backend/src/users/types.ts#UserProfile` (Phase 1.8) exactly —
/// field names match the backend's JSON response verbatim (already
/// camelCase), so no key-conversion strategy is needed on the decoder.
public struct UserProfile: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let displayName: String?
    public let preferences: [String: JSONValue]
    public let communicationStyle: String?
    public let defaultWorkspaceId: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        email: String,
        displayName: String?,
        preferences: [String: JSONValue],
        communicationStyle: String?,
        defaultWorkspaceId: String?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.preferences = preferences
        self.communicationStyle = communicationStyle
        self.defaultWorkspaceId = defaultWorkspaceId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `backend/src/users/types.ts#UpdateUserProfileInput`. For most
/// fields, `nil` means "omit — leave unchanged". `defaultWorkspaceId` is
/// double-optional (`String??`) because the backend distinguishes "field
/// omitted" from "field explicitly null" for it: pass `nil` to leave it
/// unchanged, or `.some(nil)` to clear it, or `.some(.some(id))` to set it.
public struct UpdateUserProfileRequest: Encodable, Sendable {
    public var displayName: String?
    public var preferences: [String: JSONValue]?
    public var communicationStyle: String?
    public var defaultWorkspaceId: String??

    public init(
        displayName: String? = nil,
        preferences: [String: JSONValue]? = nil,
        communicationStyle: String? = nil,
        defaultWorkspaceId: String?? = nil
    ) {
        self.displayName = displayName
        self.preferences = preferences
        self.communicationStyle = communicationStyle
        self.defaultWorkspaceId = defaultWorkspaceId
    }

    private enum CodingKeys: String, CodingKey {
        case displayName, preferences, communicationStyle, defaultWorkspaceId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encodeIfPresent(preferences, forKey: .preferences)
        try container.encodeIfPresent(communicationStyle, forKey: .communicationStyle)
        if let defaultWorkspaceId {
            try container.encode(defaultWorkspaceId, forKey: .defaultWorkspaceId)
        }
    }
}
