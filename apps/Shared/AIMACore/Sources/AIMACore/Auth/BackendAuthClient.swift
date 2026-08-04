import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The real `AuthClient` — exchanges credentials with AIMA's own backend (`POST /api/auth/login`,
/// `/api/auth/refresh`, `/api/auth/logout`; `backend/src/routes/auth.ts`), never the Supabase SDK. An `actor` so
/// its mutable in-memory session is safe to call from Swift concurrency without extra locking, mirroring
/// `MockAPIClient`'s use of `actor` for the same reason.
///
/// The session itself is persisted through the injected `SessionStore` (`KeychainSessionStore` in real app use,
/// `InMemorySessionStore` by default for tests/previews/Linux) rather than by this type directly — signing in
/// writes through it, signing out and a rejected refresh clear it, and `currentSession()`/`currentUser()` read
/// through to it once per process if nothing has been loaded into memory yet. This class has no Keychain code
/// of its own; it only ever talks to `SessionStore`.
public actor BackendAuthClient: AuthClient, AccessTokenProviding {
    private let configuration: APIConfiguration
    private let urlSession: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let sessionStore: SessionStore

    private var activeSession: AuthSession?
    private var activeUser: AuthenticatedUser?
    /// Set the first time this instance has consulted `sessionStore` (whether or not it found anything) — so a
    /// signed-out process doesn't re-query the store on every single call.
    private var hasConsultedStore = false

    public init(configuration: APIConfiguration, urlSession: URLSession = .shared, sessionStore: SessionStore = InMemorySessionStore()) {
        self.configuration = configuration
        self.urlSession = urlSession
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        self.sessionStore = sessionStore
    }

    public func currentSession() async -> AuthSession? {
        await restoreFromStoreIfNeeded()
        return activeSession
    }

    public func currentUser() async -> AuthenticatedUser? {
        await restoreFromStoreIfNeeded()
        return activeUser
    }

    public func currentAccessToken() async -> String? {
        await restoreFromStoreIfNeeded()
        return activeSession?.accessToken
    }

    private func restoreFromStoreIfNeeded() async {
        guard !hasConsultedStore else { return }
        hasConsultedStore = true
        guard let persisted = await sessionStore.load() else { return }
        activeSession = persisted.session
        activeUser = persisted.user
    }

    @discardableResult
    public func signIn(email: String, password: String) async throws -> AuthSession {
        struct Body: Encodable { let email: String; let password: String }
        let response: LoginResponse = try await send(
            "POST", "/api/auth/login", body: Body(email: email, password: password), authorized: false
        )
        let session = try makeSession(from: response.tokens, userId: response.session.userId)
        let user = AuthenticatedUser(id: session.userId, email: email, displayName: nil)
        activeSession = session
        activeUser = user
        hasConsultedStore = true
        await sessionStore.save(PersistedSession(session: session, user: user))
        return session
    }

    public func signOut() async throws {
        await restoreFromStoreIfNeeded()
        guard let current = activeSession else {
            throw AuthClientError.noActiveSession
        }
        struct Body: Encodable { let refreshToken: String }
        // Best-effort, mirroring `OAuthProvider.revokeToken`'s documented convention and `AuthProvider
        // .revokeSession`'s own best-effort backend semantics: the user asked to sign out, and that must always
        // succeed locally even if the courtesy revocation call itself fails (network down, token already expired).
        _ = try? await sendNoContent("POST", "/api/auth/logout", body: Body(refreshToken: current.refreshToken), authorized: true)
        activeSession = nil
        activeUser = nil
        await sessionStore.clear()
    }

    @discardableResult
    public func refreshSession() async throws -> AuthSession {
        await restoreFromStoreIfNeeded()
        guard let current = activeSession, let currentUser = activeUser else {
            throw AuthClientError.noActiveSession
        }
        struct Body: Encodable { let refreshToken: String }
        do {
            let response: RefreshResponse = try await send(
                "POST", "/api/auth/refresh", body: Body(refreshToken: current.refreshToken), authorized: false
            )
            // The backend rotates the refresh token on every use (`SessionService.refresh`, ADR-0022 Decision
            // 2) — `response.tokens.refreshToken` is a new value, never the one just sent, and it's that new
            // value (not `current`'s) that gets stored below.
            let session = try makeSession(from: response.tokens, userId: response.session.userId)
            let user = AuthenticatedUser(id: session.userId, email: currentUser.email, displayName: currentUser.displayName)
            activeSession = session
            activeUser = user
            await sessionStore.save(PersistedSession(session: session, user: user))
            return session
        } catch {
            // The refresh token the backend just rejected can never succeed on a later retry (rotation means
            // each one is single-use) — leaving the old session in place would just keep failing the same way
            // and strand the app in a "looks signed in, isn't" state. Clearing it here is what makes that
            // failure surface as "you're signed out," which is the only state that's actually true anymore.
            activeSession = nil
            activeUser = nil
            await sessionStore.clear()
            throw error
        }
    }

    private func makeSession(from tokens: TokensPayload, userId: String) throws -> AuthSession {
        guard let expiresAt = Self.timestampFormatter.date(from: tokens.accessTokenExpiresAt)
            ?? ISO8601DateFormatter().date(from: tokens.accessTokenExpiresAt) else {
            throw APIError.decoding("accessTokenExpiresAt was not a valid ISO 8601 timestamp")
        }
        return AuthSession(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: expiresAt, userId: userId)
    }

    /// The backend's timestamps include fractional seconds (`toIso` helpers throughout `backend/src`); tried first, falling back to the plain format above for robustness.
    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    // MARK: - HTTP plumbing
    //
    // Kept separate from `URLSessionAPIClient.send`: login/refresh must never attach a bearer token (there may
    // not be one yet), while logout must attach the current one — a shape `URLSessionAPIClient`'s single
    // always-attach-if-present path isn't built for, and has no reason to be, since every other route it serves
    // is already-authenticated by definition.

    private func send<Response: Decodable>(_ method: String, _ path: String, body: Encodable, authorized: Bool) async throws -> Response {
        let data = try await perform(method, path, body: body, authorized: authorized)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    private func sendNoContent(_ method: String, _ path: String, body: Encodable, authorized: Bool) async throws {
        _ = try await perform(method, path, body: body, authorized: authorized)
    }

    private func perform(_ method: String, _ path: String, body: Encodable, authorized: Bool) async throws -> Data {
        guard let url = URL(string: path, relativeTo: configuration.baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url, timeoutInterval: configuration.requestTimeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized, let token = activeSession?.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            request.httpBody = try encoder.encode(AnyEncodableBody(body))
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw APIError.network(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.network("No HTTP response received")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = try? decoder.decode(ErrorBody.self, from: data).error
            throw APIError.server(statusCode: httpResponse.statusCode, message: message)
        }

        return data
    }
}

private struct AnyEncodableBody: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        self.encodeClosure = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

private struct ErrorBody: Decodable { let error: String }
private struct TokensPayload: Decodable { let accessToken: String; let refreshToken: String; let accessTokenExpiresAt: String }
private struct SessionPayload: Decodable { let userId: String }
private struct LoginResponse: Decodable { let tokens: TokensPayload; let session: SessionPayload }
private struct RefreshResponse: Decodable { let tokens: TokensPayload; let session: SessionPayload }
