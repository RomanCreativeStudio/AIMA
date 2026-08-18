import AIMACore
import SwiftUI

/// The Chat screen's inline execution-suggestion card (Phase 2.6, item 5) —
/// purely advisory: `ExecutionSuggestion` never creates or runs an
/// `ExecutionRecord` on its own (`ConversationService.sendMessage`'s
/// `executionIntentMatcher.match` call only ever returns a preview). Shown
/// whenever `ChatViewModel.lastExecutionSuggestion` is set; previewing and
/// confirming the execution itself happens on the Executions screen, not
/// from here.
struct ExecutionSuggestionCardView: View {
    let suggestion: ExecutionSuggestion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bolt.fill")
                    .foregroundStyle(.purple)
                Text("Execution suggestion: \(suggestion.actionType.replacingOccurrences(of: "_", with: " ").capitalized)")
                    .fontWeight(.medium)
                Spacer()
                Text("\(Int(suggestion.confidence * 100))% match")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("Provider: \(suggestion.provider.rawValue.capitalized)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if !suggestion.extractedPayload.isEmpty {
                Text(JSONValue.object(suggestion.extractedPayload).displayString)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            Text("Open the Executions screen to preview and confirm it.")
                .font(.caption2)
                .foregroundStyle(.purple)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.purple.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

#Preview {
    ExecutionSuggestionCardView(
        suggestion: ExecutionSuggestion(
            actionType: "send_email", provider: .gmail, confidence: 0.75,
            extractedPayload: ["to": .string("client@example.com")]
        )
    )
}
