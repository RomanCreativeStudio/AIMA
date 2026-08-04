import Foundation
import Observation

/// Backs the Beta Tester Infrastructure sprint's feedback form: submit a bug report/feature request/general
/// note, and see this workspace's prior submissions. Scoped to one workspace, like `MemoryViewModel`/
/// `TasksViewModel`. Uses `@Observable` (not Combine) so this package stays Linux-buildable — see
/// `Package.swift`.
@MainActor
@Observable
public final class FeedbackViewModel {
    public private(set) var submissions: [Feedback] = []
    public private(set) var isLoading = false
    public private(set) var isSubmitting = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            submissions = try await apiClient.listFeedback(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Submits feedback and prepends it to `submissions` on success — no need to re-fetch the whole list for
    /// what the caller already has in hand. Returns whether the submission succeeded, so the form can clear
    /// itself only on success.
    @discardableResult
    public func submit(type: FeedbackType, message: String) async -> Bool {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let feedback = try await apiClient.submitFeedback(workspaceId: workspaceId, request: CreateFeedbackRequest(type: type, message: message))
            submissions.insert(feedback, at: 0)
            return true
        } catch let error as APIError {
            errorMessage = error.userMessage
            return false
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
