import Foundation
import Observation

/// Backs the Dashboard screen (Phase 2.1, item 2): the active workspace,
/// system status, pending approvals, and a task overview, all loaded for
/// one workspace at a time. `@MainActor` since every observed property
/// here drives SwiftUI view updates directly. Uses the `Observation`
/// framework's `@Observable` macro rather than Combine's
/// `ObservableObject`/`@Published` — Combine has no Linux implementation,
/// and this package must build and test on Linux (see `Package.swift`).
@MainActor
@Observable
public final class DashboardViewModel {
    public private(set) var workspace: Workspace?
    public private(set) var systemHealth: SystemHealth?
    public private(set) var pendingApprovals: [PendingApproval] = []
    public private(set) var tasks: [TaskItem] = []
    /// The Daily Briefing card (Phase 2.5, item 5) — a read-only snapshot, never itself an action.
    public private(set) var dailyBriefing: DailyBriefing?
    /// Backs the Productivity Widgets (Phase 2.5, item 5): suggested priorities, due-soon/overdue counts.
    public private(set) var taskIntelligence: TaskIntelligence?
    /// Backs the Insight Cards (Phase 2.5, item 5): activity/workflow/approval/task-completion metrics.
    public private(set) var workspaceInsights: WorkspaceInsights?
    /// Backs the Pattern Insights section (Phase 3.5, item 8) — every deterministically-detected pattern, not
    /// just the subset `dailyBriefing.suggestedNextActions` turned into a suggestion.
    public private(set) var patterns: [Pattern] = []
    /// Backs the Recommendations section (Phase 3.5, item 8) — the full, ranked suggestion list. Advisory only:
    /// nothing here is ever acted on without an explicit, separate user action elsewhere in the app.
    public private(set) var suggestions: [Suggestion] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// A quick, view-friendly rollup of `tasks` — the "Tasks overview" the Dashboard shows without a full task list.
    public var taskCounts: (todo: Int, inProgress: Int, done: Int) {
        (
            tasks.filter { $0.status == .todo }.count,
            tasks.filter { $0.status == .inProgress }.count,
            tasks.filter { $0.status == .done }.count
        )
    }

    public func load(workspaceId: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let workspaceResult = apiClient.getWorkspace(id: workspaceId)
            async let healthResult = apiClient.getHealth()
            async let approvalsResult = apiClient.listApprovals(workspaceId: workspaceId, status: .pending)
            async let tasksResult = apiClient.listTasks(workspaceId: workspaceId, status: nil)
            async let briefingResult = apiClient.getDailyBriefing(workspaceId: workspaceId)
            async let taskIntelligenceResult = apiClient.getTaskIntelligence(workspaceId: workspaceId)
            async let insightsResult = apiClient.getWorkspaceInsights(workspaceId: workspaceId)
            async let patternsResult = apiClient.getProactivePatterns(workspaceId: workspaceId)
            async let suggestionsResult = apiClient.getProactiveSuggestions(workspaceId: workspaceId)

            let (workspace, health, approvals, tasks, briefing, taskIntelligence, insights, patterns, suggestions) = try await (
                workspaceResult, healthResult, approvalsResult, tasksResult, briefingResult, taskIntelligenceResult,
                insightsResult, patternsResult, suggestionsResult
            )
            self.workspace = workspace
            self.systemHealth = health
            self.pendingApprovals = approvals
            self.tasks = tasks
            self.dailyBriefing = briefing
            self.taskIntelligence = taskIntelligence
            self.workspaceInsights = insights
            self.patterns = patterns
            self.suggestions = suggestions
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func approve(_ approval: PendingApproval, workspaceId: String) async {
        do {
            _ = try await apiClient.approveApproval(workspaceId: workspaceId, approvalId: approval.id)
            pendingApprovals.removeAll { $0.id == approval.id }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func reject(_ approval: PendingApproval, workspaceId: String) async {
        do {
            _ = try await apiClient.rejectApproval(workspaceId: workspaceId, approvalId: approval.id)
            pendingApprovals.removeAll { $0.id == approval.id }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
