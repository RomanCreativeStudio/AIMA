import AIMACore
import SwiftUI

/// The Executions screen's detail pane (Phase 2.6, item 8): the selected
/// execution's status, request payload, response summary or error, and the
/// "Execute" action. Mirrors `ExecutionService.execute`'s "advance at most
/// one attempt, idempotent on a terminal record" design — pressing
/// "Execute" again after success/failure is harmless, since the mock (and
/// the real backend) just return the stored record without re-contacting
/// the provider.
struct ExecutionDetailView: View {
    let viewModel: ExecutionsViewModel

    var body: some View {
        Group {
            if let execution = viewModel.selectedExecution {
                detail(for: execution)
            } else {
                ContentUnavailableView(
                    "No Execution Selected",
                    systemImage: "bolt",
                    description: Text("Start a new execution or choose one from History to see its detail.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func detail(for execution: ExecutionRecord) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(execution.actionType.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.title2)
                        .fontWeight(.semibold)
                    Spacer()
                    ExecutionStatusPill(status: execution.status)
                }

                Text("Provider: \(execution.provider.rawValue.capitalized)")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                if !execution.requestPayload.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Request").font(.headline)
                        Text(JSONValue.object(execution.requestPayload).displayString)
                            .font(.system(.callout, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }

                if let responseSummary = execution.responseSummary {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Response").font(.headline)
                        Text(JSONValue.object(responseSummary).displayString)
                            .font(.system(.callout, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }

                if let errorDetails = execution.errorDetails {
                    Label(errorDetails, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.callout)
                }

                if execution.status == .awaitingApproval {
                    Label(
                        "This execution requires approval before it runs. Approve or reject it from the Approvals screen, then Execute here.",
                        systemImage: "hand.raised.fill"
                    )
                    .foregroundStyle(.orange)
                    .font(.callout)
                }

                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                VStack(alignment: .leading, spacing: 4) {
                    if let startedAt = execution.startedAt {
                        Text("Started: \(startedAt)").font(.caption2).foregroundStyle(.secondary)
                    }
                    if let completedAt = execution.completedAt {
                        Text("Completed: \(completedAt)").font(.caption2).foregroundStyle(.secondary)
                    }
                }

                actionButtons(for: execution)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func actionButtons(for execution: ExecutionRecord) -> some View {
        switch execution.status {
        case .pending, .awaitingApproval:
            Button("Execute") { Task { await viewModel.executeSelected() } }
                .buttonStyle(.borderedProminent)
        case .succeeded, .failed:
            EmptyView()
        }
    }
}

private struct ExecutionDetailPreview: View {
    @State private var viewModel = DependencyContainer.preview.makeExecutionsViewModel(workspaceId: "mock-ws-rcs")

    var body: some View {
        ExecutionDetailView(viewModel: viewModel)
            .frame(width: 480, height: 500)
            .task {
                // `mock-ws-rcs` has GitHub connected (not Gmail) in `MockAPIClient`'s seed data.
                await viewModel.requestPreview(
                    actionType: "create_github_issue",
                    payload: ["repository": .string("romancreativestudio/aima"), "title": .string("Example issue")]
                )
                await viewModel.confirmPendingPreview()
            }
    }
}

#Preview {
    ExecutionDetailPreview()
}
