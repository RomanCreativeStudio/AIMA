import AIMACore
import SwiftUI

/// The Workspace screen (Phase 2.1, item 2): switch between the four fixed
/// workspaces (Personal, Roman Creative Studio, Mythic Forge Studios,
/// Development — `docs/PRODUCT_BIBLE.md` §1). Switching here updates the
/// single shared `WorkspaceViewModel` every other screen reads.
struct WorkspaceSwitcherView: View {
    let viewModel: WorkspaceViewModel

    var body: some View {
        List {
            if let errorMessage = viewModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }

            ForEach(viewModel.workspaces) { workspace in
                Button {
                    viewModel.switchWorkspace(to: workspace.id)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(workspace.name)
                                .fontWeight(.medium)
                            Text(workspace.type.rawValue.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if workspace.id == viewModel.activeWorkspaceId {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.tint)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            activitySummarySection
        }
        .navigationTitle("Workspace")
        .overlay {
            if viewModel.isLoading && viewModel.workspaces.isEmpty {
                ProgressView()
            }
        }
        .task {
            if viewModel.workspaces.isEmpty {
                await viewModel.load()
            }
        }
        .task(id: viewModel.activeWorkspaceId) {
            await viewModel.loadActivitySummary()
        }
    }

    /// Activity Summary (Phase 3.5, item 8) — reuses the existing Phase 2.5 `WorkspaceInsights` read, refreshed
    /// whenever the active workspace changes.
    @ViewBuilder
    private var activitySummarySection: some View {
        Section("Activity Summary") {
            if let summary = viewModel.activitySummary {
                LabeledContent("Actions Logged", value: "\(summary.activityMetrics.totalActions)")
                LabeledContent("Workflow Runs", value: "\(summary.workflowMetrics.totalRuns)")
                LabeledContent("Pending Approvals", value: "\(summary.approvalMetrics.pending)")
                LabeledContent("Task Completion", value: "\(Int(summary.taskMetrics.completionRate * 100))%")
            } else {
                Text("No activity yet.").foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    NavigationStack {
        WorkspaceSwitcherView(viewModel: DependencyContainer.preview.makeWorkspaceViewModel())
    }
}
