import XCTest
@testable import AIMACore

@MainActor
final class SearchViewModelTests: XCTestCase {
    func testSearchReturnsOnlyContentMatchingTheQuery() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "client call"

        await viewModel.search()

        XCTAssertFalse(viewModel.results.isEmpty)
        XCTAssertTrue(viewModel.results.allSatisfy { $0.content.lowercased().contains("client call") })
    }

    func testSearchWithBlankQueryClearsResultsWithoutCallingTheAPI() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "client call"
        await viewModel.search()
        XCTAssertFalse(viewModel.results.isEmpty, "sanity check: results exist before clearing")

        viewModel.query = "   "
        await viewModel.search()

        XCTAssertTrue(viewModel.results.isEmpty)
    }

    func testSourceTypeFilterNarrowsResultsToThatSourceType() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "client"
        viewModel.sourceTypeFilter = .task

        await viewModel.search()

        XCTAssertTrue(viewModel.results.allSatisfy { $0.sourceType == .task })
    }

    func testSearchSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "client call"

        await viewModel.search()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.results.isEmpty)
    }

    func testLoadContextPopulatesMergedMemoriesConversationsAndTasks() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "Acme"

        await viewModel.loadContext()

        XCTAssertNotNil(viewModel.context)
    }

    func testLoadContextWithBlankQueryClearsContextWithoutCallingTheAPI() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "Acme"
        await viewModel.loadContext()
        XCTAssertNotNil(viewModel.context, "sanity check: context exists before clearing")

        viewModel.query = ""
        await viewModel.loadContext()

        XCTAssertNil(viewModel.context)
    }

    func testReindexPopulatesLastReindexResult() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.reindex()

        XCTAssertNotNil(viewModel.lastReindexResult)
        XCTAssertFalse(viewModel.isReindexing)
    }

    func testClearResetsQueryResultsAndContext() async {
        let apiClient = MockAPIClient()
        let viewModel = SearchViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        viewModel.query = "client call"
        await viewModel.search()
        await viewModel.loadContext()

        viewModel.clear()

        XCTAssertEqual(viewModel.query, "")
        XCTAssertTrue(viewModel.results.isEmpty)
        XCTAssertNil(viewModel.context)
    }
}
