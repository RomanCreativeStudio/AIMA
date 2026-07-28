import Foundation

/// Mirrors `backend/src/integrations/types.ts#IntegrationProvider` (Phase 2.3)
/// — the three fixed, read-only connectors this foundation phase ships.
public enum IntegrationProvider: String, Codable, CaseIterable, Identifiable, Sendable {
    case gmail
    case github
    case calendar

    public var id: String { rawValue }
}

/// Mirrors `backend/src/integrations/types.ts#IntegrationStatus`.
public enum IntegrationStatus: String, Codable, Sendable {
    case disconnected
    case connected
    case error
}

/// One capability an integration grants once connected (e.g. `read_email`),
/// paired with its permission tier — mirrors the `{ actionType, tier }`
/// shape `backend/src/routes/integrations.ts` composes from
/// `IntegrationRegistry` plus `PermissionEngine.resolveTier`.
public struct IntegrationCapability: Codable, Equatable, Sendable {
    public let actionType: String
    public let tier: String

    public init(actionType: String, tier: String) {
        self.actionType = actionType
        self.tier = tier
    }
}

/// Mirrors the integrations route's response shape (backend/src/routes/
/// integrations.ts#IntegrationSummary): `WorkspaceIntegration` status plus
/// the registry's display metadata and capability list. Never carries
/// credential material — the backend never serializes it, by design.
/// `(workspaceId, provider)` is already a stable, unique key, so `id` is
/// synthesized from them rather than exposing the backend's own internal
/// row id (which the backend itself doesn't serialize either — see
/// `backend/src/integrations/types.ts`'s comment on why).
public struct WorkspaceIntegration: Codable, Identifiable, Equatable, Sendable {
    public let workspaceId: String
    public let provider: IntegrationProvider
    public let enabled: Bool
    public let status: IntegrationStatus
    public let connectedAt: String?
    public let lastValidatedAt: String?
    public let createdAt: String
    public let updatedAt: String
    public let displayName: String
    public let description: String
    public let capabilities: [IntegrationCapability]
    /// The credential field names a connect/rotate form should collect (e.g. `["accessToken", "refreshToken"]`) — mirrors `IntegrationDefinition.requiredCredentialFields` (backend/src/integrations/registry.ts), the single source of truth for what each provider needs.
    public let requiredCredentialFields: [String]

    public var id: String { "\(workspaceId):\(provider.rawValue)" }

    public init(
        workspaceId: String,
        provider: IntegrationProvider,
        enabled: Bool,
        status: IntegrationStatus,
        connectedAt: String?,
        lastValidatedAt: String?,
        createdAt: String,
        updatedAt: String,
        displayName: String,
        description: String,
        capabilities: [IntegrationCapability],
        requiredCredentialFields: [String]
    ) {
        self.workspaceId = workspaceId
        self.provider = provider
        self.enabled = enabled
        self.status = status
        self.connectedAt = connectedAt
        self.lastValidatedAt = lastValidatedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.displayName = displayName
        self.description = description
        self.capabilities = capabilities
        self.requiredCredentialFields = requiredCredentialFields
    }
}
