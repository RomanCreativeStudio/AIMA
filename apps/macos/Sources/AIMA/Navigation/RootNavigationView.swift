import AIMACore
import SwiftUI

/// The four top-level screens (Phase 2.1, item 2): Dashboard, Chat,
/// Workspace, Settings.
enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case chat = "Chat"
    case workspace = "Workspace"
    case settings = "Settings"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .workspace: return "square.stack.3d.up"
        case .settings: return "gearshape"
        }
    }
}

/// The app's navigation architecture (Phase 2.1, item 1): a
/// `NavigationSplitView` sidebar switching between the four main screens.
/// Owns the single `WorkspaceViewModel` shared by every screen that needs
/// to know which workspace is active — Dashboard and Chat both read it
/// (via plain, unwrapped properties; `@Observable` tracks property access
/// on read, no `@ObservedObject`-style wrapper needed), and the Workspace
/// screen is the one place that changes it.
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
            if let workspaceId = workspaceViewModel.activeWorkspaceId {
                ChatView(container: container, workspaceId: workspaceId)
                    .id(workspaceId) // a workspace switch means a fresh conversation list/history, not a patched-up one.
            } else if workspaceViewModel.isLoading {
                ProgressView("Loading workspaces…")
            } else {
                ContentUnavailableView(
                    "No Workspace Selected",
                    systemImage: "exclamationmark.triangle",
                    description: Text("Pick a workspace from the Workspace tab first.")
                )
            }
        case .workspace:
            WorkspaceSwitcherView(viewModel: workspaceViewModel)
        case .settings:
            SettingsView(container: container)
        case .none:
            ContentUnavailableView("Select a Section", systemImage: "sidebar.left")
        }
    }
}

#Preview {
    RootNavigationView(container: .preview)
}
