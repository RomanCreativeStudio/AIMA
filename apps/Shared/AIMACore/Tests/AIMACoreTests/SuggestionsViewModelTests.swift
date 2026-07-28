import XCTest
@testable import AIMACore

@MainActor
final class SuggestionsViewModelTests: XCTestCase {
    func testLoadPopulatesPatternsAndSuggestionsForTheWorkspace() async {
        let apiClient = MockAPIClient()
        let viewModel = SuggestionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertFalse(viewModel.patterns.isEmpty)
        XCTAssertFalse(viewModel.suggestions.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testLoadReturnsNothingForAWorkspaceWithNoSeedData() async {
        let apiClient = MockAPIClient()
        let viewModel = SuggestionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-personal")

        await viewModel.load()

        XCTAssertTrue(viewModel.patterns.isEmpty)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testSuggestionsOfTypeFiltersByType() async {
        let apiClient = MockAPIClient()
        let viewModel = SuggestionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        let workflowOnly = viewModel.suggestions(ofType: .workflow)
        XCTAssertTrue(workflowOnly.allSatisfy { $0.type == .workflow })

        let all = viewModel.suggestions(ofType: nil)
        XCTAssertEqual(all.count, viewModel.suggestions.count)
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = SuggestionsViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.patterns.isEmpty)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }
}
