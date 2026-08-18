import AIMACore
import SwiftUI

/// The Workflows screen (Phase 2.4, item 5): a two-pane layout — available
/// workflows plus run history on the left, the selected run's step-by-step
/// detail on the right — mirroring `ApprovalsView`'s list/detail split.
struct WorkflowsView: View {
    let container: DependencyContainer
    @State private var viewModel: WorkflowsViewModel
    @State private var sheetDefinition: WorkflowDefinition?

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeWorkflowsViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        HStack(spacing: 0) {
            WorkflowsListView(viewModel: viewModel, onStart: { sheetDefinition = $0 })
                .frame(width: 300)

            Divider()

            WorkflowDetailView(viewModel: viewModel)
        }
        .navigationTitle("Workflows")
        .task {
            await viewModel.load()
        }
        .sheet(item: $sheetDefinition) { definition in
            NewWorkflowRunSheet(definition: definition) { input in
                await viewModel.createRun(workflowKey: definition.key, input: input)
            }
        }
    }
}

#Preview {
    WorkflowsView(container: .preview, workspaceId: "mock-ws-rcs")
}
