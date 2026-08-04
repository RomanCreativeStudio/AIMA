import AIMACore
import SwiftUI

/// The Chat screen's inline action-suggestion cards (Conversation → Action
/// sprint) — one card per detected todo/follow-up/reminder/meeting item.
/// `decision` suggestions are deliberately not rendered here: a wired-in
/// `MemoryService` already silently auto-saves them (Personal Workspace
/// Memory sprint), so there is nothing left to accept, and they surface
/// instead via the Dashboard's "Recent Decisions." Accept creates a real
/// task through `ChatViewModel.acceptActionSuggestion` (the same
/// `createTask` call the Tasks screen's "Add Task" button uses); Dismiss
/// removes the card with no API call at all.
struct ActionSuggestionCardView: View {
    let suggestion: ActionSuggestion
    let onAccept: () -> Void
    let onDismiss: () -> Void

    private var title: String {
        switch suggestion.category {
        case .todo, .meeting: return "Suggested Task"
        case .reminder: return "Suggested Reminder"
        case .followUp: return "Suggested Follow-up"
        case .decision: return "Suggested Decision"
        }
    }

    private var icon: String {
        switch suggestion.category {
        case .todo: return "checklist"
        case .meeting: return "calendar"
        case .reminder: return "bell.fill"
        case .followUp: return "arrow.turn.up.right"
        case .decision: return "checkmark.circle"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(.purple)
                Text(title)
                    .fontWeight(.medium)
                Spacer()
                Text("\(Int(suggestion.confidence * 100))% match")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(suggestion.content)
                .font(.callout)

            HStack {
                Button("Accept", action: onAccept)
                    .buttonStyle(.borderedProminent)
                Button("Dismiss", role: .cancel, action: onDismiss)
            }
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
    ActionSuggestionCardView(
        suggestion: ActionSuggestion(content: "Follow up on the Acme contract", category: .followUp, confidence: 0.8, reason: "test"),
        onAccept: {},
        onDismiss: {}
    )
}
