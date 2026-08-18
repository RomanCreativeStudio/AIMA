import Foundation
import Observation

/// Backs the Beta Invitations & Notifications sprint's Invitations section on the admin screen — read/write
/// entirely through `APIClient.createInvitation`/`listInvitations`, which the backend gates to `requireAdmin`
/// the same way `AdminViewModel` does. Kept as its own view model, not folded into `AdminViewModel`, so the
/// invite flow can be exercised independently. Account-scoped, not workspace-scoped: `listInvitations()` is
/// platform-wide, mirroring `AdminViewModel`'s own posture.
@MainActor
@Observable
public final class InvitationViewModel {
    public private(set) var invitations: [Invitation] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Re-fetches the full invitation list, newest first.
    public func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            invitations = try await apiClient.listInvitations()
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Sends a new invitation, then re-runs `refresh()` on success so the list reflects the new row without
    /// assuming anything about server-side ordering beyond what `listInvitations()` itself reports. On a 409
    /// (already an active beta tester) or any other failure, `errorMessage` is set and the existing list is
    /// left untouched.
    public func createInvitation(email: String) async {
        errorMessage = nil
        do {
            _ = try await apiClient.createInvitation(email: email)
            await refresh()
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
