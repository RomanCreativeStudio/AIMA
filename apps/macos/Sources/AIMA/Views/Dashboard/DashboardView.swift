import AIMACore
import SwiftUI

/// The Dashboard screen (Phase 2.1, item 2; extended in the macOS Dashboard
/// Shell sprint with a "who's signed in" header and Quick Access into the
/// other screens): current workspace, system status, pending approvals, and
/// a task overview for the active workspace. Reloads whenever
/// `workspaceViewModel.activeWorkspaceId` changes, without needing the whole
/// view (and its `DashboardViewModel`) to be torn down and rebuilt.
struct DashboardView: View {
    let container: DependencyContainer
    let workspaceViewModel: WorkspaceViewModel
    let authenticationManager: AuthenticationManager
    /// Lets Quick Access buttons switch `RootNavigationView`'s sidebar selection without this view owning (or
    /// even knowing the shape of) that navigation state itself.
    let onSelectSection: (AppSection) -> Void
    @State private var viewModel: DashboardViewModel

    init(
        container: DependencyContainer,
        workspaceViewModel: WorkspaceViewModel,
        authenticationManager: AuthenticationManager,
        onSelectSection: @escaping (AppSection) -> Void
    ) {
        self.container = container
        self.workspaceViewModel = workspaceViewModel
        self.authenticationManager = authenticationManager
        self.onSelectSection = onSelectSection
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
                currentUserSubheader

                getStartedSection
                quickAccessSection
                systemStatusSection
                dailyBriefingSection
                productivityWidgetsSection
                insightCardsSection
                recommendationsSection
                patternInsightsSection
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
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(workspace.name)
                    .font(.largeTitle)
                    .fontWeight(.bold)
                Text(workspace.type.rawValue.capitalized)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            // Alpha Daily Briefing sprint: `.task(id:)` already reloads on launch and on workspace switch; this
            // is the explicit re-fetch a user can trigger without switching workspaces and back.
            Button {
                Task { await viewModel.load(workspaceId: workspace.id) }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(viewModel.isLoading)
        }
    }

