import Foundation

/// Mirrors `backend/src/insights/types.ts#WorkspaceDigestEntry` (Cross-Workspace Daily Digest sprint) — one
/// compact row per workspace the caller owns, so Alex can see what needs attention everywhere without switching
/// the active workspace. Every field is read off that workspace's own `DailyBriefing`; nothing here is computed
/// client-side.
public struct WorkspaceDigestEntry: Codable, Identifiable, Equatable, Sendable {
    public let workspaceId: String
    public let workspaceName: String
    public let nudgeCount: Int
    public let topSuggestion: Suggestion?
    public let pendingApprovalCount: Int
    public let greeting: String
    public let overdueTaskCount: Int
    public let blockedItemCount: Int

    public var id: String { workspaceId }

    public init(
        workspaceId: String,
        workspaceName: String,
        nudgeCount: Int,
        topSuggestion: Suggestion?,
        pendingApprovalCount: Int,
        greeting: String,
        overdueTaskCount: Int,
        blockedItemCount: Int
    ) {
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.nudgeCount = nudgeCount
        self.topSuggestion = topSuggestion
        self.pendingApprovalCount = pendingApprovalCount
        self.greeting = greeting
        self.overdueTaskCount = overdueTaskCount
        self.blockedItemCount = blockedItemCount
    }
}
