import AIMACore
import SwiftUI

/// The Approvals screen's list pane (Phase 2.2, item 3): every approval
/// matching the active status filter. Selecting one loads its full detail
/// into `ApprovalDetailView` via `ApprovalsViewModel.selectApproval` — the
/// same list-drives-detail pattern `ConversationListView` uses for Chat.
struct ApprovalsListView: View {
    let viewModel: ApprovalsViewModel

    var body: some View {
        VStack(spacing: 0) {
            statusFilterPicker

            Divider()

            List(selection: selectionBinding) {
                ForEach(viewModel.approvals) { approval in
                    ApprovalRow(approval: approval)
                        .tag(approval.id)
                }
            }
            .listStyle(.sidebar)
            .overlay {
                if viewModel.isLoading && viewModel.approvals.isEmpty {
                    ProgressView()
                } else if viewModel.approvals.isEmpty {
                    ContentUnavailableView(
                        "No Approvals",
                        systemImage: "checkmark.seal",
                        description: Text("Nothing matches this filter.")
                    )
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
                    .padding(8)
            }
        }
    }

    private var statusFilterPicker: some View {
        Picker("Status", selection: statusFilterBinding) {
            Text("Pending").tag(ApprovalStatus?.some(.pending))
            Text("Approved").tag(ApprovalStatus?.some(.approved))
            Text("Rejected").tag(ApprovalStatus?.some(.rejected))
            Text("Expired").tag(ApprovalStatus?.some(.expired))
            Text("All").tag(ApprovalStatus?.none)
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .padding(8)
    }

    private var statusFilterBinding: Binding<ApprovalStatus?> {
        Binding(
            get: { viewModel.statusFilter },
            set: { newValue in Task { await viewModel.setStatusFilter(newValue) } }
        )
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { viewModel.selectedApproval?.id },
            set: { newValue in
                guard let newValue, let approval = viewModel.approvals.first(where: { $0.id == newValue }) else { return }
                Task { await viewModel.selectApproval(approval) }
            }
        )
    }
}

private struct ApprovalRow: View {
    let approval: PendingApproval

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(approval.actionType).fontWeight(.medium)
            HStack(spacing: 6) {
                StatusPill(status: approval.status)
                Text("Expires \(approval.expiresAt)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// A small colored capsule for an `ApprovalStatus` — shared by the
/// Approvals list, its detail pane, and the Chat screen's approval card.
struct StatusPill: View {
    let status: ApprovalStatus

    private var color: Color {
        switch status {
        case .pending: return .orange
        case .approved: return .green
        case .rejected: return .red
        case .expired: return .secondary
        }
    }

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }
}

#Preview {
    ApprovalsListView(viewModel: DependencyContainer.preview.makeApprovalsViewModel(workspaceId: "mock-ws-rcs"))
        .frame(width: 280, height: 400)
}
