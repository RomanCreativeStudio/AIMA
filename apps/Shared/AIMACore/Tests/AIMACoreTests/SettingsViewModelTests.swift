import XCTest
@testable import AIMACore

@MainActor
final class SettingsViewModelTests: XCTestCase {
    func testLoadPopulatesTheUserProfile() async {
        let apiClient = MockAPIClient()
        let viewModel = SettingsViewModel(apiClient: apiClient, userId: "mock-user", currentConfiguration: .developmentDefault)

        await viewModel.load()

        XCTAssertEqual(viewModel.user?.id, "mock-user")
        XCTAssertEqual(viewModel.backendBaseURLText, APIConfiguration.developmentDefault.baseURL.absoluteString)
    }

    func testSaveProfileUpdatesDisplayNameAndCommunicationStyle() async {
        let apiClient = MockAPIClient()
        let viewModel = SettingsViewModel(apiClient: apiClient, userId: "mock-user", currentConfiguration: .developmentDefault)
        await viewModel.load()

        await viewModel.saveProfile(displayName: "New Name", communicationStyle: "concise")

        XCTAssertEqual(viewModel.user?.displayName, "New Name")
        XCTAssertEqual(viewModel.saveConfirmation, "Saved.")
        XCTAssertNil(viewModel.errorMessage)
    }

    func testApplyBackendURLCallsTheChangeHandlerForAValidURL() {
        let apiClient = MockAPIClient()
        let viewModel = SettingsViewModel(apiClient: apiClient, userId: "mock-user", currentConfiguration: .developmentDefault)
        var receivedURL: URL?
        viewModel.onBackendURLChange = { receivedURL = $0 }

        viewModel.backendBaseURLText = "http://192.168.1.50:4000"
        viewModel.applyBackendURL()

        XCTAssertEqual(receivedURL?.absoluteString, "http://192.168.1.50:4000")
        XCTAssertNil(viewModel.errorMessage)
    }

    func testApplyBackendURLRejectsAnInvalidURLWithoutCallingTheHandler() {
        let apiClient = MockAPIClient()
        let viewModel = SettingsViewModel(apiClient: apiClient, userId: "mock-user", currentConfiguration: .developmentDefault)
        var handlerCalled = false
        viewModel.onBackendURLChange = { _ in handlerCalled = true }

        viewModel.backendBaseURLText = "not a url"
        viewModel.applyBackendURL()

        XCTAssertFalse(handlerCalled)
        XCTAssertNotNil(viewModel.errorMessage)
    }
}
