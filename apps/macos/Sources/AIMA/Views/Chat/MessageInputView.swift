import AIMACore
import SwiftUI

/// The Chat screen's message input (Phase 2.1, item 2). `@Bindable` gets a
/// two-way `Binding` to `draftMessage` (a plain, publicly settable
/// property on `ChatViewModel`) without the parent needing to construct
/// one itself.
struct MessageInputView: View {
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
                    ProgressView().controlSize(.small)
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
