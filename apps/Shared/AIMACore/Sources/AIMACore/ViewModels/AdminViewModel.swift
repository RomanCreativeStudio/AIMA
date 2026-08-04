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

    /// Bound to the Beta Users search field (Beta Tester Management sprint) — mutate this then call
    /// `searchBetaUsers()`, mirroring `SearchViewModel.query`'s "explicit call, not as-you-type" pattern.
    public var betaUserQuery: String = ""

    /// Beta Tester Management sprint: every account, not just current beta testers — the pool `updateUser`
    /// promotes/demotes from and annotates. Loaded separately from `betaUsers`, via `loadAllUsers()`.
    public private(set) var allUsers: [AdminUserSummary] = []
    /// Bound to the all-users search field, same explicit-call pattern as `betaUserQuery`.
    public var userQuery: String = ""

    private let apiClient: APIClient

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let usersResult = apiClient.listBetaUsers(query: nil)
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

    /// Re-fetches `betaUsers` filtered by `betaUserQuery` (empty means unfiltered) — an explicit search,
    /// never triggered as the user types.
    public func searchBetaUsers() async {
        errorMessage = nil
        do {
            betaUsers = try await apiClient.listBetaUsers(query: betaUserQuery.isEmpty ? nil : betaUserQuery)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fetches `allUsers` filtered by `userQuery` (empty means unfiltered) — the "every account" pool used
    /// to find a candidate to promote/demote or annotate. Not called from `load()`: the all-users list is
    /// only needed once the operator opens that section, so it stays empty until this is called explicitly.
    public func loadAllUsers() async {
        errorMessage = nil
        do {
            allUsers = try await apiClient.listAllUsers(query: userQuery.isEmpty ? nil : userQuery)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Toggles `betaTester` and/or records `adminNotes`/`adminTags` for one account — any subset of the
    /// three. On success, re-runs both `loadAllUsers()` and `searchBetaUsers()` (respecting whatever
    /// `userQuery`/`betaUserQuery` are currently set to) so both lists reflect the change — toggling
    /// `betaTester` can move a row into or out of `betaUsers`, which a single in-place patch can't express.
    public func updateUser(_ userId: String, betaTester: Bool? = nil, adminNotes: String? = nil, adminTags: [String]? = nil) async {
        errorMessage = nil
        do {
            _ = try await apiClient.updateBetaTesterStatus(
                userId: userId,
                request: UpdateBetaTesterRequest(betaTester: betaTester, adminNotes: adminNotes, adminTags: adminTags)
            )
            async let usersReload: Void = loadAllUsers()
            async let betaReload: Void = searchBetaUsers()
            _ = await (usersReload, betaReload)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Advances a submission new -> reviewed. On success, patches `recentFeedback` in place with the
    /// server's response rather than re-running `load()` — an optimistic-refresh of just the one row that
    /// changed, not a full reload of the dashboard.
    public func markReviewed(_ feedbackId: String) async {
        await updateStatus(feedbackId, to: .reviewed)
    }

    /// Advances a submission reviewed -> resolved. Same one-row refresh as `markReviewed`.
    public func markResolved(_ feedbackId: String) async {
        await updateStatus(feedbackId, to: .resolved)
    }

    private func updateStatus(_ feedbackId: String, to status: FeedbackStatus) async {
        errorMessage = nil
        do {
            let updated = try await apiClient.updateFeedbackStatus(feedbackId: feedbackId, status: status)
            if let index = recentFeedback.firstIndex(where: { $0.id == feedbackId }) {
                recentFeedback[index] = updated
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
