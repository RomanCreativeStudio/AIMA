import AIMACore
import SwiftUI

/// A small colored capsule for an `ExecutionStatus` — mirrors
/// `WorkflowRunStatusPill`/`StatusPill`.
struct ExecutionStatusPill: View {
    let status: ExecutionStatus

    private var color: Color {
        switch status {
        case .pending: return .secondary
        case .awaitingApproval: return .orange
        case .succeeded: return .green
        case .failed: return .red
        }
    }

    private var label: String {
        switch status {
        case .awaitingApproval: return "Awaiting Approval"
        default: return status.rawValue.capitalized
        }
    }

    var body: some View {
        Text(label)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }
}
