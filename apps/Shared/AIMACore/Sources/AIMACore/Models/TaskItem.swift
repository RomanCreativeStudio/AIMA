import Foundation

/// Mirrors `backend/src/tasks/types.ts#TaskStatus`.
public enum TaskStatus: String, Codable, CaseIterable, Identifiable, Sendable {
    case todo
    case inProgress = "in_progress"
    case done
    case cancelled

    public var id: String { rawValue }

    /// The display label used by the Tasks screen (Phase 2.2, item 4).
    public var displayName: String {
        switch self {
        case .todo: return "To Do"
        case .inProgress: return "In Progress"
        case .done: return "Done"
        case .cancelled: return "Cancelled"
        }
    }
}

/// Mirrors `backend/src/tasks/types.ts#TaskPriority`.
public enum TaskPriority: String, Codable, CaseIterable, Sendable {
    case low
    case medium
    case high
}

/// Mirrors `backend/src/tasks/types.ts#Task` (Phase 1.6, Task Foundation).
/// Named `TaskItem`, not `Task`, to avoid colliding with Swift's own
/// concurrency `Task` type.
public struct TaskItem: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let title: String
    public let description: String?
    public let status: TaskStatus
    public let priority: TaskPriority
    public let dueDate: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        workspaceId: String,
        title: String,
        description: String?,
        status: TaskStatus,
        priority: TaskPriority,
        dueDate: String?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.title = title
        self.description = description
        self.status = status
        self.priority = priority
        self.dueDate = dueDate
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `backend/src/tasks/types.ts#CreateTaskInput`.
public struct CreateTaskRequest: Encodable, Sendable {
    public var title: String
    public var description: String?
    public var priority: TaskPriority?
    public var dueDate: String?

    public init(title: String, description: String? = nil, priority: TaskPriority? = nil, dueDate: String? = nil) {
        self.title = title
        self.description = description
        self.priority = priority
        self.dueDate = dueDate
    }
}

/// Mirrors `backend/src/tasks/types.ts#UpdateTaskInput`.
public struct UpdateTaskRequest: Encodable, Sendable {
    public var title: String?
    public var description: String?
    public var status: TaskStatus?
    public var priority: TaskPriority?
    public var dueDate: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        status: TaskStatus? = nil,
        priority: TaskPriority? = nil,
        dueDate: String? = nil
    ) {
        self.title = title
        self.description = description
        self.status = status
        self.priority = priority
        self.dueDate = dueDate
    }
}
