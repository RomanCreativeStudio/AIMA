import AIMACore
import SwiftUI

/// A small colored capsule for a `WorkflowRunStatus` — shared by the run
/// history list and the detail pane, mirroring `StatusPill` for approvals.
struct WorkflowRunStatusPill: View {
    let status: WorkflowRunStatus

    private var color: Color {
        switch status {
        case .pending: return .secondary
        case .running: return .blue
        case .awaitingApproval: return .orange
        case .paused: return .yellow
        case .completed: return .green
        case .failed: return .red
        case .cancelled: return .secondary
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

/// A small colored capsule for a `WorkflowStepStatus` — used by the step
/// progress list in the detail pane.
struct WorkflowStepStatusPill: View {
    let status: WorkflowStepStatus

    private var color: Color {
        switch status {
        case .pending: return .secondary
        case .completed: return .green
        case .awaitingApproval: return .orange
        case .failed: return .red
        case .skipped: return .secondary
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
