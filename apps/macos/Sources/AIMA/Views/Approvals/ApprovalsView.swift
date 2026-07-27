import AIMACore
import SwiftUI

/// The Approvals screen (Phase 2.2, item 3): a full, filterable list of a
/// workspace's approvals plus a detail pane — a fuller view than the
/// Dashboard's pending-only quick list and its inline approve/reject
/// buttons. A two-pane layout (list / detail), mirroring `ChatView`'s
/// conversation-list-plus-history split.
struct ApprovalsView: View {
    let container: DependencyContainer
    @State private var viewModel: ApprovalsViewModel

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeApprovalsViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        HStack(spacing: 0) {
            ApprovalsListView(viewModel: viewModel)
                .frame(width: 280)

            Divider()

            ApprovalDetailView(viewModel: viewModel)
        }
        .navigationTitle("Approvals")
        .task {
            await viewModel.load()
        }
    }
}

#Preview {
    ApprovalsView(container: .preview, workspaceId: "mock-ws-rcs")
}
