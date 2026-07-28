import AIMACore
import SwiftUI

/// The Workflows screen's detail pane (Phase 2.4, item 5): the selected
/// run's status, step-by-step progress, approval checkpoints, and the
/// execute/pause/resume/cancel actions. Mirrors `WorkflowService`'s
/// one-step-at-a-time design (`backend/src/workflows/workflowService.ts`)
/// — "Execute Next Step" only ever advances one step, never runs the whole
/// workflow to completion in one call.
struct WorkflowDetailView: View {
    let viewModel: WorkflowsViewModel

    var body: some View {
        Group {
            if let run = viewModel.selectedRunDetail {
                detail(for: run)
            } else {
                ContentUnavailableView(
                    "No Run Selected",
                    systemImage: "flowchart",
                    description: Text("Start a workflow or choose one from Run History to see its progress.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func detail(for run: WorkflowRunDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(run.workflowKey.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.title2)
                        .fontWeight(.semibold)
                    Spacer()
                    WorkflowRunStatusPill(status: run.status)
                }

                if !run.input.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Input").font(.headline)
                        ForEach(run.input.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                            Text("\(key): \(value)").font(.callout)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Steps").font(.headline)
                    ForEach(run.steps) { step in
                        WorkflowStepRowView(step: step, isCurrent: step.stepIndex == run.currentStepIndex)
                    }
                }

                if run.status == .awaitingApproval {
                    Label("This step requires approval before it runs. Approve or reject it from the Approvals screen, then Resume here.", systemImage: "hand.raised.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }

                if let result = run.result {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Result").font(.headline)
                        ForEach(result.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                            Text("\(key): \(value.displayString)")
                                .font(.system(.callout, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                actionButtons(for: run)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func actionButtons(for run: WorkflowRunDetail) -> some View {
        HStack {
            switch run.status {
            case .pending, .running:
                Button("Execute Next Step") { Task { await viewModel.executeNextStep() } }
                    .buttonStyle(.borderedProminent)
                Button("Pause") { Task { await viewModel.pause() } }
                    .buttonStyle(.bordered)
                Button("Cancel", role: .destructive) { Task { await viewModel.cancel() } }
            case .paused:
                Button("Resume") { Task { await viewModel.resume() } }
                    .buttonStyle(.borderedProminent)
                Button("Cancel", role: .destructive) { Task { await viewModel.cancel() } }
            case .awaitingApproval:
                Button("Resume") { Task { await viewModel.resume() } }
                    .buttonStyle(.borderedProminent)
                Button("Cancel", role: .destructive) { Task { await viewModel.cancel() } }
            case .completed, .failed, .cancelled:
                EmptyView()
            }
        }
    }
}

private struct WorkflowStepRowView: View {
    let step: WorkflowStepRun
    let isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(step.stepIndex + 1). \(step.stepKey.replacingOccurrences(of: "_", with: " ").capitalized)")
                    .fontWeight(isCurrent ? .semibold : .regular)
                if let capability = step.capability {
                    Text(capability)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                WorkflowStepStatusPill(status: step.status)
            }
            if let output = step.output {
                Text(JSONValue.object(output).displayString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(isCurrent ? Color.accentColor.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
    }
}

private struct WorkflowDetailPreview: View {
    @State private var viewModel = DependencyContainer.preview.makeWorkflowsViewModel(workspaceId: "mock-ws-rcs")

    var body: some View {
        WorkflowDetailView(viewModel: viewModel)
            .frame(width: 480, height: 500)
            .task {
                await viewModel.load()
                await viewModel.createRun(workflowKey: .dailyWorkspaceBriefing, input: [:])
            }
    }
}

#Preview {
    WorkflowDetailPreview()
}
