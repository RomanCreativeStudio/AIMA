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

            if !viewModel.workspaces.isEmpty {
                digestSection
                activitySummarySection
            }
        }
        .navigationTitle("Workspace")
        .overlay {
            if viewModel.isLoading && viewModel.workspaces.isEmpty {
                ProgressView()
            } else if viewModel.workspaces.isEmpty {
                // A real, if rare, state (Product Flow & Beta Readiness Audit): an account with no workspace
                // yet — e.g. one just auto-provisioned on first login before any workspace exists for it.
                // Explains what's true instead of showing an empty list with no context.
                ContentUnavailableView(
                    "No Workspaces Yet",
                    systemImage: "square.stack.3d.up.slash",
                    description: Text("This account has no workspace set up yet. Contact your AIMA administrator to get one created.")
                )
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
        .task {
            await viewModel.loadDigest()
        }
    }

    /// Cross-Workspace Daily Digest sprint: what needs attention across every workspace the caller owns, without
    /// switching `activeWorkspaceId` — reuses `SuggestionRow` for each workspace's top suggestion, same as the
    /// Dashboard's "Needs Attention"/"Recommendations" sections.
    @ViewBuilder
    private var digestSection: some View {
        Section("All Workspaces") {
            if viewModel.isLoadingDigest && viewModel.digest.isEmpty {
                ProgressView()
            } else if viewModel.digest.isEmpty {
                Text("No digest available yet.").foregroundStyle(.secondary)
            } else {
                ForEach(viewModel.digest) { entry in
                    digestRow(entry)
                }
            }
        }
    }

    private func digestRow(_ entry: WorkspaceDigestEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(entry.workspaceName).fontWeight(.medium)
                Spacer()
                if entry.nudgeCount > 0 {
                    Label("\(entry.nudgeCount) needs attention", systemImage: "bell.badge.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            Text(entry.greeting)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                if entry.pendingApprovalCount > 0 {
                    Label("\(entry.pendingApprovalCount) approval(s)", systemImage: "checkmark.seal")
                }
                if entry.overdueTaskCount > 0 {
                    Label("\(entry.overdueTaskCount) overdue", systemImage: "clock.badge.exclamationmark")
                }
                if entry.blockedItemCount > 0 {
                    Label("\(entry.blockedItemCount) blocked", systemImage: "hand.raised")
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            if let topSuggestion = entry.topSuggestion {
                SuggestionRow(suggestion: topSuggestion)
            }
        }
        .padding(.vertical, 4)
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
