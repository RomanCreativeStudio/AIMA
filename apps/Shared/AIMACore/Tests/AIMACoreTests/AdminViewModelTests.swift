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

    func testMarkReviewedAdvancesStatusAndPatchesTheRowInPlace() async throws {
        let apiClient = MockAPIClient()
        let submitted = try await apiClient.submitFeedback(workspaceId: "mock-ws-rcs", request: CreateFeedbackRequest(message: "needs review"))
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.load()
        XCTAssertEqual(viewModel.recentFeedback.count, 1)

        await viewModel.markReviewed(submitted.id)

        XCTAssertEqual(viewModel.recentFeedback.first?.status, .reviewed)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testMarkResolvedAdvancesStatusAfterReviewed() async throws {
        let apiClient = MockAPIClient()
        let submitted = try await apiClient.submitFeedback(workspaceId: "mock-ws-rcs", request: CreateFeedbackRequest(message: "x"))
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.load()
        await viewModel.markReviewed(submitted.id)

        await viewModel.markResolved(submitted.id)

        XCTAssertEqual(viewModel.recentFeedback.first?.status, .resolved)
    }

    func testMarkResolvedFromNewSurfacesAnErrorAndLeavesTheRowUnchanged() async throws {
        let apiClient = MockAPIClient()
        let submitted = try await apiClient.submitFeedback(workspaceId: "mock-ws-rcs", request: CreateFeedbackRequest(message: "x"))
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.load()

        await viewModel.markResolved(submitted.id)

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.recentFeedback.first?.status, .new)
    }

    func testSearchBetaUsersFiltersByQueryMatchingTheAccount() async throws {
        let apiClient = MockAPIClient()
        _ = try await apiClient.updateUserProfile(id: "mock-user", request: UpdateUserProfileRequest(preferences: ["betaTester": .bool(true)]))
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.load()

        viewModel.betaUserQuery = "you@example.com"
        await viewModel.searchBetaUsers()
        XCTAssertEqual(viewModel.betaUsers.count, 1)

        viewModel.betaUserQuery = "no-such-match"
        await viewModel.searchBetaUsers()
        XCTAssertTrue(viewModel.betaUsers.isEmpty)
    }

    func testLoadAllUsersReturnsTheSeededAccountRegardlessOfBetaStatus() async throws {
        let apiClient = MockAPIClient()
        let viewModel = AdminViewModel(apiClient: apiClient)

        await viewModel.loadAllUsers()

        XCTAssertEqual(viewModel.allUsers.count, 1)
        XCTAssertEqual(viewModel.allUsers.first?.userId, "mock-user")
        XCTAssertEqual(viewModel.allUsers.first?.betaTester, false)
    }

    func testUpdateUserTogglesBetaTesterAndRefreshesBothLists() async throws {
        let apiClient = MockAPIClient()
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.loadAllUsers()
        XCTAssertEqual(viewModel.allUsers.first?.betaTester, false)

        await viewModel.updateUser("mock-user", betaTester: true)

        XCTAssertEqual(viewModel.allUsers.first?.betaTester, true)
        XCTAssertEqual(viewModel.betaUsers.count, 1)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testUpdateUserRecordsAdminNotesAndTags() async throws {
        let apiClient = MockAPIClient()
        let viewModel = AdminViewModel(apiClient: apiClient)
        await viewModel.loadAllUsers()

        await viewModel.updateUser("mock-user", adminNotes: "Invited via Discord", adminTags: ["design-partner"])

        XCTAssertEqual(viewModel.allUsers.first?.adminNotes, "Invited via Discord")
        XCTAssertEqual(viewModel.allUsers.first?.adminTags, ["design-partner"])
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
