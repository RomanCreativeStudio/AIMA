import AIMACore
import SwiftUI

/// The top-level screens: Dashboard and Chat (Phase 2.1, item 2), Tasks and
/// Approvals (Phase 2.2, items 3–4), Integrations (Phase 2.3, item 5),
/// Workflows (Phase 2.4, item 5), Executions (Phase 2.6, item 8), Voice
/// (Phase 3.2, item 4), Memory (Phase 3.4, item 7), Workspace and Settings
/// (Phase 2.1).
enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case chat = "Chat"
    case tasks = "Tasks"
    case approvals = "Approvals"
    case integrations = "Integrations"
    case workflows = "Workflows"
    case executions = "Executions"
    case voice = "Voice"
    case memory = "Memory"
    case search = "Search"
    case feedback = "Feedback"
    case workspace = "Workspace"
    case settings = "Settings"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .tasks: return "checklist"
        case .approvals: return "checkmark.seal"
        case .integrations: return "puzzlepiece.extension"
        case .workflows: return "flowchart"
        case .executions: return "bolt.fill"
        case .voice: return "mic.fill"
        case .memory: return "brain"
        case .search: return "magnifyingglass"
        case .feedback: return "bubble.left.and.exclamationmark.bubble.right"
        case .workspace: return "square.stack.3d.up"
        case .settings: return "gearshape"
        }
    }
}

/// The app's navigation architecture (Phase 2.1, item 1): a
/// `NavigationSplitView` sidebar switching between the seven main screens.
/// Owns the single `WorkspaceViewModel` shared by every screen that needs
/// to know which workspace is active — Dashboard, Chat, Tasks, Approvals,
/// and Integrations all read it (via plain, unwrapped properties;
/// `@Observable` tracks property access on read, no `@ObservedObject`-style
/// wrapper needed), and the Workspace screen is the one place that changes it.
struct RootNavigationView: View {
    let container: DependencyContainer
    let authenticationManager: AuthenticationManager
    @State private var selectedSection: AppSection? = .dashboard
    @State private var workspaceViewModel: WorkspaceViewModel

    /// Seeds `workspaceViewModel` from `authenticationManager.workspaces`/`.activeWorkspaceId` — both already
    /// fetched as part of reaching `.authenticated` (macOS Auth Bootstrap sprint) — instead of letting `load()`
    /// make its own, redundant `listWorkspaces`/`getUser` call the instant this view appears.
    init(container: DependencyContainer, authenticationManager: AuthenticationManager) {
        self.container = container
        self.authenticationManager = authenticationManager
        let workspaceViewModel = container.makeWorkspaceViewModel()
        workspaceViewModel.seed(workspaces: authenticationManager.workspaces, activeWorkspaceId: authenticationManager.activeWorkspaceId)
        _workspaceViewModel = State(initialValue: workspaceViewModel)
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedSection) {
                ForEach(AppSection.allCases) { section in
                    Label(section.rawValue, systemImage: section.systemImage)
                        .tag(section)
                }
            }
            .navigationTitle("AIMA")
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } detail: {
            detailView
        }
        .task {
            // A fallback, not the normal path: `init` already seeded this from `authenticationManager` above,
            // so `workspaces` is only empty here if that seed genuinely had nothing (a preview, or a signed-in
            // user with no workspaces yet).
            if workspaceViewModel.workspaces.isEmpty {
                await workspaceViewModel.load()
            }
        }
    }

    @ViewBuilder
    private var detailView: some View {
        switch selectedSection {
        case .dashboard:
            DashboardView(
                container: container,
                workspaceViewModel: workspaceViewModel,
                authenticationManager: authenticationManager,
                onSelectSection: { selectedSection = $0 }
            )
        case .chat:
            workspaceScopedView { ChatView(container: container, workspaceId: $0) }
        case .tasks:
            workspaceScopedView { TasksView(container: container, workspaceId: $0) }
        case .approvals:
            workspaceScopedView { ApprovalsView(container: container, workspaceId: $0) }
        case .integrations:
            workspaceScopedView { IntegrationsView(container: container, workspaceId: $0) }
        case .workflows:
            workspaceScopedView { WorkflowsView(container: container, workspaceId: $0) }
        case .executions:
            workspaceScopedView { ExecutionsView(container: container, workspaceId: $0) }
        case .voice:
            workspaceScopedView { VoiceView(container: container, workspaceId: $0) }
        case .memory:
            workspaceScopedView { MemoryView(container: container, workspaceId: $0) }
        case .search:
            workspaceScopedView { SearchView(container: container, workspaceId: $0) }
        case .feedback:
            workspaceScopedView { FeedbackView(container: container, workspaceId: $0) }
        case .workspace:
            WorkspaceSwitcherView(viewModel: workspaceViewModel)
        case .settings:
            SettingsView(container: container, authenticationManager: authenticationManager)
        case .none:
            ContentUnavailableView("Select a Section", systemImage: "sidebar.left")
        }
    }

    /// Every screen scoped to "the active workspace" (Chat, Tasks,
    /// Approvals) needs the same three states — a real workspace, still
    /// loading, or none selected — and the same `.id(workspaceId)` reset so
    /// a workspace switch means a fresh screen, not a patched-up one.
    @ViewBuilder
    private func workspaceScopedView<Content: View>(@ViewBuilder content: (String) -> Content) -> some View {
        if let workspaceId = workspaceViewModel.activeWorkspaceId {
            content(workspaceId).id(workspaceId)
        } else if workspaceViewModel.isLoading {
            ProgressView("Loading workspaces…")
        } else if workspaceViewModel.workspaces.isEmpty {
            // Distinct from the "pick one" case below (Product Flow & Beta Readiness Audit) — telling a user
            // with zero workspaces to "pick one from the Workspace tab" sends them somewhere with nothing to
            // pick, which is worse than this screen's own empty state.
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
    RootNavigationView(
        container: .preview,
        authenticationManager: AuthenticationManager(authClient: MockAuthClient(), apiClient: DependencyContainer.preview.apiClient)
    )
}
