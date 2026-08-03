import XCTest
@testable import AIMACore

@MainActor
final class AuthenticationViewModelTests: XCTestCase {
    func testInitialStateIsSignedOutWithNoErrorOrLoading() {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())

        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSignInWithValidCredentialsTransitionsToAuthenticatedAndClearsThePassword() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())
        viewModel.email = MockAuthClient.seededEmail
        viewModel.password = MockAuthClient.seededPassword

        await viewModel.signIn()

        XCTAssertTrue(viewModel.isAuthenticated)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.currentUser?.email, MockAuthClient.seededEmail)
        XCTAssertEqual(viewModel.password, "")
    }

    func testSignInWithInvalidCredentialsStaysSignedOutAndSetsAnErrorMessage() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())
        viewModel.email = "wrong@example.com"
        viewModel.password = "wrong-password"

        await viewModel.signIn()

        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testSignInWithEmptyFieldsNeverCallsTheAuthClient() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())
        viewModel.email = ""
        viewModel.password = ""

        await viewModel.signIn()

        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertEqual(viewModel.errorMessage, "Enter your email and password.")
    }

    func testSignOutReturnsToSignedOutStateAndClearsFields() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())
        viewModel.email = MockAuthClient.seededEmail
        viewModel.password = MockAuthClient.seededPassword
        await viewModel.signIn()
        XCTAssertTrue(viewModel.isAuthenticated)

        await viewModel.signOut()

        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.email, "")
        XCTAssertEqual(viewModel.password, "")
    }

    func testOnCurrentUserChangeFiresOnSignInAndSignOut() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())
        var reportedUsers: [AuthenticatedUser?] = []
        viewModel.onCurrentUserChange = { reportedUsers.append($0) }

        viewModel.email = MockAuthClient.seededEmail
        viewModel.password = MockAuthClient.seededPassword
        await viewModel.signIn()
        await viewModel.signOut()

        XCTAssertEqual(reportedUsers.count, 2)
        XCTAssertEqual(reportedUsers[0]?.email, MockAuthClient.seededEmail)
        XCTAssertNil(reportedUsers[1])
    }

    func testRestoreExistingSessionReflectsAnAlreadySignedInClient() async {
        let authClient = MockAuthClient()
        _ = try? await authClient.signIn(email: MockAuthClient.seededEmail, password: MockAuthClient.seededPassword)
        let viewModel = AuthenticationViewModel(authClient: authClient)

        await viewModel.restoreExistingSession()

        XCTAssertTrue(viewModel.isAuthenticated)
        XCTAssertEqual(viewModel.currentUser?.email, MockAuthClient.seededEmail)
    }

    func testRestoreExistingSessionWithNoSessionStaysSignedOut() async {
        let viewModel = AuthenticationViewModel(authClient: MockAuthClient())

        await viewModel.restoreExistingSession()

        XCTAssertFalse(viewModel.isAuthenticated)
        XCTAssertNil(viewModel.currentUser)
    }
}
