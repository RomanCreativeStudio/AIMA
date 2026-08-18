import AIMACore
import SwiftUI

/// The Chat screen's conversation list (Phase 2.1, item 2). Selection is a
/// custom `Binding` rather than a two-way `@Bindable` property because
/// `ChatViewModel.selectedConversationId` is intentionally `private(set)` —
/// selecting a conversation is an action (load its history from the
/// backend) not a plain value assignment.
struct ConversationListView: View {
    let viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            List(selection: selectionBinding) {
                ForEach(viewModel.conversations) { conversation in
                    Text(conversation.title ?? "Untitled conversation")
                        .lineLimit(1)
                        .tag(conversation.id)
                }
            }
            .listStyle(.sidebar)
            .overlay {
                if viewModel.isLoadingConversations && viewModel.conversations.isEmpty {
                    ProgressView()
                } else if viewModel.conversations.isEmpty {
                    ContentUnavailableView(
                        "No Conversations",
                        systemImage: "bubble.left",
                        description: Text("Start a new conversation to begin.")
                    )
                }
            }

            Divider()

            Button {
                Task { await viewModel.startNewConversation() }
            } label: {
                Label("New Conversation", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .padding(8)
        }
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { viewModel.selectedConversationId },
            set: { newValue in
                guard let newValue else { return }
                Task { await viewModel.selectConversation(newValue) }
            }
        )
    }
}
