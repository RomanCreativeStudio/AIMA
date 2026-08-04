import AIMACore
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/// The Internal Operator Dashboard (founder/admin screen): a Beta User Overview and a Feedback Dashboard,
/// both read straight from `APIClient.listBetaUsers`/`listAdminFeedback` — the backend is the sole
/// authority on who's allowed to see this (`requireAdmin`); this view has no client-side notion of "am I an
/// admin" and doesn't try to hide itself. A non-admin caller just sees this screen's existing error state
/// (403) instead of data — the same "let the API error surface" pattern every other screen already uses for
/// failures, not a special case. Account-scoped like Settings, not workspace-scoped — the whole point is
/// seeing across every workspace at once.
struct AdminView: View {
    let container: DependencyContainer
    @State private var viewModel: AdminViewModel
    /// Beta Invitations & Notifications sprint: its own view model, not folded into `AdminViewModel` — see
    /// `InvitationViewModel`'s doc comment.
    @State private var invitationViewModel: InvitationViewModel
    @State private var invitationEmailDraft: String = ""
    /// Feedback for the "Copy Link" button — clears itself after a moment via `copyInvitationLink`.
    @State private var copiedInvitationId: String?

    init(container: DependencyContainer) {
        self.container = container
        _viewModel = State(initialValue: container.makeAdminViewModel())
        _invitationViewModel = State(initialValue: container.makeInvitationViewModel())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                founderDashboardSection
                invitationsSection
                betaUsersSection
                manageUsersSection
                feedbackSection
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Admin")
        .overlay {
            if viewModel.isLoading && viewModel.betaUsers.isEmpty && viewModel.recentFeedback.isEmpty {
                ProgressView()
            }
        }
        .task {
            await viewModel.load()
            await viewModel.loadAllUsers()
            await invitationViewModel.refresh()
        }
    }

