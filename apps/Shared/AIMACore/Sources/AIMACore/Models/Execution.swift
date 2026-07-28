import Foundation

/// Mirrors `backend/src/execution/types.ts#ExecutionStatus` (Phase 2.6).
public enum ExecutionStatus: String, Codable, Sendable {
    case pending
    case awaitingApproval = "awaiting_approval"
    case succeeded
    case failed
}

/// Mirrors `backend/src/execution/types.ts#ExecutionRecord` — one persisted `executions` row, as returned by
/// create/execute/get/list. `requestPayload`/`responseSummary` stay `[String: JSONValue]` since their shape
/// varies per `actionType`, the same reasoning as every other freeform JSONB field in this package.
public struct ExecutionRecord: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let provider: IntegrationProvider
    public let actionType: String
    public let status: ExecutionStatus
    public let requestPayload: [String: JSONValue]
    public let responseSummary: [String: JSONValue]?
    public let errorDetails: String?
    public let pendingApprovalId: String?
    public let startedAt: String?
    public let completedAt: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        workspaceId: String,
        provider: IntegrationProvider,
        actionType: String,
        status: ExecutionStatus,
        requestPayload: [String: JSONValue],
        responseSummary: [String: JSONValue]?,
        errorDetails: String?,
        pendingApprovalId: String?,
        startedAt: String?,
        completedAt: String?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.provider = provider
        self.actionType = actionType
        self.status = status
        self.requestPayload = requestPayload
        self.responseSummary = responseSummary
        self.errorDetails = errorDetails
        self.pendingApprovalId = pendingApprovalId
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors `backend/src/execution/types.ts#ExecutionPreview` — a pure, read-only preview (Phase 2.6, item 5)
/// returned by `POST .../executions/preview`. Never persisted.
public struct ExecutionPreview: Codable, Equatable, Sendable {
    public let actionType: String
    public let provider: IntegrationProvider
    public let tier: String
    public let requiresApproval: Bool
    public let integrationConnected: Bool
    public let payload: [String: JSONValue]

    public init(
        actionType: String,
        provider: IntegrationProvider,
        tier: String,
        requiresApproval: Bool,
        integrationConnected: Bool,
        payload: [String: JSONValue]
    ) {
        self.actionType = actionType
        self.provider = provider
        self.tier = tier
        self.requiresApproval = requiresApproval
        self.integrationConnected = integrationConnected
        self.payload = payload
    }
}

/// Mirrors `backend/src/execution/types.ts#ExecutionSuggestion` — an advisory preview (Phase 2.6, item 5)
/// attached to a chat response when the message matches a real external action. Never itself creates or runs
/// an execution; starting one always goes through a dedicated preview/create/execute request.
public struct ExecutionSuggestion: Codable, Equatable, Sendable {
    public let actionType: String
    public let provider: IntegrationProvider
    public let confidence: Double
    public let extractedPayload: [String: JSONValue]

    public init(actionType: String, provider: IntegrationProvider, confidence: Double, extractedPayload: [String: JSONValue]) {
        self.actionType = actionType
        self.provider = provider
        self.confidence = confidence
        self.extractedPayload = extractedPayload
    }
}

/// Mirrors the body of `POST .../executions/preview` and `POST .../executions`.
public struct CreateExecutionRequest: Encodable, Sendable {
    public var actionType: String
    public var payload: [String: JSONValue]

    public init(actionType: String, payload: [String: JSONValue]) {
        self.actionType = actionType
        self.payload = payload
    }
}
