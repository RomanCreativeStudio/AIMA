import AIMACore
import SwiftUI

/// The Approvals screen's detail pane (Phase 2.2, item 3): the full record
/// for the selected approval — action type, status, payload, timestamps —
/// plus Approve/Reject actions when it's still pending.
struct ApprovalDetailView: View {
    let viewModel: ApprovalsViewModel

    var body: some View {
        Group {
            if let approval = viewModel.selectedApproval {
                detail(for: approval)
            } else {
                ContentUnavailableView(
                    "No Approval Selected",
                    systemImage: "checkmark.seal",
                    description: Text("Choose an approval from the list to see its details.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func detail(for approval: PendingApproval) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(approval.actionType)
                        .font(.title2)
                        .fontWeight(.semibold)
                    Spacer()
                    StatusPill(status: approval.status)
                }

                detailRow("Created", approval.createdAt)
                detailRow("Expires", approval.expiresAt)
                if let resolvedAt = approval.resolvedAt {
                    detailRow("Resolved", resolvedAt)
                }

                if let payload = approval.payload {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Payload").font(.headline)
                        Text(payload.displayString)
                            .font(.system(.callout, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                if approval.status == .pending {
                    HStack {
                        Button("Approve") {
                            Task { await viewModel.approve(approval) }
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Reject", role: .destructive) {
                            Task { await viewModel.reject(approval) }
                        }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
        .font(.callout)
    }
}

private struct ApprovalDetailPreview: View {
    @State private var viewModel = DependencyContainer.preview.makeApprovalsViewModel(workspaceId: "mock-ws-rcs")

    var body: some View {
        ApprovalDetailView(viewModel: viewModel)
            .frame(width: 400, height: 400)
            .task {
                await viewModel.load()
                if let approval = viewModel.approvals.first {
                    await viewModel.selectApproval(approval)
                }
            }
    }
}

#Preview {
    ApprovalDetailPreview()
}
