import Foundation

/// Mirrors `backend/src/admin/types.ts#AdminUsageSummary` (Internal Operator Dashboard sprint) — usage
/// summed across every one of an account's workspaces, composed entirely from `UsageMetrics`/
/// `WorkspaceInsights`/execution history the backend already had; no new aggregate storage.
public struct AdminUsageSummary: Codable, Equatable, Sendable {
    public let conversationsCreated: Int
    public let messagesSent: Int
    public let memoriesCreated: Int
    public let integrationsConnected: Int
    public let approvalsUsed: Int
    public let executionsUsed: Int

    public init(
        conversationsCreated: Int,
        messagesSent: Int,
        memoriesCreated: Int,
        integrationsConnected: Int,
        approvalsUsed: Int,
        executionsUsed: Int
    ) {
        self.conversationsCreated = conversationsCreated
        self.messagesSent = messagesSent
        self.memoriesCreated = memoriesCreated
        self.integrationsConnected = integrationsConnected
        self.approvalsUsed = approvalsUsed
        self.executionsUsed = executionsUsed
    }
}

/// Mirrors `backend/src/admin/types.ts#AdminBetaUserSummary` — one row in the admin Beta User Overview,
/// only ever reachable via `APIClient.listBetaUsers()`, which the backend gates to `requireAdmin`.
public struct AdminBetaUserSummary: Codable, Identifiable, Equatable, Sendable {
    public let userId: String
    public let email: String
    public let displayName: String?
    public let workspaceId: String?
    public let workspaceName: String?
    public let signupDate: String
    public let lastActiveAt: String?
    public let onboardingCompleted: Bool
    public let feedbackCount: Int
    public let usage: AdminUsageSummary
    /// Beta Tester Management sprint: admin-only invite notes/tags — see `AdminUserSummary`'s doc comment.
    public let adminNotes: String?
    public let adminTags: [String]

    public var id: String { userId }

    public init(
        userId: String,
        email: String,
        displayName: String?,
        workspaceId: String?,
        workspaceName: String?,
        signupDate: String,
        lastActiveAt: String?,
        onboardingCompleted: Bool,
        feedbackCount: Int,
        usage: AdminUsageSummary,
        adminNotes: String?,
        adminTags: [String]
    ) {
        self.userId = userId
        self.email = email
        self.displayName = displayName
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.signupDate = signupDate
        self.lastActiveAt = lastActiveAt
        self.onboardingCompleted = onboardingCompleted
        self.feedbackCount = feedbackCount
        self.usage = usage
        self.adminNotes = adminNotes
        self.adminTags = adminTags
    }
}

/// Mirrors `backend/src/admin/types.ts#AdminUserSummary` (Beta Tester Management sprint) — a lightweight row
/// for the "every account, not just current beta testers" admin view, used to find a candidate and toggle
/// them into (or out of) the beta, and to record `adminNotes`/`adminTags` about them. Composed from the same
/// `UserProfile.preferences` `AdminBetaUserSummary` already reads — no new storage.
public struct AdminUserSummary: Codable, Identifiable, Equatable, Sendable {
    public let userId: String
    public let email: String
    public let displayName: String?
    public let betaTester: Bool
    public let adminNotes: String?
    public let adminTags: [String]

    public var id: String { userId }

    public init(userId: String, email: String, displayName: String?, betaTester: Bool, adminNotes: String?, adminTags: [String]) {
        self.userId = userId
        self.email = email
        self.displayName = displayName
        self.betaTester = betaTester
        self.adminNotes = adminNotes
        self.adminTags = adminTags
    }
}

/// Mirrors the PATCH `/api/admin/users/:id` body — any subset of the three fields; the backend applies
/// only the ones present (see `UpdateBetaTesterInput` server-side).
public struct UpdateBetaTesterRequest: Encodable, Sendable {
    public var betaTester: Bool?
    public var adminNotes: String?
    public var adminTags: [String]?

    public init(betaTester: Bool? = nil, adminNotes: String? = nil, adminTags: [String]? = nil) {
        self.betaTester = betaTester
        self.adminNotes = adminNotes
        self.adminTags = adminTags
    }
}

/// Mirrors `backend/src/admin/types.ts#AdminFeedbackEntry` — a `Feedback` row plus the submitter/workspace
/// context an operator needs that a workspace-scoped `Feedback` read never has to carry.
public struct AdminFeedbackEntry: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let workspaceId: String
    public let userId: String
    public let type: FeedbackType
    public let status: FeedbackStatus
    public let message: String
    public let createdAt: String
    public let userEmail: String
    public let workspaceName: String

    public init(
        id: String,
        workspaceId: String,
        userId: String,
        type: FeedbackType,
        status: FeedbackStatus,
        message: String,
        createdAt: String,
        userEmail: String,
        workspaceName: String
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.userId = userId
        self.type = type
        self.status = status
        self.message = message
        self.createdAt = createdAt
        self.userEmail = userEmail
        self.workspaceName = workspaceName
    }
}

/// Mirrors `backend/src/admin/types.ts#AdminAnalytics` (Founder Analytics Dashboard sprint) — platform-wide
/// totals composed entirely from already-existing backend aggregation (`UsageMetricsService`,
/// `WorkspaceInsightsService`, `ExecutionService`, `FeedbackService`), not any new client-side computation.
public struct AdminAnalytics: Codable, Equatable, Sendable {
    public let totalUsers: Int
    public let betaUsers: Int
    public let activeUsers24h: Int
    public let activeUsers7d: Int
    public let totalWorkspaces: Int
    public let totalConversations: Int
    public let totalMessages: Int
    public let totalMemories: Int
    public let totalFeedback: Int
    public let pendingFeedback: Int
    public let reviewedFeedback: Int
    public let resolvedFeedback: Int
    public let approvalsCreated: Int
    public let approvalsCompleted: Int
    public let executionsCompleted: Int
    public let generatedAt: String

    public init(
        totalUsers: Int,
        betaUsers: Int,
        activeUsers24h: Int,
        activeUsers7d: Int,
        totalWorkspaces: Int,
        totalConversations: Int,
        totalMessages: Int,
        totalMemories: Int,
        totalFeedback: Int,
        pendingFeedback: Int,
        reviewedFeedback: Int,
        resolvedFeedback: Int,
        approvalsCreated: Int,
        approvalsCompleted: Int,
        executionsCompleted: Int,
        generatedAt: String
    ) {
        self.totalUsers = totalUsers
        self.betaUsers = betaUsers
        self.activeUsers24h = activeUsers24h
        self.activeUsers7d = activeUsers7d
        self.totalWorkspaces = totalWorkspaces
        self.totalConversations = totalConversations
        self.totalMessages = totalMessages
        self.totalMemories = totalMemories
        self.totalFeedback = totalFeedback
        self.pendingFeedback = pendingFeedback
        self.reviewedFeedback = reviewedFeedback
        self.resolvedFeedback = resolvedFeedback
        self.approvalsCreated = approvalsCreated
        self.approvalsCompleted = approvalsCompleted
        self.executionsCompleted = executionsCompleted
        self.generatedAt = generatedAt
    }
}
