import AIMACore
import SwiftUI

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

    init(container: DependencyContainer) {
        self.container = container
        _viewModel = State(initialValue: container.makeAdminViewModel())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }

                betaUsersSection
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
        }
    }

    private var betaUsersSection: some View {
        SectionCard(title: "Beta Users (\(viewModel.betaUsers.count))") {
            if viewModel.betaUsers.isEmpty {
                Text("No accounts are marked as beta testers yet.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
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
        }
    }

    private func usageStat(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(value)").font(.callout).fontWeight(.semibold)
            Text(label).font(.caption2).foregroundStyle(.secondary)
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
