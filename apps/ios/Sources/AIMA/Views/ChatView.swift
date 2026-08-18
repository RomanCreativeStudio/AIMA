import AIMACore
import SwiftUI

/// The Chat tab — the sprint's "Chat → create task" end-to-end flow lives here: send a message, accept a
/// detected action suggestion (`ChatViewModel.acceptActionSuggestion`, which creates a `TaskItem`), or approve a
/// pending approval inline. A single-column adaptation of `apps/macos/Sources/AIMA/Views/Chat/ChatView.swift`'s
/// three-pane layout (conversation list / history / input) — a phone screen has no room for panes side by side,
/// so the conversation picker moves into a toolbar menu instead. Everything else (message bubbles, intent
/// banner, approval card, action-suggestion cards) is a direct, un-simplified port: the same `ChatViewModel`
/// drives it, nothing here is new business logic.
struct ChatView: View {
    let container: DependencyContainer
    @State private var viewModel: ChatViewModel

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeChatViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if viewModel.selectedConversationId == nil {
                ContentUnavailableView(
                    "No Conversation Selected",
                    systemImage: "bubble.left",
                    description: Text("Start a new conversation from the toolbar.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                MessageListView(messages: viewModel.messages)

                if let intent = viewModel.lastIntent {
                    IntentBanner(intent: intent, approvalDecision: viewModel.lastApprovalDecision)
                }

                if let pendingApproval = viewModel.lastPendingApproval {
                    ApprovalCardView(
                        approval: pendingApproval,
                        onApprove: { Task { await viewModel.approveLastApproval() } },
                        onReject: { Task { await viewModel.rejectLastApproval() } }
                    )
                }

                ForEach(viewModel.lastActionSuggestions.filter { $0.category != .decision }, id: \.content) { suggestion in
                    ActionSuggestionCardView(
                        suggestion: suggestion,
                        onAccept: { Task { await viewModel.acceptActionSuggestion(suggestion) } },
                        onComplete: { Task { await viewModel.completeActionSuggestion(suggestion) } },
                        onPostpone: { Task { await viewModel.postponeActionSuggestion(suggestion) } },
                        onBlock: { Task { await viewModel.blockActionSuggestion(suggestion) } },
                        onDelegate: { Task { await viewModel.delegateActionSuggestion(suggestion) } },
                        onDismiss: { viewModel.dismissActionSuggestion(suggestion) }
                    )
                }
            }

            MessageInputView(viewModel: viewModel)
        }
        .navigationTitle(viewModel.conversations.first { $0.id == viewModel.selectedConversationId }?.title ?? "Chat")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        Task { await viewModel.startNewConversation() }
                    } label: {
                        Label("New Conversation", systemImage: "plus")
                    }
                    if !viewModel.conversations.isEmpty {
                        Divider()
                        ForEach(viewModel.conversations) { conversation in
                            Button(conversation.title ?? "Untitled conversation") {
                                Task { await viewModel.selectConversation(conversation.id) }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "list.bullet")
                }
            }
        }
        .task {
            await viewModel.loadConversations()
        }
    }
}

#Preview {
    NavigationStack {
        ChatView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}

private struct IntentBanner: View {
    let intent: IntentAnalysis
    let approvalDecision: ApprovalDecision?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .foregroundStyle(.secondary)
            Text("Detected: \(intent.intent)")
                .font(.caption)
            Text("(\(Int(intent.confidence * 100))% confidence)")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let approvalDecision, approvalDecision.state != "no_approval_needed" {
                Text("• \(approvalDecision.state)")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.quaternary.opacity(0.3))
    }
}

/// The Chat screen's message history — a direct port of macOS's `MessageListView`.
private struct MessageListView: View {
    let messages: [Message]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if messages.isEmpty {
                        ContentUnavailableView(
                            "No Messages Yet",
                            systemImage: "bubble.left.and.bubble.right",
                            description: Text("Send a message to start the conversation.")
                        )
                        .padding(.top, 40)
                    }

                    ForEach(messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
            }
            .onChange(of: messages.last?.id) { _, newestId in
                guard let newestId else { return }
                withAnimation {
                    proxy.scrollTo(newestId, anchor: .bottom)
                }
            }
        }
    }
}

private struct MessageBubble: View {
    let message: Message

    private var isUser: Bool { message.role == .user }

    private var renderedContent: AttributedString {
        (try? AttributedString(
            markdown: message.content,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        )) ?? AttributedString(message.content)
    }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            Text(renderedContent)
                .textSelection(.enabled)
                .padding(10)
                .background(
                    isUser ? Color.accentColor : Color.gray.opacity(0.2),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .foregroundStyle(isUser ? Color.white : Color.primary)

            if !isUser { Spacer(minLength: 40) }
        }
    }
}

/// The Chat screen's message input — a direct port of macOS's `MessageInputView`.
private struct MessageInputView: View {
    @Bindable var viewModel: ChatViewModel

    private var canSend: Bool {
        !viewModel.isSending
            && viewModel.selectedConversationId != nil
            && !viewModel.draftMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message AIMA…", text: $viewModel.draftMessage, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .onSubmit(send)
                .disabled(viewModel.isSending || viewModel.selectedConversationId == nil)

            Button(action: send) {
                if viewModel.isSending {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
            }
            .disabled(!canSend)
        }
        .padding(12)
    }

    private func send() {
        guard canSend else { return }
        Task { await viewModel.sendDraftMessage() }
    }
}

/// The Chat screen's inline approval card — a direct port of macOS's `ApprovalCardView`.
private struct ApprovalCardView: View {
    let approval: PendingApproval
    let onApprove: () -> Void
    let onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(.orange)
                Text("Approval needed: \(approval.actionType)")
                    .fontWeight(.medium)
                Spacer()
                StatusPill(status: approval.status)
            }
            Text("Expires \(approval.expiresAt)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if approval.status == .pending {
                HStack {
                    Button("Approve", action: onApprove)
                        .buttonStyle(.borderedProminent)
                    Button("Reject", role: .destructive, action: onReject)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.orange.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

private struct StatusPill: View {
    let status: ApprovalStatus

    private var color: Color {
        switch status {
        case .pending: return .orange
        case .approved: return .green
        case .rejected: return .red
        case .expired: return .secondary
        }
    }

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }
}

/// The Chat screen's inline action-suggestion card — a direct port of macOS's `ActionSuggestionCardView`.
/// `decision` suggestions are excluded by the caller above, same as macOS (a wired-in `MemoryService` already
/// auto-saves them; they surface via Dashboard instead).
private struct ActionSuggestionCardView: View {
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
