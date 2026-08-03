import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The real `AuthClient` — exchanges credentials with AIMA's own backend (`POST /api/auth/login`,
/// `/api/auth/refresh`, `/api/auth/logout`; `backend/src/routes/auth.ts`), never the Supabase SDK. An `actor` so
/// its mutable in-memory session is safe to call from Swift concurrency without extra locking, mirroring
/// `MockAPIClient`'s use of `actor` for the same reason.
///
/// The session lives in memory only: nothing is written to the Keychain or disk here, so signing in again is
/// required after every relaunch. That is a deliberate scope limit for this foundation, not an oversight —
/// where and how to persist a refresh token securely is its own decision this sprint didn't make (see the
/// reported remaining gaps).
public actor BackendAuthClient: AuthClient, AccessTokenProviding {
    private let configuration: APIConfiguration
    private let urlSession: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private var activeSession: AuthSession?
    private var activeUser: AuthenticatedUser?

    public init(configuration: APIConfiguration, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.urlSession = urlSession
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

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
        struct Body: Encodable { let email: String; let password: String }
        let response: LoginResponse = try await send(
            "POST", "/api/auth/login", body: Body(email: email, password: password), authorized: false
        )
        let session = try makeSession(from: response.tokens, userId: response.session.userId)
        activeSession = session
        activeUser = AuthenticatedUser(id: session.userId, email: email, displayName: nil)
        return session
    }

    public func signOut() async throws {
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
    }

    @discardableResult
    public func refreshSession() async throws -> AuthSession {
        guard let current = activeSession else {
            throw AuthClientError.noActiveSession
        }
        struct Body: Encodable { let refreshToken: String }
        let response: RefreshResponse = try await send(
            "POST", "/api/auth/refresh", body: Body(refreshToken: current.refreshToken), authorized: false
        )
        let session = try makeSession(from: response.tokens, userId: response.session.userId)
        activeSession = session
        if let user = activeUser {
            activeUser = AuthenticatedUser(id: session.userId, email: user.email, displayName: user.displayName)
        }
        return session
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
