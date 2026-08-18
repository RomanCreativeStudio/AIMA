import AIMACore
import SwiftUI

/// The app's navigation architecture — iOS's counterpart to macOS's `NavigationSplitView` sidebar
/// (`RootNavigationView`), using `TabView` instead since a sidebar doesn't fit a phone-sized screen. Owns the
/// single `WorkspaceViewModel` shared by every tab, exactly like `RootNavigationView` does, seeded the same way
/// from `authenticationManager.workspaces`/`.activeWorkspaceId` to avoid a redundant fetch right after sign-in.
///
/// Six tabs, chosen to map directly onto the Alpha Launch sprint's own end-to-end verification list: Dashboard
/// (briefing/nudges/approvals), Chat (create a task via AI, accept suggestions), Tasks, Memory, Workspace
/// (switch + cross-workspace digest), Settings (backend URL — required for iPhone → Mac over LAN). Approvals,
/// Integrations, Workflows, Executions, Search, Feedback, Admin, and Voice (explicitly Beta per the sprint's own
/// rules) are known, documented v1 gaps — see `apps/ios/README.md` — not lost functionality: Dashboard's own
/// "Pending Approvals" section still lets a user approve/reject without a dedicated Approvals tab.
struct RootTabView: View {
    let container: DependencyContainer
    let authenticationManager: AuthenticationManager
    @State private var workspaceViewModel: WorkspaceViewModel

    init(container: DependencyContainer, authenticationManager: AuthenticationManager) {
        self.container = container
        self.authenticationManager = authenticationManager
        let workspaceViewModel = container.makeWorkspaceViewModel()
        workspaceViewModel.seed(workspaces: authenticationManager.workspaces, activeWorkspaceId: authenticationManager.activeWorkspaceId)
        _workspaceViewModel = State(initialValue: workspaceViewModel)
    }

    var body: some View {
        TabView {
            NavigationStack {
                DashboardView(container: container, workspaceViewModel: workspaceViewModel, authenticationManager: authenticationManager)
            }
            .tabItem { Label("Dashboard", systemImage: "square.grid.2x2") }

            NavigationStack {
                workspaceScopedView { ChatView(container: container, workspaceId: $0) }
            }
            .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }

            NavigationStack {
                workspaceScopedView { TasksView(container: container, workspaceId: $0) }
            }
            .tabItem { Label("Tasks", systemImage: "checklist") }

            NavigationStack {
                workspaceScopedView { MemoryView(container: container, workspaceId: $0) }
            }
            .tabItem { Label("Memory", systemImage: "brain") }

            NavigationStack {
                WorkspaceView(viewModel: workspaceViewModel)
            }
            .tabItem { Label("Workspace", systemImage: "square.stack.3d.up") }

            NavigationStack {
                SettingsView(container: container, authenticationManager: authenticationManager)
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .task {
            // A fallback, not the normal path: `init` already seeded this from `authenticationManager`, so
            // `workspaces` is only empty here if that seed genuinely had nothing.
            if workspaceViewModel.workspaces.isEmpty {
                await workspaceViewModel.load()
            }
        }
    }

    /// Every tab scoped to "the active workspace" needs the same three states — a real workspace, still loading,
    /// or none selected — mirroring `RootNavigationView.workspaceScopedView` exactly.
    @ViewBuilder
    private func workspaceScopedView<Content: View>(@ViewBuilder content: (String) -> Content) -> some View {
        if let workspaceId = workspaceViewModel.activeWorkspaceId {
            content(workspaceId).id(workspaceId)
        } else if workspaceViewModel.isLoading {
            ProgressView("Loading workspaces…")
        } else if workspaceViewModel.workspaces.isEmpty {
            ContentUnavailableView(
                "No Workspace Yet",
                systemImage: "square.stack.3d.up.slash",
                description: Text("This account has no workspace set up yet. Contact your AIMA administrator to get one created.")
            )
        } else {
            ContentUnavailableView(
                "No Workspace Selected",
                systemImage: "exclamationmark.triangle",
                description: Text("Pick a workspace from the Workspace tab first.")
            )
        }
    }
}

#Preview {
    RootTabView(
        container: .preview,
        authenticationManager: AuthenticationManager(authClient: MockAuthClient(), apiClient: DependencyContainer.preview.apiClient)
    )
}
