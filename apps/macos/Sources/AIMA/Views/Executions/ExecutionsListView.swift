import AIMACore
import SwiftUI

/// The Executions screen's list pane (Phase 2.6, item 8): a "New Execution"
/// entry point plus this workspace's execution history. Selecting a run
/// loads its full record into `ExecutionDetailView` via
/// `ExecutionsViewModel.selectExecution` — the same list-drives-detail
/// pattern `WorkflowsListView`/`ApprovalsListView` use.
struct ExecutionsListView: View {
    let viewModel: ExecutionsViewModel
    let onNewExecution: () -> Void

    var body: some View {
        List(selection: selectionBinding) {
            Section("Actions") {
                Button(action: onNewExecution) {
                    Label("New Execution", systemImage: "bolt.fill")
                }
            }

            Section("History") {
                if viewModel.history.isEmpty {
                    Text("No executions yet.")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                } else {
                    ForEach(viewModel.history) { execution in
                        ExecutionRow(execution: execution)
                            .tag(execution.id)
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
            if viewModel.isLoading && viewModel.history.isEmpty {
                ProgressView()
            }
        }
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { viewModel.selectedExecution?.id },
            set: { newValue in
                guard let newValue else { return }
                Task { await viewModel.selectExecution(newValue) }
            }
        )
    }
}

private struct ExecutionRow: View {
    let execution: ExecutionRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(execution.actionType.replacingOccurrences(of: "_", with: " ").capitalized)
                .fontWeight(.medium)
            HStack(spacing: 6) {
                ExecutionStatusPill(status: execution.status)
                Text(execution.provider.rawValue.capitalized)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    ExecutionsListView(
        viewModel: DependencyContainer.preview.makeExecutionsViewModel(workspaceId: "mock-ws-rcs"),
        onNewExecution: {}
    )
    .frame(width: 300, height: 500)
}
