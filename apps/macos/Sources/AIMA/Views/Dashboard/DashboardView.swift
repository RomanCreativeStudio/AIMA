import AIMACore
import SwiftUI

/// The Dashboard screen (Phase 2.1, item 2): current workspace, system
/// status, pending approvals, and a task overview for the active
/// workspace. Reloads whenever `workspaceViewModel.activeWorkspaceId`
/// changes, without needing the whole view (and its `DashboardViewModel`)
/// to be torn down and rebuilt.
struct DashboardView: View {
    let container: DependencyContainer
    let workspaceViewModel: WorkspaceViewModel
    @State private var viewModel: DashboardViewModel

    init(container: DependencyContainer, workspaceViewModel: WorkspaceViewModel) {
        self.container = container
        self.workspaceViewModel = workspaceViewModel
        _viewModel = State(initialValue: container.makeDashboardViewModel())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                if let workspace = viewModel.workspace {
                    workspaceHeader(workspace)
                }

                systemStatusSection
                dailyBriefingSection
                productivityWidgetsSection
                insightCardsSection
                pendingApprovalsSection
                tasksOverviewSection
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Dashboard")
        .overlay {
            if viewModel.isLoading && viewModel.workspace == nil {
                ProgressView()
            }
        }
        .task(id: workspaceViewModel.activeWorkspaceId) {
            guard let workspaceId = workspaceViewModel.activeWorkspaceId else { return }
            await viewModel.load(workspaceId: workspaceId)
        }
    }

    private func workspaceHeader(_ workspace: Workspace) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(workspace.name)
                .font(.largeTitle)
                .fontWeight(.bold)
            Text(workspace.type.rawValue.capitalized)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var systemStatusSection: some View {
        SectionCard(title: "System Status") {
            if let health = viewModel.systemHealth {
                VStack(alignment: .leading, spacing: 6) {
                    statusRow("Overall", isHealthy: health.isHealthy)
                    statusRow("Database", isHealthy: health.checks.database.status == "ok")
                    statusRow("AI Provider", isHealthy: health.checks.aiProvider.status == "ok", detail: health.checks.aiProvider.detail)
                    statusRow("Memory", isHealthy: health.checks.memory.status == "ok")
                    statusRow("Knowledge", isHealthy: health.checks.knowledge.status == "ok")
                }
            } else {
                Text("No status yet.").foregroundStyle(.secondary)
            }
        }
    }

    private func statusRow(_ label: String, isHealthy: Bool, detail: String? = nil) -> some View {
        HStack {
            Circle()
                .fill(isHealthy ? Color.green : Color.red)
                .frame(width: 8, height: 8)
            Text(label)
            if let detail {
                Text("(\(detail))")
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .font(.callout)
    }

    private var pendingApprovalsSection: some View {
        SectionCard(title: "Pending Approvals (\(viewModel.pendingApprovals.count))") {
            if viewModel.pendingApprovals.isEmpty {
                Text("Nothing awaiting your approval.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.pendingApprovals) { approval in
                        approvalRow(approval)
                        if approval.id != viewModel.pendingApprovals.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private func approvalRow(_ approval: PendingApproval) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(approval.actionType).fontWeight(.medium)
                Text("Expires \(approval.expiresAt)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Approve") {
                guard let workspaceId = workspaceViewModel.activeWorkspaceId else { return }
                Task { await viewModel.approve(approval, workspaceId: workspaceId) }
            }
            Button("Reject", role: .destructive) {
                guard let workspaceId = workspaceViewModel.activeWorkspaceId else { return }
                Task { await viewModel.reject(approval, workspaceId: workspaceId) }
            }
        }
    }

    private var tasksOverviewSection: some View {
        let counts = viewModel.taskCounts
        return SectionCard(title: "Tasks Overview") {
            HStack(spacing: 24) {
                taskCountColumn("To Do", count: counts.todo)
                taskCountColumn("In Progress", count: counts.inProgress)
                taskCountColumn("Done", count: counts.done)
            }
        }
    }

    private func taskCountColumn(_ label: String, count: Int) -> some View {
        VStack {
            Text("\(count)")
                .font(.title)
                .fontWeight(.semibold)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    /// The Daily Briefing card (Phase 2.5, item 5) — a read-only snapshot,
    /// re-fetched every time this screen loads, never itself an action.
    @ViewBuilder
    private var dailyBriefingSection: some View {
        if let briefing = viewModel.dailyBriefing {
            SectionCard(title: "Daily Briefing") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 24) {
                        taskCountColumn("Pending Approvals", count: briefing.pendingApprovalCount)
                        taskCountColumn("Active Workflows", count: briefing.activeWorkflowCount)
                    }

                    if !briefing.priorityTasks.isEmpty {
                        Text("Priority Tasks").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.priorityTasks) { task in
                            Text("• \(task.title)").font(.callout)
                        }
                    }

                    if !briefing.recentActivity.isEmpty {
                        Text("Recent Activity").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.recentActivity) { entry in
                            Text("• \(entry.summary)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    /// Productivity Widgets (Phase 2.5, item 5) — Task Intelligence's due-soon/overdue counts, suggested
    /// priorities, and related-task groups. Deterministic on the backend, no AI involved.
    @ViewBuilder
    private var productivityWidgetsSection: some View {
        if let intelligence = viewModel.taskIntelligence {
            SectionCard(title: "Productivity") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 24) {
                        taskCountColumn("Due Soon", count: intelligence.dueSoon.count)
                        taskCountColumn("Overdue", count: intelligence.overdue.count)
                    }

                    if !intelligence.relatedGroups.isEmpty {
                        Text("Related Tasks").font(.subheadline).fontWeight(.medium)
                        ForEach(intelligence.relatedGroups) { group in
                            Text("• \(group.keyword.capitalized) (\(group.taskIds.count))")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    /// Insight Cards (Phase 2.5, item 5) — aggregate activity/workflow/approval/task-completion metrics.
    @ViewBuilder
    private var insightCardsSection: some View {
        if let insights = viewModel.workspaceInsights {
            SectionCard(title: "Workspace Insights") {
                VStack(alignment: .leading, spacing: 12) {
                    insightRow("Actions Logged", "\(insights.activityMetrics.totalActions) (\(insights.activityMetrics.failedActions) failed)")
                    insightRow("Workflow Runs", "\(insights.workflowMetrics.totalRuns) total, \(insights.workflowMetrics.activeRuns) active")
                    insightRow("Approvals", "\(insights.approvalMetrics.total) total, \(insights.approvalMetrics.pending) pending")
                    insightRow("Task Completion", "\(Int(insights.taskMetrics.completionRate * 100))% (\(insights.taskMetrics.done)/\(insights.taskMetrics.total))")
                }
            }
        }
    }

    private func insightRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
        .font(.callout)
    }
}

#Preview {
    NavigationStack {
        DashboardView(container: .preview, workspaceViewModel: DependencyContainer.preview.makeWorkspaceViewModel())
    }
}

/// A simple titled card, reused across every Dashboard section — this
/// screen doesn't need a heavier design system yet (Phase 2.1 is a
/// foundation, not the final visual design).
private struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
    }
}
