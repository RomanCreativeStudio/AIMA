import AIMACore
import SwiftUI

/// The Search screen (Phase 3.6, item 6): manual semantic search across a
/// workspace's indexed conversations/tasks/memories, an optional retrieved-
/// context view for the same query, and a manual re-index trigger. Every
/// fetch here is the result of an explicit button tap
/// (`SearchViewModel.search`/`loadContext`/`reindex`) — there is no
/// automatic search-as-you-type, no automatic popup, and no background
/// retrieval UI (docs/decisions/0021-semantic-search-and-context-retrieval.md).
struct SearchView: View {
    let container: DependencyContainer
    @State private var viewModel: SearchViewModel

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeSearchViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(spacing: 0) {
            controls

            Divider()

            content
        }
        .navigationTitle("Search")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await viewModel.reindex() }
                } label: {
                    if viewModel.isReindexing {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Re-index Workspace", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                .disabled(viewModel.isReindexing)
                .help("Re-chunks and re-embeds this workspace's conversations and tasks.")
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }

            if let result = viewModel.lastReindexResult {
                ReindexResultBanner(result: result)
            }

            HStack {
                TextField("Search conversations, tasks, memories…", text: $viewModel.query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await viewModel.search() } }

                Picker("Source", selection: $viewModel.sourceTypeFilter) {
                    Text("All").tag(EmbeddingSourceType?.none)
                    ForEach([EmbeddingSourceType.conversation, .task, .memory], id: \.self) { type in
                        Text(type.rawValue.capitalized).tag(EmbeddingSourceType?.some(type))
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 140)

                Button("Search") {
                    Task { await viewModel.search() }
                }
                .disabled(viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isSearching)

                Button("Show Context") {
                    Task { await viewModel.loadContext() }
                }
                .disabled(viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoadingContext)
            }
        }
        .padding(8)
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let context = viewModel.context {
                    RetrievedContextSectionView(context: context)
                }

                resultsSection
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var resultsSection: some View {
        if viewModel.isSearching {
            ProgressView()
                .frame(maxWidth: .infinity)
        } else if viewModel.results.isEmpty {
            if viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView(
                    "Search This Workspace",
                    systemImage: "magnifyingglass",
                    description: Text("Find related conversations, tasks, and memories by meaning, not just keywords.")
                )
                .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                ContentUnavailableView.search(text: viewModel.query)
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Results").font(.headline)
                ForEach(viewModel.results) { result in
                    SearchResultRowView(result: result)
                }
            }
        }
    }
}

private struct ReindexResultBanner: View {
    let result: ReindexWorkspaceResult

    private var conversationsIndexed: Int { result.conversations.reduce(0) { $0 + $1.chunksIndexed } }
    private var tasksIndexed: Int { result.tasks.reduce(0) { $0 + $1.chunksIndexed } }

    var body: some View {
        Label(
            "Re-indexed \(conversationsIndexed) conversation chunk(s) and \(tasksIndexed) task chunk(s).",
            systemImage: "checkmark.circle.fill"
        )
        .font(.caption)
        .foregroundStyle(.green)
    }
}

/// One ranked search result: source type, similarity score, and a content snippet.
private struct SearchResultRowView: View {
    let result: SearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(result.sourceType.rawValue.capitalized)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.quaternary.opacity(0.5), in: Capsule())

                Spacer()

                SimilarityScoreView(score: result.score)
            }

            Text(result.content)
                .font(.callout)
                .lineLimit(3)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// A percentage readout of cosine similarity — higher is more relevant.
struct SimilarityScoreView: View {
    let score: Double

    private var color: Color {
        switch score {
        case ..<0.34: return .secondary
        case ..<0.67: return .orange
        default: return .green
        }
    }

    var body: some View {
        Text("\(Int((score * 100).rounded()))% match")
            .font(.caption)
            .foregroundStyle(color)
    }
}

/// The merged memories/conversations/tasks for one query (`RetrievedContext`) — the same read
/// `RetrievedContextCardView` renders inline in Chat, reused here as a standalone section.
struct RetrievedContextSectionView: View {
    let context: RetrievedContext

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Retrieved Context").font(.headline)

            if !context.memories.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Memories").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.memories) { memory in
                        Text("• \(memory.content)").font(.caption)
                    }
                }
            }

            if !context.relatedConversations.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Related Conversations").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.relatedConversations) { result in
                        Text("• \(result.content)").font(.caption)
                    }
                }
            }

            if !context.relatedTasks.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Related Tasks").font(.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    ForEach(context.relatedTasks) { result in
                        Text("• \(result.content)").font(.caption)
                    }
                }
            }

            if context.memories.isEmpty && context.relatedConversations.isEmpty && context.relatedTasks.isEmpty {
                Text("Nothing relevant found for this query.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.teal.opacity(0.3)))
    }
}

#Preview {
    NavigationStack {
        SearchView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
