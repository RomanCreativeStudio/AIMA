import AIMACore
import SwiftUI

/// The Chat screen's Conversation Intelligence panel (Phase 2.5, item 3):
/// a summary, suggested follow-ups, and related memories for the selected
/// conversation. Purely read-only and explicit-only — shown only after
/// the user taps "Summarize Conversation" (`ChatViewModel.loadConversationIntelligence`),
/// never fetched automatically.
struct ConversationIntelligenceCardView: View {
    let intelligence: ConversationIntelligence

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "sparkle.magnifyingglass")
                    .foregroundStyle(.purple)
                Text("Conversation Intelligence")
                    .fontWeight(.medium)
            }

            if !intelligence.summary.isEmpty {
                Text(intelligence.summary)
                    .font(.callout)
            }

            if !intelligence.suggestedFollowUps.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Suggested Follow-Ups").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(intelligence.suggestedFollowUps, id: \.self) { followUp in
                        Text("• \(followUp)").font(.caption)
                    }
                }
            }

            if !intelligence.relatedMemories.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Related Memories").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(intelligence.relatedMemories) { memory in
                        Text("• \(memory.content)").font(.caption).foregroundStyle(.secondary)
                    }
                }
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
    ConversationIntelligenceCardView(
        intelligence: ConversationIntelligence(
            workspaceId: "mock-ws-rcs", conversationId: "mock-conv-1",
            summary: "The user discussed the Acme project timeline.",
            suggestedFollowUps: ["Follow up on the Acme timeline", "Check the contract terms"],
            recentContext: [],
            relatedMemories: [
                RankedMemoryResult(
                    id: "m1", workspaceId: "mock-ws-rcs", scope: .workspace,
                    content: "Acme's project timeline was pushed back two weeks last quarter.",
                    source: nil, conversationId: nil, projectKey: nil, metadata: [:],
                    createdAt: "2026-01-01T00:00:00.000Z", score: 0.82
                ),
            ],
            generatedAt: "2026-01-01T00:00:00.000Z"
        )
    )
}
