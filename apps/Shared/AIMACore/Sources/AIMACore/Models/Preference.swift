import Foundation

/// Mirrors `backend/src/preferences/types.ts#PreferenceCategory` (Phase 1.8).
public enum PreferenceCategory: String, Codable, CaseIterable, Sendable {
    case writingStyle = "writing_style"
    case responsePreferences = "response_preferences"
    case workflowPreferences = "workflow_preferences"
    case projectRules = "project_rules"

    public var displayName: String {
        switch self {
        case .writingStyle: return "Writing Style"
        case .responsePreferences: return "Response Preferences"
        case .workflowPreferences: return "Workflow Preferences"
        case .projectRules: return "Project Rules"
        }
    }
}

/// Mirrors `backend/src/preferences/types.ts#Preference` — the Preference
/// Memory Layer's structured, categorized settings.
public struct Preference: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let category: PreferenceCategory
    public let key: String
    public let value: String
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        workspaceId: String,
        category: PreferenceCategory,
        key: String,
        value: String,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.category = category
        self.key = key
        self.value = value
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Mirrors the body of `PUT /api/workspaces/:id/preferences` (`backend/src/routes/preferences.ts`).
public struct SetPreferenceRequest: Encodable, Sendable {
    public var category: PreferenceCategory
    public var key: String
    public var value: String

    public init(category: PreferenceCategory, key: String, value: String) {
        self.category = category
        self.key = key
        self.value = value
    }
}
