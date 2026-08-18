import Foundation

/// A deterministic in-memory `AuthClient` — mirrors `MockAPIClient`'s role: SwiftUI previews and
/// `AuthenticationManagerTests`/`MockAuthClientTests` exercise real sign-in/out/refresh state transitions
/// without a running backend. Seeded with one known-good account so both the happy path and the
/// invalid-credentials path are exercisable without extra setup. An `actor` for the same reason `MockAPIClient`
/// is one — its mutable session state must be safe to touch from Swift concurrency without extra locking.
public actor MockAuthClient: AuthClient, AccessTokenProviding {
    public static let seededEmail = "mock@example.com"
    public static let seededPassword = "password123"
    public static let seededUserId = "mock-user"
    public static let seededDisplayName = "Mock User"

    private var forceNextSignInFailure = false

    /// Actor-isolated mutation entry point for tests, mirroring `MockAPIClient.setShouldFail` — makes the next
    /// `signIn` call fail with an invalid-credentials error regardless of what's passed, then resets itself.
    public func setForceNextSignInFailure(_ value: Bool) {
        forceNextSignInFailure = value
    }

    private var activeSession: AuthSession?
    private var activeUser: AuthenticatedUser?

    public init() {}

    public func currentSession() async -> AuthSession? {
        activeSession
    }

    public func currentUser() async -> AuthenticatedUser? {
        activeUser
    }

    public func currentAccessToken() async -> String? {
        activeSession?.accessToken
    }

    @discardableResult
    public func signIn(email: String, password: String) async throws -> AuthSession {
        if forceNextSignInFailure {
            forceNextSignInFailure = false
            throw APIError.server(statusCode: 401, message: "Invalid email or password")
        }
        guard email == Self.seededEmail, password == Self.seededPassword else {
            throw APIError.server(statusCode: 401, message: "Invalid email or password")
        }
        let session = AuthSession(
            accessToken: "mock-access-\(UUID().uuidString)",
            refreshToken: "mock-refresh-\(UUID().uuidString)",
            expiresAt: Date().addingTimeInterval(3600),
            userId: Self.seededUserId
        )
        activeSession = session
        activeUser = AuthenticatedUser(id: Self.seededUserId, email: email, displayName: Self.seededDisplayName)
        return session
    }

    public func signOut() async throws {
        guard activeSession != nil else {
            throw AuthClientError.noActiveSession
        }
        activeSession = nil
        activeUser = nil
    }

    @discardableResult
    public func refreshSession() async throws -> AuthSession {
        guard let current = activeSession else {
            throw AuthClientError.noActiveSession
        }
        let refreshed = AuthSession(
            accessToken: "mock-access-\(UUID().uuidString)",
            refreshToken: "mock-refresh-\(UUID().uuidString)",
            expiresAt: Date().addingTimeInterval(3600),
            userId: current.userId
        )
        activeSession = refreshed
        return refreshed
    }
}
