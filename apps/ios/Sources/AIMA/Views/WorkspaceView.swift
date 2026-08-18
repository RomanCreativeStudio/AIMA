import AIMACore
import SwiftUI

/// The Workspace tab — switch between workspaces and see the cross-workspace digest. Verifies the sprint's
/// "cross-workspace digest works" and "workspace/user isolation remains intact" flows (switching only changes
/// which workspace *this app* is pointed at; the backend independently validates every request's `workspaceId`,
/// same as `WorkspaceViewModel`'s own doc comment states). A direct port of
/// `apps/macos/Sources/AIMA/Views/Workspace/WorkspaceSwitcherView.swift`, minus the reindex-embeddings action
/// (a maintenance operation out of scope for this sprint's minimal iOS surface).
struct WorkspaceView: View {
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
                .foregroundStyle(.primary)
            }

            if !viewModel.workspaces.isEmpty {
                digestSection
            }
        }
        .navigationTitle("Workspace")
        .overlay {
            if viewModel.isLoading && viewModel.workspaces.isEmpty {
                ProgressView()
            } else if viewModel.workspaces.isEmpty {
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
        .task {
            await viewModel.loadDigest()
        }
    }

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
                    Label("\(entry.nudgeCount)", systemImage: "bell.badge.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            Text(entry.greeting)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                if entry.pendingApprovalCount > 0 {
                    Label("\(entry.pendingApprovalCount)", systemImage: "checkmark.seal")
                }
                if entry.overdueTaskCount > 0 {
                    Label("\(entry.overdueTaskCount)", systemImage: "clock.badge.exclamationmark")
                }
                if entry.blockedItemCount > 0 {
                    Label("\(entry.blockedItemCount)", systemImage: "hand.raised")
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
}

#Preview {
    NavigationStack {
        WorkspaceView(viewModel: DependencyContainer.preview.makeWorkspaceViewModel())
    }
}
