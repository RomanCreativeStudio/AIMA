import XCTest
@testable import AIMACore

@MainActor
final class TasksViewModelTests: XCTestCase {
    func testLoadListsAllTasksInTheWorkspaceByDefault() async {
        let apiClient = MockAPIClient()
        let viewModel = TasksViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertEqual(viewModel.tasks.count, 2)
        XCTAssertNil(viewModel.statusFilter)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testSetStatusFilterReloadsWithOnlyMatchingTasks() async {
        let apiClient = MockAPIClient()
        let viewModel = TasksViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")
        await viewModel.load()

        await viewModel.setStatusFilter(.inProgress)

        XCTAssertEqual(viewModel.tasks.count, 1)
        XCTAssertEqual(viewModel.tasks.first?.status, .inProgress)
    }

    func testTasksCarryPriorityForTheScreensPriorityIndicators() async {
        let apiClient = MockAPIClient()
        let viewModel = TasksViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertTrue(viewModel.tasks.contains { $0.priority == .high })
        XCTAssertTrue(viewModel.tasks.contains { $0.priority == .medium })
    }

    func testLoadSurfacesAPIErrorsAsUserFacingMessages() async {
        let apiClient = MockAPIClient()
        await apiClient.setShouldFail(true)
        let viewModel = TasksViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.tasks.isEmpty)
    }
}
