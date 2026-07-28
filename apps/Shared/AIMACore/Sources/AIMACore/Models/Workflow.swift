import Foundation

/// Mirrors `backend/src/workflows/types.ts#WorkflowKey` (Phase 2.4) — the
/// four built-in, fixed workflows this foundation phase ships.
public enum WorkflowKey: String, Codable, CaseIterable, Identifiable, Sendable {
    case draftEmailReply = "draft_email_reply"
    case createGithubIssueDraft = "create_github_issue_draft"
    case summarizeUnreadEmail = "summarize_unread_email"
    case dailyWorkspaceBriefing = "daily_workspace_briefing"

    public var id: String { rawValue }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowRunStatus`.
public enum WorkflowRunStatus: String, Codable, Sendable {
    case pending
    case running
    case awaitingApproval = "awaiting_approval"
    case paused
    case completed
    case failed
    case cancelled
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowStepStatus`.
public enum WorkflowStepStatus: String, Codable, Sendable {
    case pending
    case completed
    case awaitingApproval = "awaiting_approval"
    case failed
    case skipped
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowStepDefinition` — one
/// step's static metadata. `capability` is present only for a step gated by
/// a capability; a step with none is internal and always auto-executes.
public struct WorkflowStepDefinition: Codable, Identifiable, Equatable, Sendable {
    public let key: String
    public let displayName: String
    public let capability: String?

    public var id: String { key }

    public init(key: String, displayName: String, capability: String?) {
        self.key = key
        self.displayName = displayName
        self.capability = capability
    }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowDefinition` — one
/// built-in workflow's shape, as returned by `GET /api/workflows`.
public struct WorkflowDefinition: Codable, Identifiable, Equatable, Sendable {
    public let key: WorkflowKey
    public let displayName: String
    public let description: String
    public let steps: [WorkflowStepDefinition]
    public let triggerPhrases: [String]

    public var id: String { key.rawValue }

    public init(
        key: WorkflowKey,
        displayName: String,
        description: String,
        steps: [WorkflowStepDefinition],
        triggerPhrases: [String]
    ) {
        self.key = key
        self.displayName = displayName
        self.description = description
        self.steps = steps
        self.triggerPhrases = triggerPhrases
    }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowStepRun` — one step's
/// actual execution record for one run, what the Workflow detail screen's
/// step progress list (Phase 2.4, item 5) renders.
public struct WorkflowStepRun: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workflowRunId: String
    public let stepIndex: Int
    public let stepKey: String
    public let status: WorkflowStepStatus
    public let capability: String?
    public let pendingApprovalId: String?
    public let output: [String: JSONValue]?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        workflowRunId: String,
        stepIndex: Int,
        stepKey: String,
        status: WorkflowStepStatus,
        capability: String?,
        pendingApprovalId: String?,
        output: [String: JSONValue]?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.workflowRunId = workflowRunId
        self.stepIndex = stepIndex
        self.stepKey = stepKey
        self.status = status
        self.capability = capability
        self.pendingApprovalId = pendingApprovalId
        self.output = output
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowRun` — what a history
/// list needs, without embedded step detail.
public struct WorkflowRun: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let workflowKey: WorkflowKey
    public let status: WorkflowRunStatus
    public let currentStepIndex: Int
    public let input: [String: String]
    public let result: [String: JSONValue]?
    public let createdAt: String
    public let updatedAt: String
    public let completedAt: String?

    public init(
        id: String,
        workspaceId: String,
        workflowKey: WorkflowKey,
        status: WorkflowRunStatus,
        currentStepIndex: Int,
        input: [String: String],
        result: [String: JSONValue]?,
        createdAt: String,
        updatedAt: String,
        completedAt: String?
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.workflowKey = workflowKey
        self.status = status
        self.currentStepIndex = currentStepIndex
        self.input = input
        self.result = result
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
    }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowRunDetail` — a run plus
/// its full step history, what the Workflow detail screen needs. A
/// separate, field-duplicating struct rather than composing `WorkflowRun`,
/// since the backend's JSON is flat (`steps` is a sibling field, not
/// nested under a `run` key) — Codable synthesis needs the shape to match.
public struct WorkflowRunDetail: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let workflowKey: WorkflowKey
    public let status: WorkflowRunStatus
    public let currentStepIndex: Int
    public let input: [String: String]
    public let result: [String: JSONValue]?
    public let createdAt: String
    public let updatedAt: String
    public let completedAt: String?
    public let steps: [WorkflowStepRun]

    public init(
        id: String,
        workspaceId: String,
        workflowKey: WorkflowKey,
        status: WorkflowRunStatus,
        currentStepIndex: Int,
        input: [String: String],
        result: [String: JSONValue]?,
        createdAt: String,
        updatedAt: String,
        completedAt: String?,
        steps: [WorkflowStepRun]
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.workflowKey = workflowKey
        self.status = status
        self.currentStepIndex = currentStepIndex
        self.input = input
        self.result = result
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
        self.steps = steps
    }

    /// The plain `WorkflowRun` shape (no step detail) — e.g. for a shared history-row view that lists both freshly-created and previously-fetched runs.
    public var asRun: WorkflowRun {
        WorkflowRun(
            id: id, workspaceId: workspaceId, workflowKey: workflowKey, status: status,
            currentStepIndex: currentStepIndex, input: input, result: result,
            createdAt: createdAt, updatedAt: updatedAt, completedAt: completedAt
        )
    }
}

/// Mirrors `backend/src/workflows/types.ts#WorkflowSuggestion` — an
/// advisory, non-executing preview (Phase 2.4, item 4) surfaced on a chat
/// response when the user's message matches a built-in workflow. Never
/// itself creates or executes a `WorkflowRun`.
public struct WorkflowSuggestion: Codable, Equatable, Sendable {
    public let workflowKey: WorkflowKey
    public let displayName: String
    public let description: String
    public let confidence: Double
    public let steps: [WorkflowStepDefinition]
    public let extractedInput: [String: String]

    public init(
        workflowKey: WorkflowKey,
        displayName: String,
        description: String,
        confidence: Double,
        steps: [WorkflowStepDefinition],
        extractedInput: [String: String]
    ) {
        self.workflowKey = workflowKey
        self.displayName = displayName
        self.description = description
        self.confidence = confidence
        self.steps = steps
        self.extractedInput = extractedInput
    }
}

/// Mirrors the body of `POST .../workflow-runs`.
public struct CreateWorkflowRunRequest: Encodable, Sendable {
    public var workflowKey: WorkflowKey
    public var input: [String: String]

    public init(workflowKey: WorkflowKey, input: [String: String]) {
        self.workflowKey = workflowKey
        self.input = input
    }
}
