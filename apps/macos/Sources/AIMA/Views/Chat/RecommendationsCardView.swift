import AIMACore
import SwiftUI

/// The Chat screen's advisory recommendation cards (Phase 3.5, item 8): every current suggestion for the
/// active workspace. Purely read-only and explicit-only — shown only after the user taps "Show
/// Recommendations" (`ChatViewModel.loadWorkspaceSuggestions`), never fetched automatically, and never a popup
/// or background notification — the same posture `ConversationIntelligenceCardView` established.
struct RecommendationsCardView: View {
    let suggestions: [Suggestion]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "lightbulb")
                    .foregroundStyle(.yellow)
                Text("Recommendations")
                    .fontWeight(.medium)
            }

            ForEach(suggestions) { suggestion in
                SuggestionRow(suggestion: suggestion)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.yellow.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.yellow.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

#Preview {
    RecommendationsCardView(
        suggestions: [
            Suggestion(
                id: "workflow:daily_workspace_briefing", workspaceId: "mock-ws-rcs", type: .workflow,
                title: "Run \"daily_workspace_briefing\" again",
                explanation: "The \"daily_workspace_briefing\" workflow has been run 3 times.",
                confidence: 0.75, source: "frequent_workflow_pattern",
                timestamp: "2026-01-01T00:00:00.000Z", payload: [:]
            ),
        ]
    )
}
