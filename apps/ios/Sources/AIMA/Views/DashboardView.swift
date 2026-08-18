import AIMACore
import SwiftUI

/// The Dashboard tab — a trimmed-down `apps/macos/Sources/AIMA/Views/Dashboard/DashboardView.swift`: the same
/// `DashboardViewModel`, the same `.task(id: workspaceViewModel.activeWorkspaceId)` reload-on-switch pattern,
/// the same sections that matter for the Alpha Launch sprint's own end-to-end verification list (Daily Briefing,
/// Needs Attention/dismiss, Pending Approvals/accept-reject, Tasks Overview). "Get Started" and "Quick Access"
/// are dropped — both exist on macOS only to jump the sidebar to another section, which has no equivalent
/// without a sidebar; iOS reaches every screen directly via its own tab instead.
struct DashboardView: View {
    let container: DependencyContainer
    let workspaceViewModel: WorkspaceViewModel
    let authenticationManager: AuthenticationManager
    @State private var viewModel: DashboardViewModel

    init(container: DependencyContainer, workspaceViewModel: WorkspaceViewModel, authenticationManager: AuthenticationManager) {
        self.container = container
        self.workspaceViewModel = workspaceViewModel
        self.authenticationManager = authenticationManager
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
                dailyBriefingSection
                needsAttentionSection
                recommendationsSection
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
            Button {
                Task { await viewModel.load(workspaceId: workspace.id) }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(viewModel.isLoading)
        }
    }

    @ViewBuilder
    private var currentUserSubheader: some View {
        if let user = authenticationManager.currentUser {
            Text("Signed in as \(user.displayName ?? user.email)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

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
                        taskCountColumn("Approvals", count: briefing.pendingApprovalCount)
                        taskCountColumn("Workflows", count: briefing.activeWorkflowCount)
                        taskCountColumn("Overdue", count: briefing.overdueTasks.count)
                    }

                    if !briefing.overdueTasks.isEmpty {
                        Text("Overdue").font(.subheadline).fontWeight(.medium).foregroundStyle(.red)
                        ForEach(briefing.overdueTasks) { task in
                            Text("• \(task.title)").font(.callout)
                        }
                    }

                    if !briefing.priorityTasks.isEmpty {
                        Text("Priority Tasks").font(.subheadline).fontWeight(.medium)
                        ForEach(briefing.priorityTasks) { task in
                            Text("• \(task.title)").font(.callout)
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
                }
            }
        }
    }

    /// Nudges (Proactive Nudges / Nudge Learning Loop sprints) — the end-to-end "nudge → Dismiss suppresses it"
    /// flow this sprint verifies lives here, reusing `SuggestionRow`'s `onDismiss`.
    @ViewBuilder
    private var needsAttentionSection: some View {
        if !viewModel.nudges.isEmpty {
            SectionCard(title: "Needs Attention") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.nudges) { nudge in
                        SuggestionRow(suggestion: nudge) {
                            guard let workspaceId = workspaceViewModel.activeWorkspaceId else { return }
                            Task { await viewModel.dismiss(nudge, workspaceId: workspaceId) }
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.red.opacity(0.3)))
        }
    }

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
        VStack(alignment: .leading, spacing: 6) {
            Text(approval.actionType).fontWeight(.medium)
            Text("Expires \(approval.expiresAt)")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
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
}

#Preview {
    NavigationStack {
        DashboardView(
            container: .preview,
            workspaceViewModel: DependencyContainer.preview.makeWorkspaceViewModel(),
            authenticationManager: AuthenticationManager(authClient: MockAuthClient(), apiClient: DependencyContainer.preview.apiClient)
        )
    }
}

/// A simple titled card, mirroring macOS's `DashboardView.SectionCard`.
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
