import AIMACore
import SwiftUI

/// The Integrations screen (Phase 2.3, item 5): connection status,
/// connect/disconnect/rotate, and capability display for the three fixed,
/// read-only connectors (Gmail, GitHub, Calendar).
struct IntegrationsView: View {
    let container: DependencyContainer
    @State private var viewModel: IntegrationsViewModel
    @State private var sheetContext: ConnectSheetContext?

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeIntegrationsViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let errorMessage = viewModel.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
                if let confirmation = viewModel.lastActionConfirmation {
                    Label(confirmation, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }

                ForEach(viewModel.integrations) { integration in
                    IntegrationCardView(
                        integration: integration,
                        onConnect: { sheetContext = ConnectSheetContext(integration: integration, mode: .connect) },
                        onRotate: { sheetContext = ConnectSheetContext(integration: integration, mode: .rotate) },
                        onDisconnect: { Task { await viewModel.disconnect(provider: integration.provider) } }
                    )
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Integrations")
        .overlay {
            if viewModel.isLoading && viewModel.integrations.isEmpty {
                ProgressView()
            } else if viewModel.integrations.isEmpty {
                ContentUnavailableView(
                    "No Integrations",
                    systemImage: "puzzlepiece.extension",
                    description: Text("Nothing to connect yet.")
                )
            }
        }
        .task {
            await viewModel.load()
        }
        .sheet(item: $sheetContext) { context in
            CredentialEntrySheet(context: context) { credentials in
                switch context.mode {
                case .connect:
                    await viewModel.connect(provider: context.integration.provider, credentials: credentials)
                case .rotate:
                    await viewModel.rotate(provider: context.integration.provider, credentials: credentials)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        IntegrationsView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
