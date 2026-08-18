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

    /// Renders AI responses as Markdown (Phase 2.2's "Markdown responses") —
    /// `AttributedString(markdown:)` isn't available in the Linux Foundation
    /// this repo's `apps/Shared/AIMACore` package builds/tests against (confirmed
    /// by a failed trial build), so unlike the rest of the chat pipeline this
    /// parsing can only live here, in the SwiftUI/Apple-platform-only layer,
    /// not as a testable AIMACore helper. Falls back to plain text if a
    /// response contains something the parser rejects, rather than dropping it.
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