    /// "Signed in as" line (macOS Dashboard Shell sprint) — reads `authenticationManager.currentUser` directly
    /// rather than a separate fetch; this is the same `UserProfile` `AuthenticationManager` already loaded to
    /// reach `.authenticated` in the first place.
    @ViewBuilder
    private var currentUserSubheader: some View {
        if let user = authenticationManager.currentUser {
            Text("Signed in as \(user.displayName ?? user.email)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    /// Get Started (Beta Onboarding sprint) — guidance for a brand-new, still-empty workspace: reuses
    /// `viewModel.workspaceInsights` (already fetched for the Workspace Insights section below) as the signal
    /// for "empty," rather than adding new ViewModel logic. Disappears on its own the moment the workspace has
    /// any logged activity — no dismiss button or extra state to track.
    @ViewBuilder
    private var getStartedSection: some View {
        if let insights = viewModel.workspaceInsights, insights.activityMetrics.totalActions == 0 {
            SectionCard(title: "Get Started") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("This workspace doesn't have any activity yet. Here are a few ways to get going.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    VStack(spacing: 4) {
                        getStartedRow(
                            "Start a conversation", systemImage: "bubble.left.and.bubble.right", section: .chat,
                            detail: "Ask AIMA anything — it remembers context as you go."
                        )
                        getStartedRow(
                            "Add a memory", systemImage: "brain", section: .memory,
                            detail: "Tell AIMA something to remember for later."
                        )
                        getStartedRow(
                            "Connect an integration", systemImage: "puzzlepiece.extension", section: .integrations,
                            detail: "Link Gmail, GitHub, or Calendar so AIMA can help there too."
                        )
                    }
                }
            }
        }
    }

    private func getStartedRow(_ title: String, systemImage: String, section: AppSection, detail: String) -> some View {
        Button {
            onSelectSection(section)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.title3)
                    .foregroundStyle(.tint)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).fontWeight(.medium)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Quick Access (macOS Dashboard Shell sprint) — direct entry points into the screens this app already
    /// has (Conversations, Tasks, Workflows, Memory, Integrations, Approvals), each just a `selectedSection`
    /// change handed to `RootNavigationView` via `onSelectSection`. No new business logic: every one of these
    /// already exists as its own sidebar section with its own `*ViewModel`.
    private var quickAccessSection: some View {
        SectionCard(title: "Quick Access") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                quickAccessButton("Conversations", systemImage: "bubble.left.and.bubble.right", section: .chat)
                quickAccessButton("Tasks", systemImage: "checklist", section: .tasks)
                quickAccessButton("Workflows", systemImage: "flowchart", section: .workflows)
                quickAccessButton("Memory", systemImage: "brain", section: .memory)
                quickAccessButton("Integrations", systemImage: "puzzlepiece.extension", section: .integrations)
                quickAccessButton("Approvals", systemImage: "checkmark.seal", section: .approvals)
                quickAccessButton("Feedback", systemImage: "bubble.left.and.exclamationmark.bubble.right", section: .feedback)
            }
        }
    }

    private func quickAccessButton(_ title: String, systemImage: String, section: AppSection) -> some View {
        Button {
            onSelectSection(section)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: systemImage).font(.title2)
                Text(title).font(.callout)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
        .buttonStyle(.bordered)
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
                    statusRow("Integrations", isHealthy: health.checks.integrations.status == "ok", detail: health.checks.integrations.detail)
                    statusRow("Voice Providers", isHealthy: health.checks.voiceProviders.status == "ok", detail: health.checks.voiceProviders.detail)
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
                    if !briefing.greeting.isEmpty {
                        Text(briefing.greeting)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 24) {
                        taskCountColumn("Pending Approvals", count: briefing.pendingApprovalCount)
                        taskCountColumn("Active Workflows", count: briefing.activeWorkflowCount)
                        taskCountColumn("Overdue Tasks", count: briefing.overdueTasks.count)
                    }

                    if !briefing.overdueTasks.isEmpty {
                        Text("Overdue").font(.subheadline).fontWeight(.medium).foregroundStyle(.red)
                        ForEach(briefing.overdueTasks) { task in
                            Text("• \(task.title)").font(.callout)
                        }
                    }

                    if !briefing.integrationsNeedingAttention.isEmpty {
                        Text("Integrations Needing Attention").font(.subheadline).fontWeight(.medium).foregroundStyle(.orange)
                        ForEach(briefing.integrationsNeedingAttention) { integration in
                            Text("• \(integration.displayName)")
                                .font(.callout)
                        }
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

                    if !briefing.recentMemories.isEmpty {
                        Text("Recent Memories").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.recentMemories) { memory in
                            Text("• \(memory.content)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    if !briefing.openCommitments.isEmpty {
                        Text("Open Commitments").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.openCommitments) { commitment in
                            Text("• \(commitment.content)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    if !briefing.calendarHighlights.isEmpty {
                        Text("Calendar Highlights").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.calendarHighlights) { entry in
                            Text("• \(entry.summary)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !briefing.suggestedNextActions.isEmpty {
                        Text("Suggested Actions").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.suggestedNextActions) { suggestion in
                            SuggestionRow(suggestion: suggestion)
                        }
                    }
                }
            }
        }
    }

    /// The Recommendations section (Phase 3.5, item 8) — every advisory suggestion the Proactive Intelligence
    /// Engine currently has for this workspace, not just the capped subset in the Daily Briefing card above.
    /// Purely informational: nothing here is a button that creates, executes, or sends anything.
    @ViewBuilder
    private var recommendationsSection: some View {
        if !viewModel.suggestions.isEmpty {
            SectionCard(title: "Recommendations") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.suggestions) { suggestion in
                        SuggestionRow(suggestion: suggestion)
                    }
                }
            }
        }
    }

    /// Pattern Insights (Phase 3.5, item 8) — the raw, deterministically-detected patterns behind the
    /// recommendations above, for anyone who wants to see why something was suggested.
    @ViewBuilder
    private var patternInsightsSection: some View {
        if !viewModel.patterns.isEmpty {
            SectionCard(title: "Pattern Insights") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.patterns) { pattern in
                        HStack(alignment: .top) {
                            Text("• \(pattern.description)")
                                .font(.callout)
                            Spacer()
                            Text("\(Int(pattern.confidence * 100))%")
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
        DashboardView(
            container: .preview,
            workspaceViewModel: DependencyContainer.preview.makeWorkspaceViewModel(),
            authenticationManager: AuthenticationManager(authClient: MockAuthClient(), apiClient: DependencyContainer.preview.apiClient),
            onSelectSection: { _ in }
        )
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
