import XCTest
@testable import AIMACore

@MainActor
final class MemoryViewModelTests: XCTestCase {
    func testLoadListsAllActiveMemoriesInTheWorkspaceByDefault() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertEqual(viewModel.memories.count, 2)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSetScopeFilterReloadsWithOnlyMatchingMemories() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.setScopeFilter(.user)

        XCTAssertEqual(viewModel.memories.count, 1)
        XCTAssertEqual(viewModel.memories.first?.scope, .user)
    }

    func testMemoriesCarryImportanceAndConfidenceForTheScreensIndicators() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertTrue(viewModel.memories.allSatisfy { $0.importanceScore != nil && $0.confidenceScore != nil })
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.memories.isEmpty)
    }

    func testSearchReturnsOnlyContentMatchingTheQuery() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.search("Acme")

        XCTAssertEqual(viewModel.searchResults.count, 1)
        XCTAssertTrue(viewModel.searchResults[0].content.contains("Acme"))
    }

    func testSearchWithBlankQueryClearsResultsWithoutCallingTheAPI() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.search("Acme")
        XCTAssertFalse(viewModel.searchResults.isEmpty)

        await viewModel.search("   ")

        XCTAssertTrue(viewModel.searchResults.isEmpty)
    }

    func testClearSearchResetsQueryAndResults() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.search("Acme")

        viewModel.clearSearch()

        XCTAssertEqual(viewModel.searchQuery, "")
        XCTAssertTrue(viewModel.searchResults.isEmpty)
    }

    func testCreateMemoryPrependsItToTheList() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let originalCount = viewModel.memories.count

        await viewModel.createMemory(CreateMemoryRequest(scope: .workspace, content: "A brand-new memory."))

        XCTAssertEqual(viewModel.memories.count, originalCount + 1)
        XCTAssertEqual(viewModel.memories.first?.content, "A brand-new memory.")
        XCTAssertNil(viewModel.errorMessage)
    }

    func testUpdateMemoryReplacesItInPlaceWithNewContentAndScores() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let target = viewModel.memories[0]

        await viewModel.updateMemory(target, request: UpdateMemoryRequest(content: "Edited content.", importanceScore: 0.95))

        let updated = viewModel.memories.first { $0.id == target.id }
        XCTAssertEqual(updated?.content, "Edited content.")
        XCTAssertEqual(updated?.importanceScore, 0.95)
    }

    func testArchiveRemovesTheMemoryFromTheDefaultListButKeepsItWhenIncludingArchived() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let target = viewModel.memories[0]

        await viewModel.archive(target)

        XCTAssertFalse(viewModel.memories.contains { $0.id == target.id })

        await viewModel.setIncludeArchived(true)
        let archived = viewModel.memories.first { $0.id == target.id }
        XCTAssertNotNil(archived)
        XCTAssertTrue(archived?.isArchived ?? false)
    }

    func testDeleteRemovesTheMemoryPermanently() async {
        let apiClient = MockAPIClient()
        let viewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()
        let target = viewModel.memories[0]

        await viewModel.delete(target)

        XCTAssertFalse(viewModel.memories.contains { $0.id == target.id })

        await viewModel.setIncludeArchived(true)
        XCTAssertFalse(viewModel.memories.contains { $0.id == target.id })
    }

    func testMemoriesAreIsolatedByWorkspace() async {
        let apiClient = MockAPIClient()
        let rcsViewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        let otherViewModel = MemoryViewModel(apiClient: apiClient, workspaceId: "mock-ws-mfs")

        await rcsViewModel.load()
        await otherViewModel.load()

        XCTAssertEqual(rcsViewModel.memories.count, 2)
        XCTAssertTrue(otherViewModel.memories.isEmpty)
    }
}
