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
    /// Conversation → Action sprint: `"conversation_suggestion"` when accepted from a Chat suggestion, `nil` for a hand-typed task.
    public let source: String?
    /// Conversation → Action sprint: for a `source: "conversation_suggestion"` task, carries `{"category": "todo" | "follow_up" | "meeting"}`. `[:]` for a hand-typed task.
    public let metadata: [String: JSONValue]
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
        source: String? = nil,
        metadata: [String: JSONValue] = [:],
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
        self.source = source
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, workspaceId, title, description, status, priority, dueDate, source, metadata, createdAt, updatedAt
    }

    /// Custom decode so a payload from before the Conversation → Action sprint (missing `source`/`metadata`
    /// entirely) still decodes, defaulting to `nil`/`[:]` — the same backward-compatible-decode posture as
    /// `MemoryRecord`'s scoring/lifecycle fields.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        workspaceId = try container.decode(String.self, forKey: .workspaceId)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        status = try container.decode(TaskStatus.self, forKey: .status)
        priority = try container.decode(TaskPriority.self, forKey: .priority)
        dueDate = try container.decodeIfPresent(String.self, forKey: .dueDate)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        metadata = try container.decodeIfPresent([String: JSONValue].self, forKey: .metadata) ?? [:]
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
    }
}

/// Mirrors `backend/src/tasks/types.ts#CreateTaskInput`.
public struct CreateTaskRequest: Encodable, Sendable {
    public var title: String
    public var description: String?
    public var priority: TaskPriority?
    public var dueDate: String?
    /// Conversation → Action sprint: pass `"conversation_suggestion"` when this request is accepting a Chat suggestion.
    public var source: String?
    public var metadata: [String: JSONValue]?

    public init(
        title: String,
        description: String? = nil,
        priority: TaskPriority? = nil,
        dueDate: String? = nil,
        source: String? = nil,
        metadata: [String: JSONValue]? = nil
    ) {
        self.title = title
        self.description = description
        self.priority = priority
        self.dueDate = dueDate
        self.source = source
        self.metadata = metadata
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
