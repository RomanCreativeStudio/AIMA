import AIMACore
import SwiftUI

/// The Chat screen's retrieved-context panel (Phase 3.6): the merged
/// memories/related-conversations/related-tasks that came back attached to
/// the most recent reply. Purely read-only display of metadata the
/// response already carried — nothing here triggers a separate fetch, so
/// it is not "background retrieval," just a transparency affordance for
/// what `ConversationService.sendMessage` already computed advisorily
/// server-side (docs/decisions/0021-semantic-search-and-context-retrieval.md).
struct RetrievedContextCardView: View {
    let context: RetrievedContext

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "text.magnifyingglass")
                    .foregroundStyle(.teal)
                Text("Retrieved Context")
                    .fontWeight(.medium)
            }

            if !context.memories.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Memories").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.memories) { memory in
                        Text("• \(memory.content)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if !context.relatedConversations.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Related Conversations").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.relatedConversations) { result in
                        Text("• \(result.content)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if !context.relatedTasks.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Related Tasks").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.relatedTasks) { result in
                        Text("• \(result.content)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.teal.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

#Preview {
    RetrievedContextCardView(
        context: RetrievedContext(
            memories: [
                RankedMemoryResult(
                    id: "m1", workspaceId: "mock-ws-rcs", scope: .workspace,
                    content: "The client prefers async written updates over calls.",
                    source: nil, conversationId: nil, projectKey: nil, metadata: [:],
                    createdAt: "2026-01-01T00:00:00.000Z", score: 0.82
                ),
            ],
            relatedConversations: [],
            relatedTasks: [
                SearchResult(
                    id: "emb-1", workspaceId: "mock-ws-rcs", sourceType: .task, sourceId: "task-1", chunkIndex: 0,
                    content: "Schedule client call\n\nCoordinate with the client on timing.",
                    embeddingVersion: 1, indexedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
                    score: 0.74
                ),
            ]
        )
    )
}
