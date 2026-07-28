import AIMACore
import SwiftUI

/// The Chat screen's inline workflow-suggestion card (Phase 2.4, item 4) —
/// purely advisory: `WorkflowSuggestion` never creates or executes a
/// `WorkflowRun` on its own (`ConversationService.sendMessage`'s
/// `workflowIntentMatcher.match` call only ever returns a preview). Shown
/// whenever `ChatViewModel.lastWorkflowSuggestion` is set; starting the run
/// itself happens on the Workflows screen, not from here.
struct WorkflowSuggestionCardView: View {
    let suggestion: WorkflowSuggestion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "flowchart.fill")
                    .foregroundStyle(.blue)
                Text("Workflow suggestion: \(suggestion.displayName)")
                    .fontWeight(.medium)
                Spacer()
                Text("\(Int(suggestion.confidence * 100))% match")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(suggestion.description)
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                ForEach(suggestion.steps) { step in
                    Text("• \(step.displayName)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Text("Open the Workflows screen to start it.")
                .font(.caption2)
                .foregroundStyle(.blue)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.blue.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

#Preview {
    WorkflowSuggestionCardView(
        suggestion: WorkflowSuggestion(
            workflowKey: .dailyWorkspaceBriefing, displayName: "Daily Workspace Briefing",
            description: "Gather this workspace's tasks, pending approvals, and system status into a short daily briefing.",
            confidence: 0.8,
            steps: [
                WorkflowStepDefinition(key: "gather_snapshot", displayName: "Gather workspace snapshot", capability: nil),
                WorkflowStepDefinition(key: "compose_briefing", displayName: "Compose briefing", capability: nil),
            ],
            extractedInput: [:]
        )
    )
}
