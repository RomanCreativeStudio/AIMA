import XCTest
@testable import AIMACore

/// A fully scriptable `AuthClient` test double — used only for the one scenario `MockAuthClient` can't produce
/// (an already-expired session whose refresh the backend rejects; `MockAuthClient`'s sessions are always
/// freshly minted an hour out). Every other test in this file uses the real `MockAuthClient`/`MockAPIClient`
/// pair, per this sprint's "use existing test utilities" instruction.
private actor ScriptedAuthClient: AuthClient, AccessTokenProviding {
    var session: AuthSession?
    var user: AuthenticatedUser?
    var refreshError: Error?

    func currentSession() async -> AuthSession? { session }
    func currentUser() async -> AuthenticatedUser? { user }
    func currentAccessToken() async -> String? { session?.accessToken }

    func seed(session: AuthSession, user: AuthenticatedUser, refreshError: Error?) {
        self.session = session
        self.user = user
        self.refreshError = refreshError
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        throw AuthClientError.noActiveSession
    }

    func signOut() async throws {
        guard session != nil else { throw AuthClientError.noActiveSession }
        session = nil
        user = nil
    }

    func refreshSession() async throws -> AuthSession {
        guard session != nil else { throw AuthClientError.noActiveSession }
        if let refreshError { throw refreshError }
        throw AuthClientError.noActiveSession
    }
}

@MainActor
final class AuthenticationManagerTests: XCTestCase {
    // MARK: - no session starts signedOut

    func testRestoreSessionWithNoSessionEndsUpSignedOut() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())

        await manager.restoreSession()

        XCTAssertEqual(manager.state, .signedOut)
        XCTAssertNil(manager.currentUser)
    }

    // MARK: - restores session

    func testRestoreSessionWithAnAlreadyActiveClientSessionBecomesAuthenticated() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())

        await manager.restoreSession()

        guard case .authenticated(let user) = manager.state else {
            XCTFail("expected .authenticated, got \(manager.state)")
            return
        }
        XCTAssertEqual(user.id, "mock-user")
    }

    // MARK: - loads user

    func testRestoreSessionPopulatesCurrentUserFromApiClient() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())

        await manager.restoreSession()

        XCTAssertEqual(manager.currentUser?.email, "you@example.com")
        XCTAssertEqual(manager.currentUser?.displayName, "Roman")
    }

    // MARK: - refresh failure signs out

    func testRestoreSessionSignsOutWhenAnExpiredSessionFailsToRefresh() async {
        let authClient = ScriptedAuthClient()
        let expiredSession = AuthSession(
            accessToken: "expired-access", refreshToken: "expired-refresh",
            expiresAt: Date().addingTimeInterval(-3600), userId: "user-1"
        )
        await authClient.seed(
            session: expiredSession,
            user: AuthenticatedUser(id: "user-1", email: "user@example.com", displayName: nil),
            refreshError: APIError.server(statusCode: 401, message: "Invalid or expired refresh token")
        )
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())

        await manager.restoreSession()

        XCTAssertEqual(manager.state, .signedOut)
        XCTAssertNil(manager.currentUser)
        XCTAssertTrue(manager.workspaces.isEmpty)
    }

    // MARK: - workspace loading

    func testRestoreSessionLoadsWorkspacesAndDefaultsToTheUsersDefaultWorkspace() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())

        await manager.restoreSession()

        XCTAssertEqual(manager.workspaces.count, 4)
        // MockAPIClient's seeded user's defaultWorkspaceId is the RCS workspace, not simply the first one.
        XCTAssertEqual(manager.activeWorkspaceId, "mock-ws-rcs")
        XCTAssertEqual(manager.activeWorkspace?.name, "Roman Creative Studio")
    }

    func testSwitchWorkspaceChangesTheActiveWorkspace() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())
        await manager.restoreSession()

        manager.switchWorkspace(to: "mock-ws-mfs")

        XCTAssertEqual(manager.activeWorkspaceId, "mock-ws-mfs")
    }

    func testSwitchWorkspaceIgnoresAnUnknownWorkspaceId() async throws {
        let authClient = MockAuthClient()
        _ = try await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())
        await manager.restoreSession()

        manager.switchWorkspace(to: "does-not-exist")

        XCTAssertEqual(manager.activeWorkspaceId, "mock-ws-rcs")
    }

    // MARK: - login flow (signIn)

    func testSignInWithValidCredentialsReachesAuthenticatedWithUserAndWorkspaces() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())

        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        guard case .authenticated = manager.state else {
            XCTFail("expected .authenticated, got \(manager.state)")
            return
        }
        XCTAssertEqual(manager.workspaces.count, 4)
        XCTAssertNil(manager.errorMessage)
    }

    func testSignInWithInvalidCredentialsStaysSignedOutWithAnErrorMessage() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())

        await manager.signIn(email: "wrong@example.com", password: "wrong")

        XCTAssertEqual(manager.state, .signedOut)
        XCTAssertNotNil(manager.errorMessage)
        XCTAssertTrue(manager.workspaces.isEmpty)
    }

    // MARK: - logout

    func testSignOutClearsStateWorkspacesAndActiveWorkspace() async throws {
        let authClient = MockAuthClient()
        let manager = AuthenticationManager(authClient: authClient, apiClient: MockAPIClient())
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        guard case .authenticated = manager.state else {
            XCTFail("expected to be authenticated before testing sign-out")
            return
        }

        await manager.signOut()

        XCTAssertEqual(manager.state, .signedOut)
        XCTAssertNil(manager.currentUser)
        XCTAssertTrue(manager.workspaces.isEmpty)
        XCTAssertNil(manager.activeWorkspaceId)
        let session = await authClient.currentSession()
        XCTAssertNil(session)
    }

    // MARK: - onboarding (Beta Onboarding sprint)

    func testNewlyAuthenticatedUserHasNotCompletedOnboarding() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())

        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertFalse(manager.hasCompletedOnboarding)
    }

    func testCompleteOnboardingPersistsAndReflectsImmediately() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        XCTAssertFalse(manager.hasCompletedOnboarding)

        await manager.completeOnboarding()

        XCTAssertTrue(manager.hasCompletedOnboarding)
        XCTAssertNil(manager.errorMessage)
    }

    func testExistingUserWithOnboardingAlreadyCompletedSkipsIt() async throws {
        let apiClient = MockAPIClient()
        // Simulates an account that completed onboarding in a previous session, before this sign-in even happens.
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["onboardingCompleted": .bool(true)]))
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: apiClient)

        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertTrue(manager.hasCompletedOnboarding)
    }

    func testOnboardingCompletionSurvivesSignOutAndSignBackIn() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        await manager.completeOnboarding()
        XCTAssertTrue(manager.hasCompletedOnboarding)

        await manager.signOut()
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertTrue(manager.hasCompletedOnboarding)
    }

    // MARK: - beta status (Beta Tester Infrastructure sprint)

    func testAccountWithNoBetaStatusSetIsNotABetaTester() async {
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient())

        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertFalse(manager.isBetaTester)
    }

    func testAccountWithBetaStatusSetInPreferencesIsRecognizedAsABetaTester() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true)]))
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: apiClient)

        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        XCTAssertTrue(manager.isBetaTester)
    }

    func testCompleteOnboardingPreservesOtherPreferences() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["theme": .string("dark")]))
        let manager = AuthenticationManager(authClient: MockAuthClient(), apiClient: apiClient)
        await manager.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)

        await manager.completeOnboarding()

        XCTAssertTrue(manager.hasCompletedOnboarding)
        XCTAssertEqual(manager.currentUser?.preferences["theme"], .string("dark"))
    }
}
