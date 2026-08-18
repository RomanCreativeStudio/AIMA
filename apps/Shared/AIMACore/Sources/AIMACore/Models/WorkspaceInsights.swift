import Foundation

/// Mirrors `backend/src/insights/types.ts#ActivityMetrics`.
public struct ActivityMetrics: Codable, Equatable, Sendable {
    public let totalActions: Int
    public let successfulActions: Int
    public let failedActions: Int

    public init(totalActions: Int, successfulActions: Int, failedActions: Int) {
        self.totalActions = totalActions
        self.successfulActions = successfulActions
        self.failedActions = failedActions
    }
}

/// Mirrors `backend/src/insights/types.ts#WorkflowMetrics`. `byStatus` is
/// `[String: Int]`, not keyed by `WorkflowRunStatus`, matching every other
/// freeform-keyed dictionary already in this package (`Workspace.metadata`,
/// `UserProfile.preferences`) — `JSONDecoder` doesn't synthesize
/// enum-keyed dictionary decoding, and there's no need to fight it for a
/// display-only breakdown.
public struct WorkflowMetrics: Codable, Equatable, Sendable {
    public let totalRuns: Int
    public let activeRuns: Int
    public let completedRuns: Int
    public let byStatus: [String: Int]

    public init(totalRuns: Int, activeRuns: Int, completedRuns: Int, byStatus: [String: Int]) {
        self.totalRuns = totalRuns
        self.activeRuns = activeRuns
        self.completedRuns = completedRuns
        self.byStatus = byStatus
    }
}

/// Mirrors `backend/src/insights/types.ts#ApprovalMetrics`.
public struct ApprovalMetrics: Codable, Equatable, Sendable {
    public let total: Int
    public let pending: Int
    public let approved: Int
    public let rejected: Int
    public let expired: Int

    public init(total: Int, pending: Int, approved: Int, rejected: Int, expired: Int) {
        self.total = total
        self.pending = pending
        self.approved = approved
        self.rejected = rejected
        self.expired = expired
    }
}

/// Mirrors `backend/src/insights/types.ts#TaskCompletionMetrics`.
public struct TaskCompletionMetrics: Codable, Equatable, Sendable {
    public let total: Int
    public let todo: Int
    public let inProgress: Int
    public let done: Int
    public let cancelled: Int
    /// `done / total`, or 0 for an empty workspace.
    public let completionRate: Double

    public init(total: Int, todo: Int, inProgress: Int, done: Int, cancelled: Int, completionRate: Double) {
        self.total = total
        self.todo = todo
        self.inProgress = inProgress
        self.done = done
        self.cancelled = cancelled
        self.completionRate = completionRate
    }
}

/// Mirrors `backend/src/insights/types.ts#WorkspaceInsights` (Phase 2.5,
/// item 4), returned by `GET /api/workspaces/:id/insights`. Aggregate
/// counts only — no row-level detail, cheap enough to compute on every
/// Dashboard load.
public struct WorkspaceInsights: Codable, Equatable, Sendable {
    public let workspaceId: String
    public let activityMetrics: ActivityMetrics
    public let workflowMetrics: WorkflowMetrics
    public let approvalMetrics: ApprovalMetrics
    public let taskMetrics: TaskCompletionMetrics
    public let generatedAt: String

    public init(
        workspaceId: String,
        activityMetrics: ActivityMetrics,
        workflowMetrics: WorkflowMetrics,
        approvalMetrics: ApprovalMetrics,
        taskMetrics: TaskCompletionMetrics,
        generatedAt: String
    ) {
        self.workspaceId = workspaceId
        self.activityMetrics = activityMetrics
        self.workflowMetrics = workflowMetrics
        self.approvalMetrics = approvalMetrics
        self.taskMetrics = taskMetrics
        self.generatedAt = generatedAt
    }
}
