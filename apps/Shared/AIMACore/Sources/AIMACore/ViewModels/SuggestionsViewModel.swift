import Foundation
import Observation

/// Backs a dedicated Suggestions view (Phase 3.5, item 7): every pattern the Proactive Intelligence Engine has
/// detected for a workspace, and the curated advisory suggestions derived from them. Scoped to one workspace,
/// like `TasksViewModel`/`ApprovalsViewModel`. Uses `@Observable` (not Combine) so this package stays
/// Linux-buildable — see `Package.swift`. Purely a read: nothing here ever creates, executes, or sends
/// anything — a suggestion is information, not an action.
@MainActor
@Observable
public final class SuggestionsViewModel {
    public private(set) var patterns: [Pattern] = []
    public private(set) var suggestions: [Suggestion] = []
    public private(set) var isLoading = false
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
            async let patternsResult = apiClient.getProactivePatterns(workspaceId: workspaceId)
            async let suggestionsResult = apiClient.getProactiveSuggestions(workspaceId: workspaceId)
            let (patterns, suggestions) = try await (patternsResult, suggestionsResult)
            self.patterns = patterns
            self.suggestions = suggestions
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Suggestions of one type only (e.g. just `.workflow`), for a filtered section — `nil` means "all types."
    public func suggestions(ofType type: SuggestionType?) -> [Suggestion] {
        guard let type else { return suggestions }
        return suggestions.filter { $0.type == type }
    }
}