    /// Beta Invitations & Notifications sprint: send a new invite, see every invitation ever issued (newest
    /// first), and copy a shareable link for a pending one. Platform-wide like `betaUsersSection`/
    /// `manageUsersSection` — not scoped to any one workspace.
    private var invitationsSection: some View {
        SectionCard(title: "Invitations (\(invitationViewModel.invitations.count))") {
            VStack(alignment: .leading, spacing: 12) {
                if let errorMessage = invitationViewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.caption)
                }

                HStack {
                    TextField("Email address", text: $invitationEmailDraft)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { Task { await sendInvitation() } }
                    Button("Invite") { Task { await sendInvitation() } }
                        .disabled(invitationEmailDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Refresh") { Task { await invitationViewModel.refresh() } }
                }

                if invitationViewModel.invitations.isEmpty {
                    Text("No invitations sent yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(invitationViewModel.invitations) { invitation in
                        invitationRow(invitation)
                        if invitation.id != invitationViewModel.invitations.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
        .overlay {
            if invitationViewModel.isLoading && invitationViewModel.invitations.isEmpty {
                ProgressView()
            }
        }
    }

    private func invitationRow(_ invitation: Invitation) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(invitation.email).fontWeight(.medium)
                Text(invitation.createdAt).font(.caption).foregroundStyle(.secondary)
            }
            invitationStatusBadge(invitation.status)
            Spacer()
            Button(copiedInvitationId == invitation.id ? "Copied" : "Copy Link") {
                copyInvitationLink(for: invitation)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func invitationStatusBadge(_ status: InvitationStatus) -> some View {
        Text(status.rawValue.capitalized)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(invitationStatusColor(status).opacity(0.2), in: Capsule())
            .foregroundStyle(invitationStatusColor(status))
    }

    private func invitationStatusColor(_ status: InvitationStatus) -> Color {
        switch status {
        case .pending: return .orange
        case .accepted: return .green
        case .expired: return .secondary
        }
    }

    private func sendInvitation() async {
        let email = invitationEmailDraft.trimmingCharacters(in: .whitespaces)
        guard !email.isEmpty else { return }
        await invitationViewModel.createInvitation(email: email)
        if invitationViewModel.errorMessage == nil {
            invitationEmailDraft = ""
        }
    }

    /// The backend's `Invitation` has no token/link field of its own (only `email`/`invitedBy`/`status`/
    /// `createdAt`) — this constructs a shareable placeholder from the configured backend's own base URL and
    /// the invitation's id, rather than a hardcoded external domain.
    private func copyInvitationLink(for invitation: Invitation) {
        let link = "\(container.configuration.baseURL.absoluteString)/invite/\(invitation.id)"
        #if canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        #endif
        copiedInvitationId = invitation.id
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if copiedInvitationId == invitation.id {
                copiedInvitationId = nil
            }
        }
    }

    /// Founder Analytics Dashboard sprint: platform-wide totals as plain metric cards, above every other
    /// section — no charts yet, just the numbers `AdminService.getPlatformAnalytics` already computes.
    private var founderDashboardSection: some View {
        SectionCard(title: "Founder Dashboard") {
            if let analytics = viewModel.analytics {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12)], spacing: 12) {
                    metricCard("Users", analytics.totalUsers)
                    metricCard("Beta Users", analytics.betaUsers)
                    metricCard("24h Active", analytics.activeUsers24h)
                    metricCard("7d Active", analytics.activeUsers7d)
                    metricCard("Messages", analytics.totalMessages)
                    metricCard("Memories", analytics.totalMemories)
                    metricCard("Feedback", analytics.totalFeedback)
                    metricCard("Approvals", analytics.approvalsCreated)
                    metricCard("Executions", analytics.executionsCompleted)
                }
            } else if !viewModel.isLoading {
                Text("No analytics available yet.").foregroundStyle(.secondary)
            }
        }
    }

    /// Mirrors `SectionCard`'s own background/corner styling at a smaller scale — this screen's one design
    /// system, reused rather than a second one invented for metric cards.
    private func metricCard(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)").font(.title2).fontWeight(.bold)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
    }

    private var betaUsersSection: some View {
        SectionCard(title: "Beta Users (\(viewModel.betaUsers.count))") {
            VStack(alignment: .leading, spacing: 12) {
                searchField(placeholder: "Search beta users by email or name", text: $viewModel.betaUserQuery) {
                    Task { await viewModel.searchBetaUsers() }
                }

                if viewModel.betaUsers.isEmpty {
                    Text("No accounts are marked as beta testers yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.betaUsers) { user in
                        betaUserRow(user)
                        if user.id != viewModel.betaUsers.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private func searchField(placeholder: String, text: Binding<String>, onSubmit: @escaping () -> Void) -> some View {
        HStack {
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .onSubmit(onSubmit)
            Button("Search", action: onSubmit)
        }
    }

    private func betaUserRow(_ user: AdminBetaUserSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.displayName ?? user.email).fontWeight(.medium)
                    Text(user.email).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if let workspaceName = user.workspaceName {
                    Text(workspaceName).font(.caption).foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 16) {
                Label(user.signupDate, systemImage: "calendar")
                if let lastActiveAt = user.lastActiveAt {
                    Label(lastActiveAt, systemImage: "clock")
                }
                Label(user.onboardingCompleted ? "Onboarded" : "Not onboarded", systemImage: user.onboardingCompleted ? "checkmark.circle" : "circle")
                Label("\(user.feedbackCount) feedback", systemImage: "bubble.left.and.exclamationmark.bubble.right")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 16) {
                usageStat("Conversations", user.usage.conversationsCreated)
                usageStat("Messages", user.usage.messagesSent)
                usageStat("Memories", user.usage.memoriesCreated)
                usageStat("Integrations", user.usage.integrationsConnected)
                usageStat("Approvals", user.usage.approvalsUsed)
                usageStat("Executions", user.usage.executionsUsed)
            }

            if !user.adminTags.isEmpty || user.adminNotes != nil {
                adminAnnotations(notes: user.adminNotes, tags: user.adminTags)
            }
        }
    }

    private func adminAnnotations(notes: String?, tags: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if !tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.blue.opacity(0.15), in: Capsule())
                            .foregroundStyle(.blue)
                    }
                }
            }
            if let notes, !notes.isEmpty {
                Text(notes).font(.caption).foregroundStyle(.secondary).italic()
            }
        }
    }

    private func usageStat(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(value)").font(.callout).fontWeight(.semibold)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    /// Beta Tester Management sprint: every account (not just current beta testers) — the pool used to find
    /// a candidate and toggle them into (or out of) the beta, and to record invite notes/internal tags.
    private var manageUsersSection: some View {
        SectionCard(title: "Manage Users (\(viewModel.allUsers.count))") {
            VStack(alignment: .leading, spacing: 12) {
                searchField(placeholder: "Search all accounts by email or name", text: $viewModel.userQuery) {
                    Task { await viewModel.loadAllUsers() }
                }

                if viewModel.allUsers.isEmpty {
                    Text("No accounts found.").foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.allUsers) { user in
                        ManageUserRow(user: user, viewModel: viewModel)
                        if user.id != viewModel.allUsers.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private var feedbackSection: some View {
        SectionCard(title: "Recent Feedback (\(viewModel.recentFeedback.count))") {
            if viewModel.recentFeedback.isEmpty {
                Text("No feedback submitted yet.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.recentFeedback) { entry in
                        feedbackRow(entry)
                        if entry.id != viewModel.recentFeedback.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private func feedbackRow(_ entry: AdminFeedbackEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(entry.type.displayName).font(.caption).fontWeight(.medium)
                statusBadge(entry.status)
                Spacer()
                Text(entry.createdAt).font(.caption).foregroundStyle(.secondary)
            }
            Text(entry.message)
            HStack {
                Text("\(entry.userEmail) · \(entry.workspaceName)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                triageActions(entry)
            }
        }
    }

    private func statusBadge(_ status: FeedbackStatus) -> some View {
        Text(status.displayName)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(statusColor(status).opacity(0.2), in: Capsule())
            .foregroundStyle(statusColor(status))
    }

    private func statusColor(_ status: FeedbackStatus) -> Color {
        switch status {
        case .new: return .orange
        case .reviewed: return .blue
        case .resolved: return .green
        }
    }

    /// Review (new -> reviewed) and Resolve (reviewed -> resolved) buttons — each disabled unless the row is
    /// currently in the status it advances from, so an invalid transition can't even be tapped, mirroring the
    /// backend's `ALLOWED_STATUS_TRANSITIONS` rather than duplicating that rule client-side.
    private func triageActions(_ entry: AdminFeedbackEntry) -> some View {
        HStack(spacing: 8) {
            Button("Review") {
                Task { await viewModel.markReviewed(entry.id) }
            }
            .disabled(entry.status != .new)

            Button("Resolve") {
                Task { await viewModel.markResolved(entry.id) }
            }
            .disabled(entry.status != .reviewed)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

#Preview {
    NavigationStack {
        AdminView(container: .preview)
    }
}

/// One row in the "Manage Users" section: a beta-tester toggle plus editable invite notes/tags. Notes/tags
/// are drafted locally (`@State`) and only sent to the backend on "Save" — an explicit action, not saved as
/// the operator types, matching every other explicit-call pattern in this screen (search, review/resolve).
private struct ManageUserRow: View {
    let user: AdminUserSummary
    let viewModel: AdminViewModel

    @State private var notesDraft: String
    @State private var tagsDraft: String

    init(user: AdminUserSummary, viewModel: AdminViewModel) {
        self.user = user
        self.viewModel = viewModel
        _notesDraft = State(initialValue: user.adminNotes ?? "")
        _tagsDraft = State(initialValue: user.adminTags.joined(separator: ", "))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.displayName ?? user.email).fontWeight(.medium)
                    Text(user.email).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Toggle("Beta Tester", isOn: Binding(
                    get: { user.betaTester },
                    set: { newValue in Task { await viewModel.updateUser(user.userId, betaTester: newValue) } }
                ))
                .toggleStyle(.switch)
            }

            HStack {
                TextField("Invite notes", text: $notesDraft)
                    .textFieldStyle(.roundedBorder)
                TextField("Tags (comma-separated)", text: $tagsDraft)
                    .textFieldStyle(.roundedBorder)
                Button("Save") {
                    let tags = tagsDraft.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                    Task { await viewModel.updateUser(user.userId, adminNotes: notesDraft, adminTags: tags) }
                }
            }
            .font(.caption)
        }
    }
}

/// Mirrors `DashboardView`'s private `SectionCard` — this screen doesn't warrant its own design system either.
private struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
    }
}
