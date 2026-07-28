import XCTest
@testable import AIMACore

@MainActor
final class IntegrationsViewModelTests: XCTestCase {
    func testLoadPopulatesAllThreeSeededIntegrations() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertEqual(viewModel.integrations.count, 3)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testConnectUpdatesTheMatchingIntegrationInPlaceAndSetsAConfirmation() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.connect(provider: .gmail, credentials: ["accessToken": "a", "refreshToken": "b"])

        let gmail = viewModel.integrations.first { $0.provider == .gmail }
        XCTAssertEqual(gmail?.enabled, true)
        XCTAssertEqual(gmail?.status, .connected)
        XCTAssertEqual(viewModel.integrations.count, 3, "connect should update the existing row, not add a new one")
        XCTAssertNotNil(viewModel.lastActionConfirmation)
    }

    func testConnectSurfacesMissingCredentialFieldsAsAnErrorAndClearsAnyPriorConfirmation() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.connect(provider: .gmail, credentials: ["accessToken": "a"])

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.lastActionConfirmation)
        let gmail = viewModel.integrations.first { $0.provider == .gmail }
        XCTAssertEqual(gmail?.enabled, false, "a failed connect should not change the stored status")
    }

    func testDisconnectDisablesAnAlreadyConnectedIntegration() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        // github is seeded as already-connected in MockAPIClient.
        precondition(viewModel.integrations.first { $0.provider == .github }?.enabled == true)

        await viewModel.disconnect(provider: .github)

        let github = viewModel.integrations.first { $0.provider == .github }
        XCTAssertEqual(github?.enabled, false)
        XCTAssertEqual(github?.status, .disconnected)
    }

    func testRotateReplacesCredentialsForAnAlreadyConnectedIntegration() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.rotate(provider: .github, credentials: ["accessToken": "rotated"])

        XCTAssertNil(viewModel.errorMessage)
        XCTAssertNotNil(viewModel.lastActionConfirmation)
    }

    func testRotateFailsForAnIntegrationThatIsNotCurrentlyConnected() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.rotate(provider: .gmail, credentials: ["accessToken": "a", "refreshToken": "b"])

        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testStartOAuthConnectionReturnsTheAuthorizationURL() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        let url = await viewModel.startOAuthConnection(provider: .gmail)

        XCTAssertNotNil(url)
        XCTAssertNil(viewModel.errorMessage)
        // Never itself connects anything — the mock's OAuth callback is a separate, explicit step.
        let gmail = viewModel.integrations.first { $0.provider == .gmail }
        XCTAssertEqual(gmail?.enabled, false)
    }

    func testStartOAuthConnectionSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        let url = await viewModel.startOAuthConnection(provider: .gmail)

        XCTAssertNil(url)
        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testOAuthCallbackCompletionIsReflectedOnlyAfterAnExplicitReload() async {
        let apiClient = MockAPIClient()
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        _ = await viewModel.startOAuthConnection(provider: .gmail)
        // The backend completes the connection server-side; the view model only reflects it on its next load().
        XCTAssertEqual(viewModel.integrations.first { $0.provider == .gmail }?.enabled, false)

        await apiClient.simulateOAuthCallback(workspaceId: "mock-ws-rcs", provider: .gmail)
        await viewModel.load()

        let gmail = viewModel.integrations.first { $0.provider == .gmail }
        XCTAssertEqual(gmail?.enabled, true)
        XCTAssertEqual(gmail?.status, .connected)
        XCTAssertNotNil(gmail?.tokenExpiresAt, "a completed OAuth connection carries a token expiration")
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = IntegrationsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.integrations.isEmpty)
    }
}
