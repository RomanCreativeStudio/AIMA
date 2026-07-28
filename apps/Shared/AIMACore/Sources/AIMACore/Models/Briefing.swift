import Foundation

/// Mirrors `backend/src/insights/types.ts#DailyBriefing` (Phase 2.5, item
/// 1) — a synchronous, read-only snapshot of a workspace, returned by
/// `GET /api/workspaces/:id/briefing`. Distinct from the Phase 2.4
/// `daily_workspace_briefing` *workflow*: this is a plain report with no
/// execution state of its own, safe to re-fetch as often as the Dashboard
/// likes.
public struct DailyBriefing: Codable, Equatable, Sendable {
    public let workspaceId: String
    public let workspaceName: String
    public let pendingApprovalCount: Int
    public let pendingApprovals: [PendingApproval]
    public let activeWorkflowCount: Int
    public let activeWorkflows: [WorkflowRun]
    public let priorityTasks: [TaskItem]
    public let recentActivity: [ActionLogRecord]
    public let generatedAt: String

    public init(
        workspaceId: String,
        workspaceName: String,
        pendingApprovalCount: Int,
        pendingApprovals: [PendingApproval],
        activeWorkflowCount: Int,
        activeWorkflows: [WorkflowRun],
        priorityTasks: [TaskItem],
        recentActivity: [ActionLogRecord],
        generatedAt: String
    ) {
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.pendingApprovalCount = pendingApprovalCount
        self.pendingApprovals = pendingApprovals
        self.activeWorkflowCount = activeWorkflowCount
        self.activeWorkflows = activeWorkflows
        self.priorityTasks = priorityTasks
        self.recentActivity = recentActivity
        self.generatedAt = generatedAt
    }
}
