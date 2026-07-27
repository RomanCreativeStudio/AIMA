import Foundation
import Observation

/// Backs the Approvals screen (Phase 2.2, item 3): a full, filterable list
/// of a workspace's approvals plus a selected approval's detail — a fuller
/// view than the Dashboard's pending-only quick list. Scoped to one
/// workspace, like `ChatViewModel`/`TasksViewModel`. Uses `@Observable`
/// (not Combine) so this package stays Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class ApprovalsViewModel {
    public private(set) var approvals: [PendingApproval] = []
    public private(set) var selectedApproval: PendingApproval?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    public private(set) var statusFilter: ApprovalStatus? = .pending

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
            approvals = try await apiClient.listApprovals(workspaceId: workspaceId, status: statusFilter)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Re-fetches with a new status filter (`nil` means "all statuses") —
    /// an explicit method rather than a `didSet` observer, matching
    /// `ChatViewModel.selectConversation`'s style of async state changes.
    public func setStatusFilter(_ status: ApprovalStatus?) async {
        statusFilter = status
        await load()
    }

    /// Fetches the full record for detail display — the list view already
    /// has each approval, but re-fetching guards against it having changed
    /// (e.g. resolved from another client) since the list was loaded.
    public func selectApproval(_ approval: PendingApproval) async {
        errorMessage = nil
        do {
            selectedApproval = try await apiClient.getApproval(workspaceId: workspaceId, approvalId: approval.id)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func clearSelection() {
        selectedApproval = nil
    }

    public func approve(_ approval: PendingApproval) async {
        await resolve(approval) { client, workspaceId, approvalId in
            try await client.approveApproval(workspaceId: workspaceId, approvalId: approvalId)
        }
    }

    public func reject(_ approval: PendingApproval) async {
        await resolve(approval) { client, workspaceId, approvalId in
            try await client.rejectApproval(workspaceId: workspaceId, approvalId: approvalId)
        }
    }

    private func resolve(
        _ approval: PendingApproval,
        _ action: (APIClient, String, String) async throws -> ApprovalDecision
    ) async {
        errorMessage = nil
        do {
            _ = try await action(apiClient, workspaceId, approval.id)
            approvals.removeAll { $0.id == approval.id }
            if selectedApproval?.id == approval.id {
                selectedApproval = nil
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
