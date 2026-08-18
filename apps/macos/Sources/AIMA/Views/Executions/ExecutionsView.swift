import AIMACore
import SwiftUI

/// The Executions screen (Phase 2.6, item 8): a two-pane layout — a "New
/// Execution" entry point plus execution history on the left, the selected
/// execution's detail on the right — mirroring `WorkflowsView`'s
/// list/detail split. Starting an execution always goes through a preview
/// (`NewExecutionSheet`) and a confirmation dialog
/// (`ExecutionConfirmationSheet`) before anything is created; "Execute" on
/// the detail pane is a separate, explicit step after that.
struct ExecutionsView: View {
    let container: DependencyContainer
    @State private var viewModel: ExecutionsViewModel
    @State private var isPresentingNewExecutionSheet = false

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeExecutionsViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        HStack(spacing: 0) {
            ExecutionsListView(viewModel: viewModel, onNewExecution: { isPresentingNewExecutionSheet = true })
                .frame(width: 300)

            Divider()

            ExecutionDetailView(viewModel: viewModel)
        }
        .navigationTitle("Executions")
        .task {
            await viewModel.loadHistory()
        }
        .sheet(isPresented: $isPresentingNewExecutionSheet) {
            NewExecutionSheet { actionType, payload in
                await viewModel.requestPreview(actionType: actionType, payload: payload)
            }
        }
        .sheet(isPresented: previewSheetBinding) {
            if let preview = viewModel.pendingPreview {
                ExecutionConfirmationSheet(
                    preview: preview,
                    onConfirm: { Task { await viewModel.confirmPendingPreview() } },
                    onCancel: { viewModel.dismissPreview() }
                )
            }
        }
    }

    private var previewSheetBinding: Binding<Bool> {
        Binding(
            get: { viewModel.pendingPreview != nil },
            set: { isPresented in
                if !isPresented { viewModel.dismissPreview() }
            }
        )
    }
}

#Preview {
    ExecutionsView(container: .preview, workspaceId: "mock-ws-rcs")
}
