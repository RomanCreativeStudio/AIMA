import AIMACore
import SwiftUI

/// The Memory Management screen (Phase 3.4, item 7): view, search, edit,
/// archive, and delete a workspace's memories, with importance/confidence
/// shown on each row. Every mutation is an explicit user action (button tap
/// in a confirmation-backed sheet or menu) — there is no background sync or
/// auto-save, matching "no hidden storage" (docs/decisions/
/// 0019-advanced-memory-system.md).
struct MemoryView: View {
    let container: DependencyContainer
    @State private var viewModel: MemoryViewModel
    @State private var editTarget: MemoryRecord?
    @State private var isPresentingCreateSheet = false

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeMemoryViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(spacing: 0) {
            controls

            Divider()

            content
        }
        .navigationTitle("Memory")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isPresentingCreateSheet = true
                } label: {
                    Label("New Memory", systemImage: "plus")
                }
            }
        }
        .task {
            await viewModel.load()
        }
        .sheet(item: $editTarget) { memory in
            MemoryEditSheet(memory: memory) { request in
                await viewModel.updateMemory(memory, request: request)
            }
        }
        .sheet(isPresented: $isPresentingCreateSheet) {
            MemoryCreateSheet { request in
                await viewModel.createMemory(request)
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }

            TextField("Search memories…", text: searchBinding)
                .textFieldStyle(.roundedBorder)

            HStack {
                Picker("Scope", selection: scopeFilterBinding) {
                    Text("All Scopes").tag(MemoryScope?.none)
                    ForEach([MemoryScope.user, .workspace, .conversation, .project], id: \.self) { scope in
                        Text(scope.rawValue.capitalized).tag(MemoryScope?.some(scope))
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 200)

                Toggle("Show Archived", isOn: includeArchivedBinding)

                Spacer()
            }
        }
        .padding(8)
    }

    private var searchBinding: Binding<String> {
        Binding(
            get: { viewModel.searchQuery },
            set: { newValue in Task { await viewModel.search(newValue) } }
        )
    }

    private var scopeFilterBinding: Binding<MemoryScope?> {
        Binding(
            get: { viewModel.scopeFilter },
            set: { newValue in Task { await viewModel.setScopeFilter(newValue) } }
        )
    }

    private var includeArchivedBinding: Binding<Bool> {
        Binding(
            get: { viewModel.includeArchived },
            set: { newValue in Task { await viewModel.setIncludeArchived(newValue) } }
        )
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isSearching {
            searchResultsList
        } else if viewModel.isLoading && viewModel.memories.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.memories.isEmpty {
            ContentUnavailableView(
                "No Memories",
                systemImage: "brain",
                description: Text("Nothing saved for this workspace yet.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(viewModel.memories) { memory in
                MemoryRowView(scope: memory.scope, content: memory.content, importance: memory.importanceScore, confidence: memory.confidenceScore, isArchived: memory.isArchived)
                    .contextMenu {
                        Button("Edit") { editTarget = memory }
                        if !memory.isArchived {
                            Button("Archive") { Task { await viewModel.archive(memory) } }
                        }
                        Button("Delete", role: .destructive) { Task { await viewModel.delete(memory) } }
                    }
            }
        }
    }

    /// Search results are a read-only preview — editing/archiving/deleting happens from the main list, where
    /// each row already carries the full `MemoryRecord` this screen's actions operate on.
    private var searchResultsList: some View {
        Group {
            if viewModel.searchResults.isEmpty {
                ContentUnavailableView.search(text: viewModel.searchQuery)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.searchResults) { result in
                    MemoryRowView(scope: result.scope, content: result.content, importance: result.importanceScore, confidence: result.confidenceScore, isArchived: result.archivedAt != nil)
                }
            }
        }
    }
}

private extension MemoryViewModel {
    var isSearching: Bool { !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

private struct MemoryRowView: View {
    let scope: MemoryScope
    let content: String
    let importance: Double?
    let confidence: Double?
    let isArchived: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(scope.rawValue.capitalized)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.quaternary.opacity(0.5), in: Capsule())

                if isArchived {
                    Text("Archived")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                ScoreIndicator(label: "Importance", value: importance)
                ScoreIndicator(label: "Confidence", value: confidence)
            }

            Text(content)
                .lineLimit(3)
        }
        .padding(.vertical, 4)
        .opacity(isArchived ? 0.6 : 1.0)
    }
}

/// A small labeled dot conveying an importance/confidence score at a glance, mirroring
/// `TasksView.PriorityIndicator`'s color-coded-dot convention.
private struct ScoreIndicator: View {
    let label: String
    let value: Double?

    private var color: Color {
        guard let value else { return .secondary }
        switch value {
        case ..<0.34: return .secondary
        case ..<0.67: return .orange
        default: return .green
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .help(value.map { "\(label): \(Int($0 * 100))%" } ?? "\(label): unknown")
    }
}

#Preview {
    NavigationStack {
        MemoryView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
