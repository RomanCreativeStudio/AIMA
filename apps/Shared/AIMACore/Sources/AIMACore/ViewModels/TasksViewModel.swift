import Foundation
import Observation

/// Backs the Tasks screen (Phase 2.2, item 4): a full, filterable list of a
/// workspace's tasks with status and priority — a fuller view than the
/// Dashboard's count-only overview. Scoped to one workspace, like
/// `ChatViewModel`/`ApprovalsViewModel`. Uses `@Observable` (not Combine) so
/// this package stays Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class TasksViewModel {
    public private(set) var tasks: [TaskItem] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    public private(set) var statusFilter: TaskStatus?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            tasks = try await apiClient.listTasks(workspaceId: workspaceId, status: statusFilter)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Re-fetches with a new status filter (`nil` means "all statuses") —
    /// an explicit method rather than a `didSet` observer, matching
    /// `ApprovalsViewModel.setStatusFilter`.
    public func setStatusFilter(_ status: TaskStatus?) async {
        statusFilter = status
        await load()
    }
}
