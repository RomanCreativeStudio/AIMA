import AIMACore
import SwiftUI

/// The Chat screen (Phase 2.1, item 2): conversation list, message
/// history, message input, and AI responses — the full pipeline
/// (docs/TECHNICAL_ARCHITECTURE.md §4/§7) as seen from the client. A
/// three-pane layout (conversation list / message history / input), all
/// scoped to one workspace at a time.
struct ChatView: View {
    let container: DependencyContainer
    @State private var viewModel: ChatViewModel

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeChatViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        HStack(spacing: 0) {
            ConversationListView(viewModel: viewModel)
                .frame(width: 220)

            Divider()

            VStack(spacing: 0) {
                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

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

                if let suggestion = viewModel.lastWorkflowSuggestion {
                    WorkflowSuggestionCardView(suggestion: suggestion)
                }

                if let suggestion = viewModel.lastExecutionSuggestion {
                    ExecutionSuggestionCardView(suggestion: suggestion)
                }

                if let intelligence = viewModel.conversationIntelligence {
                    ConversationIntelligenceCardView(intelligence: intelligence)
                }

                if !viewModel.workspaceSuggestions.isEmpty {
                    RecommendationsCardView(suggestions: viewModel.workspaceSuggestions)
                }

                HStack {
                    Spacer()
                    if viewModel.selectedConversationId != nil {
                        Button {
                            Task { await viewModel.loadConversationIntelligence() }
                        } label: {
                            if viewModel.isLoadingIntelligence {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Summarize Conversation", systemImage: "sparkle.magnifyingglass")
                            }
                        }
                        .disabled(viewModel.isLoadingIntelligence)
                        .buttonStyle(.bordered)
                    }
                    Button {
                        Task { await viewModel.loadWorkspaceSuggestions() }
                    } label: {
                        if viewModel.isLoadingSuggestions {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Show Recommendations", systemImage: "lightbulb")
                        }
                    }
                    .disabled(viewModel.isLoadingSuggestions)
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 12)
                .padding(.top, 4)

                MessageInputView(viewModel: viewModel)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Chat")
        .task {
            await viewModel.loadConversations()
        }
    }
}

#Preview {
    ChatView(container: .preview, workspaceId: "mock-ws-rcs")
}

/// Surfaces the detected intent and approval state for the most recent
/// turn (Phase 1.7/1.8's response schema) — a transparency affordance, not
/// a control: the user sees what AIMA understood without it changing how
/// the conversation flows.
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
