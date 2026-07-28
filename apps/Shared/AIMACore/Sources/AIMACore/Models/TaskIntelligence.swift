import Foundation

/// Mirrors `backend/src/insights/types.ts#RelatedTaskGroup` — a deterministic grouping of open tasks that share a
/// significant keyword in their title (`backend/src/insights/taskAnalysis.ts`). No AI call on the backend, so
/// nothing speculative to type here either.
public struct RelatedTaskGroup: Codable, Identifiable, Equatable, Sendable {
    public let keyword: String
    public let taskIds: [String]

    public var id: String { keyword }

    public init(keyword: String, taskIds: [String]) {
        self.keyword = keyword
        self.taskIds = taskIds
    }
}

/// Mirrors `backend/src/insights/types.ts#TaskIntelligence` (Phase 2.5,
/// item 2), returned by `GET /api/workspaces/:id/task-intelligence`. Pure,
/// deterministic on the backend — no AI involved, unlike
/// `ConversationIntelligence`.
public struct TaskIntelligence: Codable, Equatable, Sendable {
    public let workspaceId: String
    public let suggestedPriorities: [TaskItem]
    public let dueSoon: [TaskItem]
    public let overdue: [TaskItem]
    public let relatedGroups: [RelatedTaskGroup]
    public let generatedAt: String

    public init(
        workspaceId: String,
        suggestedPriorities: [TaskItem],
        dueSoon: [TaskItem],
        overdue: [TaskItem],
        relatedGroups: [RelatedTaskGroup],
        generatedAt: String
    ) {
        self.workspaceId = workspaceId
        self.suggestedPriorities = suggestedPriorities
        self.dueSoon = dueSoon
        self.overdue = overdue
        self.relatedGroups = relatedGroups
        self.generatedAt = generatedAt
    }
}
