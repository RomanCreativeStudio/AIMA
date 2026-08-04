import XCTest
@testable import AIMACore

@MainActor
final class AdminViewModelTests: XCTestCase {
    func testLoadReturnsNoBetaUsersWhenTheSeededAccountIsNotMarkedAsOne() async {
        let apiClient = MockAPIClient()
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertTrue(viewModel.betaUsers.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadReturnsTheSeededAccountOnceMarkedAsABetaTester() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true)]))
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertEqual(viewModel.betaUsers.count, 1)
        XCTAssertEqual(viewModel.betaUsers.first?.userId, "mock-user")
        XCTAssertEqual(viewModel.betaUsers.first?.email, "you@example.com")
    }

    func testBetaUserSummaryReportsFeedbackCount() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true)]))
        _ = try await apiClient.submitFeedback(workspaceId: "mock-ws-rcs", request: CreateFeedbackRequest(type: .bug, message: "one"))
        _ = try await apiClient.submitFeedback(workspaceId: "mock-ws-mfs", request: CreateFeedbackRequest(type: .feature, message: "two"))
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertEqual(viewModel.betaUsers.first?.feedbackCount, 2)
    }

    func testBetaUserSummaryReportsOnboardingCompletedStatus() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true), "onboardingCompleted": .bool(true)]))
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertEqual(viewModel.betaUsers.first?.onboardingCompleted, true)
    }

    func testLoadAggregatesRecentFeedbackAcrossWorkspaces() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.submitFeedback(workspaceId: "mock-ws-rcs", request: CreateFeedbackRequest(message: "first"))
        _ = try await apiClient.submitFeedback(workspaceId: "mock-ws-mfs", request: CreateFeedbackRequest(message: "second"))
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertEqual(viewModel.recentFeedback.count, 2)
        XCTAssertTrue(viewModel.recentFeedback.allSatisfy { !$0.userEmail.isEmpty && !$0.workspaceName.isEmpty })
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.betaUsers.isEmpty)
        XCTAssertTrue(viewModel.recentFeedback.isEmpty)
    }
}
