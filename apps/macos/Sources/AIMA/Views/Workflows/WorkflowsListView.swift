import AIMACore
import SwiftUI

/// The Workflows screen's list pane (Phase 2.4, item 5): the four built-in
/// workflow definitions (each startable via `onStart`) plus this
/// workspace's run history. Selecting a run loads its full detail into
/// `WorkflowDetailView` via `WorkflowsViewModel.selectRun` — the same
/// list-drives-detail pattern `ApprovalsListView` uses.
struct WorkflowsListView: View {
    let viewModel: WorkflowsViewModel
    let onStart: (WorkflowDefinition) -> Void

    var body: some View {
        List(selection: selectionBinding) {
            Section("Start a Workflow") {
                ForEach(viewModel.definitions) { definition in
                    WorkflowDefinitionRow(definition: definition, onStart: { onStart(definition) })
                }
            }

            Section("Run History") {
                if viewModel.runs.isEmpty {
                    Text("No runs yet.")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                } else {
                    ForEach(viewModel.runs) { run in
                        WorkflowRunRow(run: run, displayName: displayName(for: run.workflowKey))
                            .tag(run.id)
                    }
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        }
        .listStyle(.sidebar)
        .overlay {
            if viewModel.isLoading && viewModel.definitions.isEmpty {
                ProgressView()
            }
        }
    }

    private func displayName(for key: WorkflowKey) -> String {
        viewModel.definitions.first(where: { $0.key == key })?.displayName ?? key.rawValue
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { viewModel.selectedRunDetail?.id },
            set: { newValue in
                guard let newValue else { return }
                Task { await viewModel.selectRun(newValue) }
            }
        )
    }
}

private struct WorkflowDefinitionRow: View {
    let definition: WorkflowDefinition
    let onStart: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(definition.displayName).fontWeight(.medium)
                Text(definition.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            Button("Start", action: onStart)
                .buttonStyle(.bordered)
        }
        .padding(.vertical, 2)
    }
}

private struct WorkflowRunRow: View {
    let run: WorkflowRun
    let displayName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(displayName).fontWeight(.medium)
            HStack(spacing: 6) {
                WorkflowRunStatusPill(status: run.status)
                Text("Step \(run.currentStepIndex + 1)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    WorkflowsListView(viewModel: DependencyContainer.preview.makeWorkflowsViewModel(workspaceId: "mock-ws-rcs"), onStart: { _ in })
        .frame(width: 300, height: 500)
}
