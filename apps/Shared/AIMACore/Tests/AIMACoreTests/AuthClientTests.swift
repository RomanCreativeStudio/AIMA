import XCTest
@testable import AIMACore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Exercises `BackendAuthClient` against a stubbed HTTP layer — reuses `MockURLProtocol`
/// (`URLSessionAPIClientTests.swift`) so these tests see the exact requests it builds and can hand back
/// arbitrary backend responses, the same technique that file uses for `URLSessionAPIClient`.
final class AuthClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient(sessionStore: SessionStore = InMemorySessionStore()) -> BackendAuthClient {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [MockURLProtocol.self]
        let urlSession = URLSession(configuration: sessionConfiguration)
        return BackendAuthClient(
            configuration: APIConfiguration(baseURL: URL(string: "http://example.test")!),
            urlSession: urlSession,
            sessionStore: sessionStore
        )
    }

    private func stubLogin(
        accessToken: String = "access-1",
        refreshToken: String = "refresh-1",
        accessTokenExpiresAt: String = "2099-01-01T01:00:00.000Z",
        userId: String = "user-1"
    ) {
        let body = """
        {"tokens":{"accessToken":"\(accessToken)","refreshToken":"\(refreshToken)","accessTokenExpiresAt":"\(accessTokenExpiresAt)"},"session":{"id":"sess-1","userId":"\(userId)","deviceLabel":null,"createdAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T00:00:00.000Z","revokedAt":null}}
        """.data(using: .utf8)!
        MockURLProtocol.stubs["POST /api/auth/login"] = .init(statusCode: 201, body: body)
    }

    // MARK: - Requirement 1 & 2: /api/auth/login + the {tokens:{accessToken,refreshToken}} envelope

    func testSignInPostsToApiAuthLoginNotTheOldUnprefixedPath() async throws {
        let client = makeClient()
        stubLogin()

        _ = try await client.signIn(email: "user@example.com", password: "hunter2")

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        XCTAssertEqual(recorded.url?.path, "/api/auth/login")
        XCTAssertEqual(recorded.httpMethod, "POST")
    }

    func testSignInDecodesTheTokenEnvelopeIntoAnAuthSession() async throws {
        let client = makeClient()
        stubLogin(accessToken: "access-xyz", refreshToken: "refresh-xyz", userId: "user-42")

        let session = try await client.signIn(email: "user@example.com", password: "hunter2")

        XCTAssertEqual(session.accessToken, "access-xyz")
        XCTAssertEqual(session.refreshToken, "refresh-xyz")
        XCTAssertEqual(session.userId, "user-42")
        XCTAssertFalse(session.isExpired)
    }

    func testSignInSendsEmailAndPasswordAsTheRequestBody() async throws {
        let client = makeClient()
        stubLogin()

        _ = try await client.signIn(email: "user@example.com", password: "hunter2")

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["email"] as? String, "user@example.com")
        XCTAssertEqual(sentJSON?["password"] as? String, "hunter2")
    }

    func testSignInWithInvalidCredentialsThrowsAndNeverPersistsASession() async throws {
        let client = makeClient()
        MockURLProtocol.stubs["POST /api/auth/login"] = .init(
            statusCode: 401,
            body: #"{"error":"Invalid email or password"}"#.data(using: .utf8)!
        )

        do {
            _ = try await client.signIn(email: "user@example.com", password: "wrong")
            XCTFail("expected signIn to throw")
        } catch let error as APIError {
            guard case .server(let statusCode, let message) = error else {
                XCTFail("expected .server, got \(error)")
                return
            }
            XCTAssertEqual(statusCode, 401)
            XCTAssertEqual(message, "Invalid email or password")
        }

        let session = await client.currentSession()
        XCTAssertNil(session)
    }

    // MARK: - Requirement 3: SessionStore persistence

    func testSignInPersistsTheSessionThroughTheSessionStore() async throws {
        let store = InMemorySessionStore()
        let client = makeClient(sessionStore: store)
        stubLogin(accessToken: "access-1", refreshToken: "refresh-1", userId: "user-1")

        _ = try await client.signIn(email: "user@example.com", password: "hunter2")

        let persisted = await store.load()
        XCTAssertEqual(persisted?.session.accessToken, "access-1")
        XCTAssertEqual(persisted?.session.refreshToken, "refresh-1")
        XCTAssertEqual(persisted?.user.email, "user@example.com")
    }

    func testCurrentSessionRestoresFromAnAlreadyPopulatedStoreWithoutAnyNetworkCall() async throws {
        let store = InMemorySessionStore()
        let persisted = PersistedSession(
            session: AuthSession(accessToken: "stored-access", refreshToken: "stored-refresh", expiresAt: Date().addingTimeInterval(3600), userId: "user-9"),
            user: AuthenticatedUser(id: "user-9", email: "restored@example.com", displayName: "Restored User")
        )
        await store.save(persisted)
        // No stubs registered at all — a fresh `BackendAuthClient` reading a pre-populated store must never hit the network to answer these.
        let client = makeClient(sessionStore: store)

        let session = await client.currentSession()
        let user = await client.currentUser()
        let token = await client.currentAccessToken()

        XCTAssertEqual(session?.accessToken, "stored-access")
        XCTAssertEqual(user?.email, "restored@example.com")
        XCTAssertEqual(token, "stored-access")
        XCTAssertTrue(MockURLProtocol.recordedRequests.isEmpty)
    }

    func testSignOutClearsTheSessionStore() async throws {
        let store = InMemorySessionStore()
        let client = makeClient(sessionStore: store)
        stubLogin()
        _ = try await client.signIn(email: "user@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/logout"] = .init(statusCode: 204, body: Data())

        try await client.signOut()

        let persisted = await store.load()
        XCTAssertNil(persisted)
        let session = await client.currentSession()
        XCTAssertNil(session)
    }

    func testSignOutSendsTheCurrentAccessTokenAsABearerHeader() async throws {
        let client = makeClient()
        stubLogin(accessToken: "access-for-logout")
        _ = try await client.signIn(email: "user@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/logout"] = .init(statusCode: 204, body: Data())

        try await client.signOut()

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        XCTAssertEqual(recorded.url?.path, "/api/auth/logout")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer access-for-logout")
    }

    // MARK: - Requirements 4 & 5: real POST /api/auth/refresh (no fake UUIDs)

    func testRefreshSessionPostsToApiAuthRefreshWithTheCurrentRefreshToken() async throws {
        let client = makeClient()
        stubLogin(refreshToken: "refresh-original")
        _ = try await client.signIn(email: "user@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/refresh"] = .init(
            statusCode: 200,
            body: #"{"tokens":{"accessToken":"access-2","refreshToken":"refresh-2","accessTokenExpiresAt":"2026-01-01T02:00:00.000Z"},"session":{"id":"sess-1","userId":"user-1","deviceLabel":null,"createdAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T01:00:00.000Z","revokedAt":null}}"#.data(using: .utf8)!
        )

        _ = try await client.refreshSession()

        let recorded = try XCTUnwrap(MockURLProtocol.recordedRequests.last)
        XCTAssertEqual(recorded.url?.path, "/api/auth/refresh")
        let sentBody = try XCTUnwrap(recorded.httpBody)
        let sentJSON = try JSONSerialization.jsonObject(with: sentBody) as? [String: Any]
        XCTAssertEqual(sentJSON?["refreshToken"] as? String, "refresh-original")
    }

    // MARK: - Requirement 6: rotated refresh tokens

    func testRefreshSessionReplacesBothTokensWithTheRotatedPairFromTheResponse() async throws {
        let store = InMemorySessionStore()
        let client = makeClient(sessionStore: store)
        stubLogin(accessToken: "access-1", refreshToken: "refresh-1")
        let original = try await client.signIn(email: "user@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/refresh"] = .init(
            statusCode: 200,
            body: #"{"tokens":{"accessToken":"access-2","refreshToken":"refresh-2","accessTokenExpiresAt":"2026-01-01T02:00:00.000Z"},"session":{"id":"sess-1","userId":"user-1","deviceLabel":null,"createdAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T01:00:00.000Z","revokedAt":null}}"#.data(using: .utf8)!
        )

        let refreshed = try await client.refreshSession()

        XCTAssertNotEqual(refreshed.accessToken, original.accessToken)
        XCTAssertNotEqual(refreshed.refreshToken, original.refreshToken)
        XCTAssertEqual(refreshed.accessToken, "access-2")
        XCTAssertEqual(refreshed.refreshToken, "refresh-2")

        // The rotated pair is what's now persisted — a second refresh must send the NEW token, not the original.
        let persisted = await store.load()
        XCTAssertEqual(persisted?.session.refreshToken, "refresh-2")
    }

    func testRefreshSessionPreservesTheSignedInUsersEmailAcrossRotation() async throws {
        let client = makeClient()
        stubLogin(accessToken: "access-1", refreshToken: "refresh-1")
        _ = try await client.signIn(email: "keeps-me@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/refresh"] = .init(
            statusCode: 200,
            body: #"{"tokens":{"accessToken":"access-2","refreshToken":"refresh-2","accessTokenExpiresAt":"2026-01-01T02:00:00.000Z"},"session":{"id":"sess-1","userId":"user-1","deviceLabel":null,"createdAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T01:00:00.000Z","revokedAt":null}}"#.data(using: .utf8)!
        )

        _ = try await client.refreshSession()

        let user = await client.currentUser()
        XCTAssertEqual(user?.email, "keeps-me@example.com")
    }

    // MARK: - Requirement 7: clear invalid sessions on refresh failure

    func testRefreshSessionClearsTheSessionWhenTheBackendRejectsTheRefreshToken() async throws {
        let store = InMemorySessionStore()
        let client = makeClient(sessionStore: store)
        stubLogin()
        _ = try await client.signIn(email: "user@example.com", password: "hunter2")
        MockURLProtocol.stubs["POST /api/auth/refresh"] = .init(
            statusCode: 401,
            body: #"{"error":"Invalid or expired refresh token"}"#.data(using: .utf8)!
        )

        do {
            _ = try await client.refreshSession()
            XCTFail("expected refreshSession to throw when the backend rejects the refresh token")
        } catch {
            // expected
        }

        let session = await client.currentSession()
        let user = await client.currentUser()
        let persisted = await store.load()
        XCTAssertNil(session)
        XCTAssertNil(user)
        XCTAssertNil(persisted)
    }

    func testRefreshSessionWithNoActiveSessionThrowsWithoutTouchingTheStore() async throws {
        let client = makeClient()

        do {
            _ = try await client.refreshSession()
            XCTFail("expected refreshSession to throw without a session")
        } catch let error as AuthClientError {
            XCTAssertEqual(error, .noActiveSession)
        }

        XCTAssertTrue(MockURLProtocol.recordedRequests.isEmpty)
    }
}
