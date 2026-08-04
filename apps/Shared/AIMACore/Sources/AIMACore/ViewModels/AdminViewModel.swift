import Foundation
import Observation

/// Backs the Internal Operator Dashboard sprint's founder/admin screen: the Beta User Overview and Feedback
/// Dashboard, both read entirely through `APIClient.listBetaUsers`/`listAdminFeedback` — the backend enforces
/// who's allowed to call these (`requireAdmin`), so this view model has no notion of "am I an admin" of its
/// own; a 403/404 just surfaces as `errorMessage` like any other API failure. Account-scoped, not
/// workspace-scoped — unlike every other `*ViewModel` in this package, it isn't constructed with a
/// `workspaceId` because the whole point of this screen is to see across every workspace at once.
@MainActor
@Observable
public final class AdminViewModel {
    public private(set) var betaUsers: [AdminBetaUserSummary] = []
    public private(set) var recentFeedback: [AdminFeedbackEntry] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let usersResult = apiClient.listBetaUsers()
            async let feedbackResult = apiClient.listAdminFeedback(limit: nil)
            let (users, feedback) = try await (usersResult, feedbackResult)
            betaUsers = users
            recentFeedback = feedback
        } catch let error as APIError {
            errorMessage = error.userMessage
            betaUsers = []
            recentFeedback = []
        } catch {
            errorMessage = error.localizedDescription
            betaUsers = []
            recentFeedback = []
        }
    }
}
