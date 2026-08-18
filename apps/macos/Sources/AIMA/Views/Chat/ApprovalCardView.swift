import AIMACore
import SwiftUI

/// The Chat screen's inline approval card (Phase 2.2, item 3) — the same
/// approve/reject action the Approvals/Dashboard screens offer, surfaced
/// right where the conversation triggered it so a user doesn't have to
/// leave the conversation to act on it. Shown whenever
/// `ChatViewModel.lastPendingApproval` is set.
struct ApprovalCardView: View {
    let approval: PendingApproval
    let onApprove: () -> Void
    let onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(.orange)
                Text("Approval needed: \(approval.actionType)")
                    .fontWeight(.medium)
                Spacer()
                StatusPill(status: approval.status)
            }
            Text("Expires \(approval.expiresAt)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if approval.status == .pending {
                HStack {
                    Button("Approve", action: onApprove)
                        .buttonStyle(.borderedProminent)
                    Button("Reject", role: .destructive, action: onReject)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.orange.opacity(0.3)))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

#Preview {
    ApprovalCardView(
        approval: PendingApproval(
            id: "1", workspaceId: "w1", actionType: "send_email", payload: nil,
            status: .pending, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", resolvedAt: nil
        ),
        onApprove: {},
        onReject: {}
    )
}
