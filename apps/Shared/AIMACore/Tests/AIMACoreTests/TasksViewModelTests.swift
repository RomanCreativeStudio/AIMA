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

    func testTasksCarryMetadataTaggedByExecutiveAssistantLoopAcceptActions() async {
        // Audit finding (Executive Assistant Loop sprint): TasksViewModel needs no code changes — it's a plain
        // pass-through of TaskItem, which already carries `metadata`. This regression-checks that a task tagged
        // via `updateTask` (the same call `ChatViewModel.blockActionSuggestion` makes) still surfaces correctly.
        let apiClient = MockAPIClient()
        let task = try! await apiClient.createTask(workspaceId: "mock-ws-rcs", request: CreateTaskRequest(title: "Design review"))
        _ = try! await apiClient.updateTask(workspaceId: "mock-ws-rcs", taskId: task.id, request: UpdateTaskRequest(metadata: ["category": .string("blocked")]))
        let viewModel = TasksViewModel(apiClient: apiClient, workspaceId: "mock-ws-rcs")

        await viewModel.load()

        let blocked = viewModel.tasks.first { $0.id == task.id }
        if case .string(let category)? = blocked?.metadata["category"] {
            XCTAssertEqual(category, "blocked")
        } else {
            XCTFail("expected the tagged task's metadata to survive TasksViewModel.load()")
        }
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
