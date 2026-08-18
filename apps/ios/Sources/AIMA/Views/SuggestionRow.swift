import AIMACore
import SwiftUI

/// One advisory `Suggestion`, shared between Dashboard's Recommendations/Needs Attention sections — a direct
/// port of `apps/macos/Sources/AIMA/Views/Dashboard/SuggestionRow.swift` (no AppKit-specific code there to
/// begin with, so nothing needed to change).
struct SuggestionRow: View {
    let suggestion: Suggestion
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

            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
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
