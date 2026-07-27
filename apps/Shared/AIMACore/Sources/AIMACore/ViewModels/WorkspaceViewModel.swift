import Foundation
import Observation

/// Backs the Workspace screen (Phase 2.1, item 2): the four fixed
/// workspaces (Personal, Roman Creative Studio, Mythic Forge Studios,
/// Development — `docs/PRODUCT_BIBLE.md` §1) and which one is currently
/// active. Switching workspaces here only changes which workspace *this
/// app* is currently pointed at — it never bypasses the backend's own
/// workspace isolation (`docs/TECHNICAL_ARCHITECTURE.md` §6), since every
/// request still carries an explicit `workspaceId` the backend validates
/// independently. Uses `@Observable` (not Combine's `ObservableObject`) so
/// this package stays Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class WorkspaceViewModel {
    public private(set) var workspaces: [Workspace] = []
    public private(set) var activeWorkspaceId: String?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let apiClient: APIClient
    private let userId: String

    public init(apiClient: APIClient, userId: String) {
        self.apiClient = apiClient
        self.userId = userId
    }

    public var activeWorkspace: Workspace? {
        workspaces.first { $0.id == activeWorkspaceId }
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let workspacesResult = apiClient.listWorkspaces(userId: userId)
            async let userResult = apiClient.getUser(id: userId)
            let (workspaces, user) = try await (workspacesResult, userResult)

            self.workspaces = workspaces
            if activeWorkspaceId == nil {
                activeWorkspaceId = user.defaultWorkspaceId ?? workspaces.first?.id
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func switchWorkspace(to workspaceId: String) {
        guard workspaces.contains(where: { $0.id == workspaceId }) else { return }
        activeWorkspaceId = workspaceId
    }
}
