import AIMACore
import SwiftUI

/// The Memory tab — verifies the sprint's "save memory → appears in Memory/briefing context" flow. Adapted from
/// `apps/macos/Sources/AIMA/Views/Memory/MemoryView.swift`: same `MemoryViewModel`, same list/search/scope-
/// filter/archived-toggle controls (all cross-platform SwiftUI). Simplified for v1: creation uses one inline
/// sheet (`MemoryCreateSheet` below, built directly against `CreateMemoryRequest` — there is no shared, only a
/// macOS-local `MemoryCreateSheet`/`MemoryEditSheet` in `apps/macos`, not reusable here without duplicating a
/// whole SwiftUI file into a second package). Editing a memory is a known, documented v1 gap — archive/delete
/// (swipe actions) and creation cover the flow this sprint verifies.
struct MemoryView: View {
    let container: DependencyContainer
    @State private var viewModel: MemoryViewModel
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

                Spacer()

                Toggle("Show Archived", isOn: includeArchivedBinding)
                    .labelsHidden()
                Text("Archived").font(.caption).foregroundStyle(.secondary)
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
            List {
                ForEach(viewModel.memories) { memory in
                    MemoryRowView(scope: memory.scope, content: memory.content, importance: memory.importanceScore, confidence: memory.confidenceScore, isArchived: memory.isArchived)
                        .swipeActions {
                            Button("Delete", role: .destructive) { Task { await viewModel.delete(memory) } }
                            if !memory.isArchived {
                                Button("Archive") { Task { await viewModel.archive(memory) } }
                                    .tint(.orange)
                            }
                        }
                }
            }
            .listStyle(.plain)
        }
    }

    private var searchResultsList: some View {
        Group {
            if viewModel.searchResults.isEmpty {
                ContentUnavailableView.search(text: viewModel.searchQuery)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.searchResults) { result in
                    MemoryRowView(scope: result.scope, content: result.content, importance: result.importanceScore, confidence: result.confidenceScore, isArchived: result.archivedAt != nil)
                }
                .listStyle(.plain)
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
            }

            Text(content)
                .lineLimit(3)
        }
        .padding(.vertical, 4)
        .opacity(isArchived ? 0.6 : 1.0)
    }
}

/// A minimal creation form — the fields that matter for the sprint's "save memory → appears in Memory/briefing
/// context" flow: scope and content. Importance/confidence/type are left to their server-side defaults, same as
/// leaving them `nil` in `CreateMemoryRequest`.
private struct MemoryCreateSheet: View {
    let onCreate: (CreateMemoryRequest) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var scope: MemoryScope = .workspace
    @State private var content = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Picker("Scope", selection: $scope) {
                    ForEach([MemoryScope.user, .workspace, .conversation, .project], id: \.self) { scope in
                        Text(scope.rawValue.capitalized).tag(scope)
                    }
                }
                TextField("What should AIMA remember?", text: $content, axis: .vertical)
                    .lineLimit(3...8)
            }
            .navigationTitle("New Memory")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            isSaving = true
                            await onCreate(CreateMemoryRequest(scope: scope, content: content))
                            isSaving = false
                            dismiss()
                        }
                    }
                    .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        MemoryView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
