import AIMACore
import SwiftUI

/// The top-level screens: Dashboard and Chat (Phase 2.1, item 2), Tasks and
/// Approvals (Phase 2.2, items 3–4), Integrations (Phase 2.3, item 5),
/// Workspace and Settings (Phase 2.1).
enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case chat = "Chat"
    case tasks = "Tasks"
    case approvals = "Approvals"
    case integrations = "Integrations"
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
    @State private var selectedSection: AppSection? = .dashboard
    @State private var workspaceViewModel: WorkspaceViewModel

    init(container: DependencyContainer) {
        self.container = container
        _workspaceViewModel = State(initialValue: container.makeWorkspaceViewModel())
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
            await workspaceViewModel.load()
        }
    }

    @ViewBuilder
    private var detailView: some View {
        switch selectedSection {
        case .dashboard:
            DashboardView(container: container, workspaceViewModel: workspaceViewModel)
        case .chat:
            workspaceScopedView { ChatView(container: container, workspaceId: $0) }
        case .tasks:
            workspaceScopedView { TasksView(container: container, workspaceId: $0) }
        case .approvals:
            workspaceScopedView { ApprovalsView(container: container, workspaceId: $0) }
        case .integrations:
            workspaceScopedView { IntegrationsView(container: container, workspaceId: $0) }
        case .workspace:
            WorkspaceSwitcherView(viewModel: workspaceViewModel)
        case .settings:
            SettingsView(container: container)
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
    RootNavigationView(container: .preview)
}
