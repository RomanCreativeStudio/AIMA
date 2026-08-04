import AIMACore
import SwiftUI

/// One advisory `Suggestion` (Phase 3.5, item 4), shared between the Dashboard's Recommendations section and
/// Chat's recommendation cards — purely informational, with an explanation, confidence, and source so it's
/// explainable at a glance. No button here creates, executes, or sends anything.
struct SuggestionRow: View {
    let suggestion: Suggestion
    /// Nudge Learning Loop sprint: only the "Needs Attention" section passes this — every other caller
    /// (Recommendations, the Daily Briefing card) leaves it `nil` and gets no dismiss button, unchanged.
    var onDismiss: (() -> Void)?

    init(suggestion: Suggestion, onDismiss: (() -> Void)? = nil) {
        self.suggestion = suggestion
        self.onDismiss = onDismiss
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: suggestion.type.systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(suggestion.title)
                    .font(.callout)
                    .fontWeight(.medium)
                Text(suggestion.explanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("\(Int(suggestion.confidence * 100))%")
                .font(.caption)
                .foregroundStyle(.secondary)
                .help("Source: \(suggestion.source)")

            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Dismiss — won't resurface for a while")
            }
        }
    }
}

private extension SuggestionType {
    var systemImage: String {
        switch self {
        case .workflow: return "flowchart"
        case .execution: return "bolt.fill"
        case .memory: return "brain"
        case .task: return "checklist"
        case .integration: return "puzzlepiece.extension"
        }
    }
}

#Preview {
    SuggestionRow(
        suggestion: Suggestion(
            id: "workflow:daily_workspace_briefing", workspaceId: "mock-ws-rcs", type: .workflow,
            title: "Run \"daily_workspace_briefing\" again",
            explanation: "The \"daily_workspace_briefing\" workflow has been run 3 times.",
            confidence: 0.75, source: "frequent_workflow_pattern",
            timestamp: "2026-01-01T00:00:00.000Z", payload: [:]
        )
    )
    .padding()
}
