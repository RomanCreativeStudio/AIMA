import Foundation

/// A live client-side authentication session — mirrors the backend's `IssuedTokens` + `AuthSession` pair
/// (`backend/src/auth/types.ts`, `backend/src/auth/sessionService.ts`) into the one value the client actually
/// needs to attach a bearer token to requests and know when to refresh. Held in memory only by `AuthClient`
/// implementations in this foundation — see `BackendAuthClient`'s doc comment for why nothing here is persisted
/// to disk yet.
public struct AuthSession: Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let userId: String

    public init(accessToken: String, refreshToken: String, expiresAt: Date, userId: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userId = userId
    }

    /// True once `expiresAt` has passed. Nothing in this foundation refreshes automatically on expiry (explicit
    /// actions only, no hidden background behavior) — a caller checks this and calls `AuthClient.refreshSession()` itself.
    public var isExpired: Bool {
        expiresAt <= Date()
    }
}

/// The signed-in identity a view can display — deliberately narrower than `UserProfile` (no preferences, no
/// timestamps): it's what `AuthClient` knows from the login exchange itself, not a full profile fetch.
public struct AuthenticatedUser: Identifiable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let displayName: String?

    public init(id: String, email: String, displayName: String?) {
        self.id = id
        self.email = email
        self.displayName = displayName
    }
}
