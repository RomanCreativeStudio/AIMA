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
    /// The active workspace's activity summary (Phase 3.5, item 8) — reuses the existing, Phase 2.5
    /// `WorkspaceInsights` read rather than introducing a parallel metric; fetched only on explicit request
    /// (`loadActivitySummary`), not automatically on every `switchWorkspace`.
    public private(set) var activitySummary: WorkspaceInsights?
    /// The active workspace's most recent manual re-index result (Phase 3.6) — set only by `reindexEmbeddings()`,
    /// never fetched or triggered automatically.
    public private(set) var lastReindexResult: ReindexWorkspaceResult?
    public private(set) var isReindexing = false

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

    /// Pre-populates from an already-loaded workspace list — e.g. `AuthenticationManager`, which fetches a
    /// user's workspaces itself as part of reaching `.authenticated` (macOS Auth Bootstrap sprint). Lets a
    /// caller that already has this data skip `load()`'s otherwise-redundant second `listWorkspaces`/`getUser`
    /// round trip immediately after sign-in. `load()` remains available unchanged for any caller that doesn't
    /// already have the data (previews, direct construction, or if `workspaces` is empty for any reason).
    public func seed(workspaces: [Workspace], activeWorkspaceId: String?) {
        self.workspaces = workspaces
        if let activeWorkspaceId, workspaces.contains(where: { $0.id == activeWorkspaceId }) {
            self.activeWorkspaceId = activeWorkspaceId
        } else {
            self.activeWorkspaceId = self.activeWorkspaceId ?? workspaces.first?.id
        }
    }

    public func switchWorkspace(to workspaceId: String) {
        guard workspaces.contains(where: { $0.id == workspaceId }) else { return }
        activeWorkspaceId = workspaceId
        activitySummary = nil
        lastReindexResult = nil
    }

    /// Fetches the active workspace's activity summary — a plain read, never automatic.
    public func loadActivitySummary() async {
        guard let workspaceId = activeWorkspaceId else { return }
        errorMessage = nil
        do {
            activitySummary = try await apiClient.getWorkspaceInsights(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Re-chunks and re-embeds the active workspace's conversations/tasks (Phase 3.6) — an explicit
    /// maintenance action reachable from a workspace settings button, never run automatically.
    public func reindexEmbeddings() async {
        guard let workspaceId = activeWorkspaceId else { return }
        isReindexing = true
        errorMessage = nil
        defer { isReindexing = false }

        do {
            lastReindexResult = try await apiClient.reindexEmbeddings(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
