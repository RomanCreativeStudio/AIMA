import Foundation
import Observation

/// Backs the Search screen (Phase 3.6, item 6): manual semantic search across a workspace's indexed
/// conversations/tasks/memories, an optional retrieved-context view for a query, and a manual re-index
/// trigger. Scoped to one workspace, like `TasksViewModel`/`MemoryViewModel`. Uses `@Observable` (not
/// Combine) so this package stays Linux-buildable — see `Package.swift`. Every fetch here is the result of
/// an explicit call from a view (a search button, a reindex button) — there is no automatic search and no
/// background retrieval, matching this phase's "retrieval only, nothing autonomous" rule.
@MainActor
@Observable
public final class SearchViewModel {
    public var query: String = ""
    public var sourceTypeFilter: EmbeddingSourceType?
    public private(set) var results: [SearchResult] = []
    public private(set) var context: RetrievedContext?
    public private(set) var isSearching = false
    public private(set) var isLoadingContext = false
    public private(set) var isReindexing = false
    public private(set) var errorMessage: String?
    public private(set) var lastReindexResult: ReindexWorkspaceResult?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    /// Ranked similarity search over `query` — never triggered as the user types, only on explicit call.
    public func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            return
        }

        isSearching = true
        errorMessage = nil
        defer { isSearching = false }

        do {
            let sourceTypes = sourceTypeFilter.map { [$0] }
            results = try await apiClient.searchSemantic(workspaceId: workspaceId, query: trimmed, sourceTypes: sourceTypes, limit: nil)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fetches the merged memories/conversations/tasks context for `query` — the same advisory read
    /// `ConversationService.sendMessage` computes server-side, exposed here as a standalone "why would AIMA
    /// retrieve this" view. Explicit-only, same as `search()`.
    public func loadContext() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            context = nil
            return
        }

        isLoadingContext = true
        errorMessage = nil
        defer { isLoadingContext = false }

        do {
            context = try await apiClient.getRetrievedContext(
                workspaceId: workspaceId,
                query: trimmed,
                conversationId: nil,
                memoryLimit: nil,
                embeddingLimit: nil
            )
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Re-chunks and re-embeds this workspace's conversations/tasks — an explicit maintenance action (a
    /// reindex button), never run automatically or on a schedule.
    public func reindex() async {
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

    public func clear() {
        query = ""
        results = []
        context = nil
    }
}
