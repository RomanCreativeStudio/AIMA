import Foundation

/// The client-side authentication abstraction (macOS Authentication Foundation) — mirrors `APIClient`'s
/// provider-abstraction pattern: views and view models depend only on this protocol, never on a concrete HTTP
/// implementation or the Supabase SDK directly. This app never links the Supabase SDK at all — it always
/// exchanges credentials through AIMA's own backend (`POST /api/auth/login`, `backend/src/routes/auth.ts`),
/// which already made that provider choice in ADR-0022; nothing here re-decides or bypasses it.
public protocol AuthClient: Sendable {
    /// Exchanges an email/password pair for a fresh session. Throws `APIError.server` (401) for invalid
    /// credentials, `APIError.network`/`.decoding` for transport or parsing failures.
    @discardableResult
    func signIn(email: String, password: String) async throws -> AuthSession

    /// Revokes the current session, locally and (best-effort) with the backend. Throws `AuthClientError.noActiveSession` if there is no current session.
    func signOut() async throws

    /// Exchanges the current session's refresh token for a fresh one, rotating it (mirrors `SessionService.refresh`).
    /// Throws `AuthClientError.noActiveSession` if there is no current session, or an `APIError` if the backend rejects the refresh token.
    @discardableResult
    func refreshSession() async throws -> AuthSession

    /// The current session, if any — `nil` before the first successful `signIn` or after `signOut`. A real
    /// implementation may transparently restore this from persisted storage (`BackendAuthClient`'s
    /// `SessionStore`) the first time it's asked, so a caller can rely on this reflecting a session from a
    /// previous app launch without a separate "restore" step.
    func currentSession() async -> AuthSession?

    /// The signed-in identity, if any.
    func currentUser() async -> AuthenticatedUser?
}

/// Supplies the bearer token `URLSessionAPIClient` attaches to outgoing requests. A narrow protocol of its own —
/// not just widening `AuthClient` — so the networking layer depends only on "what's the current access token,"
/// never on the full sign-in/out/refresh surface it has no business calling itself.
public protocol AccessTokenProviding: Sendable {
    func currentAccessToken() async -> String?
}

/// What an `AuthClient` throws for an operation that requires an existing session when there isn't one.
public enum AuthClientError: Error, Equatable, Sendable {
    case noActiveSession
}
