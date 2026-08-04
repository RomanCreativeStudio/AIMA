import XCTest
@testable import AIMACore

@MainActor
final class FeedbackViewModelTests: XCTestCase {
    func testLoadStartsEmptyForAWorkspaceWithNoSubmissionsYet() async {
        let apiClient = MockAPIClient()
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertTrue(viewModel.submissions.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSubmitAddsTheNewFeedbackToSubmissionsImmediately() async {
        let apiClient = MockAPIClient()
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        let succeeded = await viewModel.submit(type: .bug, message: "The dashboard flickers on load.")

        XCTAssertTrue(succeeded)
        XCTAssertEqual(viewModel.submissions.count, 1)
        XCTAssertEqual(viewModel.submissions.first?.type, .bug)
        XCTAssertEqual(viewModel.submissions.first?.message, "The dashboard flickers on load.")
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSubmittedFeedbackIsScopedToTheGivenWorkspace() async {
        let apiClient = MockAPIClient()
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-mfs")

        _ = await viewModel.submit(type: .feature, message: "Would love dark mode.")

        XCTAssertEqual(viewModel.submissions.first?.workspaceId, "mock-ws-mfs")
    }

    func testLoadAfterSubmitReturnsThePreviouslySubmittedFeedback() async {
        let apiClient = MockAPIClient()
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        _ = await viewModel.submit(type: .general, message: "Loving the beta!")

        let reloaded = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await reloaded.load()

        XCTAssertEqual(reloaded.submissions.count, 1)
        XCTAssertEqual(reloaded.submissions.first?.message, "Loving the beta!")
    }

    func testSubmissionsAreIsolatedPerWorkspace() async {
        let apiClient = MockAPIClient()
        let rcsViewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        let mfsViewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-mfs")
        _ = await rcsViewModel.submit(type: .bug, message: "Feedback for RCS")
        _ = await mfsViewModel.submit(type: .bug, message: "Feedback for MFS")

        await rcsViewModel.load()
        await mfsViewModel.load()

        XCTAssertEqual(rcsViewModel.submissions.count, 1)
        XCTAssertEqual(rcsViewModel.submissions.first?.message, "Feedback for RCS")
        XCTAssertEqual(mfsViewModel.submissions.count, 1)
        XCTAssertEqual(mfsViewModel.submissions.first?.message, "Feedback for MFS")
    }

    func testSubmitSurfacesAPIErrorsAsUserFacingMessagesAndReturnsFalse() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        let succeeded = await viewModel.submit(type: .bug, message: "x")

        XCTAssertFalse(succeeded)
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.submissions.isEmpty)
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = FeedbackViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.submissions.isEmpty)
    }
}
