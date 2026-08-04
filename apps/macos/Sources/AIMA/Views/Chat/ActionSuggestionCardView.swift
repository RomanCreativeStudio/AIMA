import AIMACore
import SwiftUI

/// The Chat screen's inline action-suggestion cards (Conversation → Action
/// sprint, extended by the Executive Assistant Loop sprint): one card per
/// detected todo/follow-up/reminder/meeting/completed-task/blocked/
/// postponed/delegated item. `decision` suggestions are deliberately not
/// rendered here: a wired-in `MemoryService` already silently auto-saves
/// them (Personal Workspace Memory sprint), so there is nothing left to
/// accept, and they surface instead via the Dashboard's "Recent Decisions."
///
/// `todo`/`follow_up`/`meeting`/`reminder` accept via `onAccept`
/// (`ChatViewModel.acceptActionSuggestion`, creating a new task). The 4
/// task-referencing categories each accept via their own action
/// (`onComplete`/`onPostpone`/`onBlock`/`onDelegate`, all `updateTask`
/// calls against `suggestion.matchedTaskId`) — disabled with an inline
/// explanation when no open task was matched. Dismiss removes the card
/// with no API call at all, for every category.
struct ActionSuggestionCardView: View {
    let suggestion: ActionSuggestion
    let onAccept: () -> Void
    let onComplete: () -> Void
    let onPostpone: () -> Void
    let onBlock: () -> Void
    let onDelegate: () -> Void
    let onDismiss: () -> Void

    private var title: String {
        switch suggestion.category {
        case .todo, .meeting: return "Suggested Task"
        case .reminder: return "Suggested Reminder"
        case .followUp: return "Suggested Follow-up"
        case .decision: return "Suggested Decision"
        case .completedTask: return "Completed Task"
        case .blocked: return "Blocked"
        case .postponed: return "Postponed"
        case .delegated: return "Delegated"
        }
    }

    private var icon: String {
        switch suggestion.category {
        case .todo: return "checklist"
        case .meeting: return "calendar"
        case .reminder: return "bell.fill"
        case .followUp: return "arrow.turn.up.right"
        case .decision: return "checkmark.circle"
        case .completedTask: return "checkmark.circle.fill"
        case .blocked: return "exclamationmark.octagon"
        case .postponed: return "clock.arrow.circlepath"
        case .delegated: return "person.2"
        }
    }

    private var isTaskReferencing: Bool {
        switch suggestion.category {
        case .completedTask, .blocked, .postponed, .delegated: return true
        case .todo, .followUp, .reminder, .meeting, .decision: return false
        }
    }

    private var primaryActionLabel: String {
        switch suggestion.category {
        case .completedTask: return "Complete"
        case .blocked: return "Block"
        case .postponed: return "Postpone"
        case .delegated: return "Delegate"
        case .todo, .followUp, .reminder, .meeting, .decision: return "Accept"
        }
    }

    private var primaryAction: () -> Void {
        switch suggestion.category {
        case .completedTask: return onComplete
        case .blocked: return onBlock
        case .postponed: return onPostpone
        case .delegated: return onDelegate
        case .todo, .followUp, .reminder, .meeting, .decision: return onAccept
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

            if isTaskReferencing && suggestion.matchedTaskId == nil {
                Text("No matching task found.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button(primaryActionLabel, action: primaryAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(isTaskReferencing && suggestion.matchedTaskId == nil)
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
        onComplete: {},
        onPostpone: {},
        onBlock: {},
        onDelegate: {},
        onDismiss: {}
    )
}
