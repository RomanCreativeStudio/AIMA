import Foundation

/// Mirrors `backend/src/insights/types.ts#DailyBriefing` (Phase 2.5, item
/// 1) — a synchronous, read-only snapshot of a workspace, returned by
/// `GET /api/workspaces/:id/daily-briefing` (Alpha Daily Briefing sprint;
/// `/briefing` is the same payload at the original Phase 2.5 path, kept
/// mounted for backward compatibility). Distinct from the Phase 2.4
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
    /// A deterministic, time-of-day greeting (Alpha Daily Briefing sprint) — e.g. "Good morning! Here's what's
    /// happening in RCS."
    public let greeting: String
    /// Open tasks past their due date (Alpha Daily Briefing sprint) — may overlap with `priorityTasks`.
    public let overdueTasks: [TaskItem]
    /// Connected integrations that need attention: erroring, enabled-but-disconnected, or an already-expired
    /// token (Alpha Daily Briefing sprint). Empty when the backend's `IntegrationService` isn't configured.
    public let integrationsNeedingAttention: [WorkspaceIntegration]
    /// Auto-saved memories whose outcome is still open — `reminder`, `decision`, or `project_update`, never
    /// `completed_task` (Personal Workspace Memory sprint). Drawn from the same fetch as `recentMemories`, not a
    /// second query — see the backend's `isOpenCommitment` in `briefingService.ts`.
    public let openCommitments: [MemoryRecord]
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
        greeting: String = "",
        overdueTasks: [TaskItem] = [],
        integrationsNeedingAttention: [WorkspaceIntegration] = [],
        openCommitments: [MemoryRecord] = [],
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
        self.greeting = greeting
        self.overdueTasks = overdueTasks
        self.integrationsNeedingAttention = integrationsNeedingAttention
        self.openCommitments = openCommitments
        self.generatedAt = generatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case workspaceId, workspaceName, pendingApprovalCount, pendingApprovals, activeWorkflowCount, activeWorkflows
        case priorityTasks, recentActivity, recentMemories, calendarHighlights, suggestedNextActions
        case greeting, overdueTasks, integrationsNeedingAttention, openCommitments, generatedAt
    }

    /// Custom decode so a payload missing newer fields still decodes, defaulting each to an empty array/string —
    /// the same backward-compatible-decode posture as `SendMessageResult.memorySuggestions`. `greeting`,
    /// `overdueTasks`, `integrationsNeedingAttention` are Alpha Daily Briefing sprint additions; `openCommitments`
    /// is a Personal Workspace Memory sprint addition; the rest predate Phase 3.5.
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
        greeting = try container.decodeIfPresent(String.self, forKey: .greeting) ?? ""
        overdueTasks = try container.decodeIfPresent([TaskItem].self, forKey: .overdueTasks) ?? []
        integrationsNeedingAttention = try container.decodeIfPresent([WorkspaceIntegration].self, forKey: .integrationsNeedingAttention) ?? []
        openCommitments = try container.decodeIfPresent([MemoryRecord].self, forKey: .openCommitments) ?? []
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
    }
}
