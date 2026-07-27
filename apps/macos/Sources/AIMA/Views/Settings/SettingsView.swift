import AIMACore
import SwiftUI

/// The Settings screen (Phase 2.1, item 2): backend connection, user
/// preferences, configuration. Applying a new backend URL hands it to the
/// `DependencyContainer` (via `onBackendURLChange`) rather than mutating
/// anything here directly — rebuilding the `APIClient` is a
/// dependency-injection concern owned by the container.
struct SettingsView: View {
    let container: DependencyContainer
    @State private var viewModel: SettingsViewModel
    @State private var displayNameDraft: String = ""
    @State private var communicationStyleDraft: String = ""

    init(container: DependencyContainer) {
        self.container = container
        _viewModel = State(initialValue: container.makeSettingsViewModel())
    }

    var body: some View {
        Form {
            Section("Backend Connection") {
                TextField("Backend URL", text: $viewModel.backendBaseURLText)
                    .textFieldStyle(.roundedBorder)
                Button("Apply") {
                    viewModel.applyBackendURL()
                }
            }

            Section("User Preferences") {
                TextField("Display Name", text: $displayNameDraft)
                TextField("Communication Style", text: $communicationStyleDraft)
                Button("Save") {
                    Task {
                        await viewModel.saveProfile(displayName: displayNameDraft, communicationStyle: communicationStyleDraft)
                    }
                }
                .disabled(viewModel.isSaving)
            }

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            if let confirmation = viewModel.saveConfirmation {
                Text(confirmation).foregroundStyle(.green)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            }
        }
        .task {
            viewModel.onBackendURLChange = { url in container.updateBackendURL(url) }
            await viewModel.load()
            displayNameDraft = viewModel.user?.displayName ?? ""
            communicationStyleDraft = viewModel.user?.communicationStyle ?? ""
        }
    }
}

#Preview {
    SettingsView(container: .preview)
}
