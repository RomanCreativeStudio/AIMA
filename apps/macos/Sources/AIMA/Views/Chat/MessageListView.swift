import AIMACore
import SwiftUI

/// The Chat screen's message history (Phase 2.1, item 2) — auto-scrolls to
/// the newest message as it arrives.
struct MessageListView: View {
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

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            Text(message.content)
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
