import XCTest
@testable import AIMACore

@MainActor
final class InvitationViewModelTests: XCTestCase {
    func testCreateInvitationSucceedsAndAppendsToTheList() async {
        let apiClient = MockAPIClient()
        let viewModel = InvitationViewModel(apiClient: apiClient)

        await viewModel.createInvitation(email: "prospect@example.com")

        XCTAssertEqual(viewModel.invitations.count, 1)
        XCTAssertEqual(viewModel.invitations.first?.email, "prospect@example.com")
        XCTAssertEqual(viewModel.invitations.first?.status, .pending)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testCreateInvitationSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = InvitationViewModel(apiClient: apiClient)

        await viewModel.createInvitation(email: "prospect@example.com")

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.invitations.isEmpty)
    }

    func testRefreshFetchesEveryInvitationEverIssued() async {
        let apiClient = MockAPIClient()
        _ = try? await apiClient.createInvitation(email: "first@example.com")
        _ = try? await apiClient.createInvitation(email: "second@example.com")
        let viewModel = InvitationViewModel(apiClient: apiClient)
        XCTAssertTrue(viewModel.invitations.isEmpty)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.invitations.count, 2)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testRefreshSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = InvitationViewModel(apiClient: apiClient)

        await viewModel.refresh()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.invitations.isEmpty)
    }

    func testCreateInvitationForAnAlreadyActiveBetaTesterSurfacesAnErrorAndLeavesTheListUnchanged() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true)]))
        let viewModel = InvitationViewModel(apiClient: apiClient)

        await viewModel.createInvitation(email: "you@example.com")

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.invitations.isEmpty)
    }
}
