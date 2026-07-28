import Foundation
import Observation

/// Backs the Memory Management screen (Phase 3.4, item 7): view/search/edit/archive/delete a workspace's
/// memories, and show each one's importance/confidence. Scoped to one workspace, like
/// `TasksViewModel`/`ApprovalsViewModel`. Uses `@Observable` (not Combine) so this package stays
/// Linux-buildable — see `Package.swift`. Every mutation goes through an explicit user action (edit/archive/
/// delete button) — there is no background sync or auto-save, matching "no hidden storage".
@MainActor
@Observable
public final class MemoryViewModel {
    public private(set) var memories: [MemoryRecord] = []
    public private(set) var searchResults: [RankedMemoryResult] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    public private(set) var scopeFilter: MemoryScope?
    public private(set) var includeArchived = false
    public private(set) var searchQuery = ""

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
            memories = try await apiClient.listMemories(
                workspaceId: workspaceId,
                scope: scopeFilter,
                memoryType: nil,
                includeArchived: includeArchived
            )
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Re-fetches with a new scope filter (`nil` means "all scopes") — matches
    /// `ApprovalsViewModel.setStatusFilter`'s explicit-method style.
    public func setScopeFilter(_ scope: MemoryScope?) async {
        scopeFilter = scope
        await load()
    }

    public func setIncludeArchived(_ value: Bool) async {
        includeArchived = value
        await load()
    }

    /// Ranked search — a separate list from `memories` so switching to search doesn't discard the plain list.
    public func search(_ query: String) async {
        searchQuery = query
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            searchResults = []
            return
        }

        errorMessage = nil
        do {
            searchResults = try await apiClient.searchMemories(workspaceId: workspaceId, query: query, scope: scopeFilter, limit: nil)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func clearSearch() {
        searchQuery = ""
        searchResults = []
    }

    public func createMemory(_ request: CreateMemoryRequest) async {
        errorMessage = nil
        do {
            let memory = try await apiClient.createMemory(workspaceId: workspaceId, request: request)
            memories.insert(memory, at: 0)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func updateMemory(_ memory: MemoryRecord, request: UpdateMemoryRequest) async {
        errorMessage = nil
        do {
            let updated = try await apiClient.updateMemory(workspaceId: workspaceId, memoryId: memory.id, request: request)
            replace(updated)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func archive(_ memory: MemoryRecord) async {
        errorMessage = nil
        do {
            let archived = try await apiClient.archiveMemory(workspaceId: workspaceId, memoryId: memory.id)
            if includeArchived {
                replace(archived)
            } else {
                memories.removeAll { $0.id == memory.id }
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func delete(_ memory: MemoryRecord) async {
        errorMessage = nil
        do {
            try await apiClient.deleteMemory(workspaceId: workspaceId, memoryId: memory.id)
            memories.removeAll { $0.id == memory.id }
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func replace(_ memory: MemoryRecord) {
        guard let index = memories.firstIndex(where: { $0.id == memory.id }) else { return }
        memories[index] = memory
    }
}
