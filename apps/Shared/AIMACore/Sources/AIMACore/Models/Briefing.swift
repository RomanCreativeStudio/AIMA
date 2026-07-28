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
    /// Most recently created/updated memories (Phase 3.5).
    public let recentMemories: [MemoryRecord]
    /// Calendar-related entries from `recentActivity` — never a live calendar fetch (see the backend's
    /// `DailyBriefing.calendarHighlights` doc comment: `read_calendar` is Tier 3/tier-locked).
    public let calendarHighlights: [ActionLogRecord]
    /// Top advisory suggestions from the Proactive Intelligence Engine (Phase 3.5) — informational only.
    public let suggestedNextActions: [Suggestion]
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
        recentMemories: [MemoryRecord] = [],
        calendarHighlights: [ActionLogRecord] = [],
        suggestedNextActions: [Suggestion] = [],
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
        self.recentMemories = recentMemories
        self.calendarHighlights = calendarHighlights
        self.suggestedNextActions = suggestedNextActions
        self.generatedAt = generatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case workspaceId, workspaceName, pendingApprovalCount, pendingApprovals, activeWorkflowCount, activeWorkflows
        case priorityTasks, recentActivity, recentMemories, calendarHighlights, suggestedNextActions, generatedAt
    }

    /// Custom decode so a payload from before Phase 3.5 (missing the three new fields) still decodes, defaulting
    /// each to an empty array — the same backward-compatible-decode posture as `SendMessageResult.memorySuggestions`.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        workspaceId = try container.decode(String.self, forKey: .workspaceId)
        workspaceName = try container.decode(String.self, forKey: .workspaceName)
        pendingApprovalCount = try container.decode(Int.self, forKey: .pendingApprovalCount)
        pendingApprovals = try container.decode([PendingApproval].self, forKey: .pendingApprovals)
        activeWorkflowCount = try container.decode(Int.self, forKey: .activeWorkflowCount)
        activeWorkflows = try container.decode([WorkflowRun].self, forKey: .activeWorkflows)
        priorityTasks = try container.decode([TaskItem].self, forKey: .priorityTasks)
        recentActivity = try container.decode([ActionLogRecord].self, forKey: .recentActivity)
        recentMemories = try container.decodeIfPresent([MemoryRecord].self, forKey: .recentMemories) ?? []
        calendarHighlights = try container.decodeIfPresent([ActionLogRecord].self, forKey: .calendarHighlights) ?? []
        suggestedNextActions = try container.decodeIfPresent([Suggestion].self, forKey: .suggestedNextActions) ?? []
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
    }
}
