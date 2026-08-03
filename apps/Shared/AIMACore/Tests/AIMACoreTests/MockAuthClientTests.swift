import XCTest
@testable import AIMACore

final class MockAuthClientTests: XCTestCase {
    func testSignInWithSeededCredentialsReturnsASessionAndSetsTheCurrentUser() async throws {
        let client = MockAuthClient()

        let session = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertEqual(session.userId, MockAuthClient.seededUserId)
        XCTAssertFalse(session.accessToken.isEmpty)
        XCTAssertFalse(session.isExpired)

        let user = await client.currentUser()
        XCTAssertEqual(user?.email, MockAuthClient.seededEmail)
        XCTAssertEqual(user?.displayName, MockAuthClient.seededDisplayName)

        let currentSession = await client.currentSession()
        XCTAssertEqual(currentSession, session)
    }

    func testSignInWithWrongCredentialsThrowsAndLeavesNoSession() async throws {
        let client = MockAuthClient()

        do {
            _ = try await client.signIn(email: "wrong@example.com", password: "wrong")
            XCTFail("expected signIn to throw")
        } catch let error as APIError {
            guard case .server(let statusCode, _) = error else {
                XCTFail("expected .server, got \(error)")
                return
            }
            XCTAssertEqual(statusCode, 401)
        }

        let session = await client.currentSession()
        XCTAssertNil(session)
        let user = await client.currentUser()
        XCTAssertNil(user)
    }

    func testForceNextSignInFailureRejectsEvenValidCredentialsOnce() async throws {
        let client = MockAuthClient()
        await client.setForceNextSignInFailure(true)

        do {
            _ = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
            XCTFail("expected the forced failure to reject sign-in")
        } catch {
            // expected
        }

        // The forced failure is consumed — a subsequent attempt with the same valid credentials succeeds.
        let session = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        XCTAssertEqual(session.userId, MockAuthClient.seededUserId)
    }

    func testSignOutClearsTheSessionAndCurrentUser() async throws {
        let client = MockAuthClient()
        _ = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        try await client.signOut()

        let session = await client.currentSession()
        let user = await client.currentUser()
        XCTAssertNil(session)
        XCTAssertNil(user)
    }

    func testSignOutWithNoActiveSessionThrows() async throws {
        let client = MockAuthClient()

        do {
            try await client.signOut()
            XCTFail("expected signOut to throw without a session")
        } catch let error as AuthClientError {
            XCTAssertEqual(error, .noActiveSession)
        }
    }

    func testRefreshSessionRotatesTheAccessTokenAndKeepsTheSameUser() async throws {
        let client = MockAuthClient()
        let original = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        let refreshed = try await client.refreshSession()

        XCTAssertNotEqual(refreshed.accessToken, original.accessToken)
        XCTAssertNotEqual(refreshed.refreshToken, original.refreshToken)
        XCTAssertEqual(refreshed.userId, original.userId)
    }

    func testRefreshSessionWithNoActiveSessionThrows() async throws {
        let client = MockAuthClient()

        do {
            _ = try await client.refreshSession()
            XCTFail("expected refreshSession to throw without a session")
        } catch let error as AuthClientError {
            XCTAssertEqual(error, .noActiveSession)
        }
    }

    func testCurrentAccessTokenMirrorsTheActiveSession() async throws {
        let client = MockAuthClient()
        let tokenBeforeSignIn = await client.currentAccessToken()
        XCTAssertNil(tokenBeforeSignIn)

        let session = try await client.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let tokenAfterSignIn = await client.currentAccessToken()
        XCTAssertEqual(tokenAfterSignIn, session.accessToken)
    }
}
