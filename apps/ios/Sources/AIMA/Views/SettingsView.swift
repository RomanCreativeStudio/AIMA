import AIMACore
import SwiftUI

/// The Settings tab — the screen this sprint's networking requirement runs through: entering the Mac's LAN
/// address here (e.g. `http://192.168.1.42:4000`) is how a physical iPhone points itself at a local backend.
/// Applying a URL hands it to `DependencyContainer.updateBackendURL`, which now also persists it via
/// `APIConfiguration.save` (Alpha Launch sprint) so it survives relaunch — without that fix, a phone would lose
/// the address every time the app restarted. A direct port of
/// `apps/macos/Sources/AIMA/Views/Settings/SettingsView.swift` (`Form`/`.formStyle(.grouped)` are both
/// cross-platform SwiftUI).
struct SettingsView: View {
    let container: DependencyContainer
    let authenticationManager: AuthenticationManager
    @State private var viewModel: SettingsViewModel
    @State private var displayNameDraft: String = ""
    @State private var communicationStyleDraft: String = ""
    @State private var isSigningOut = false

    init(container: DependencyContainer, authenticationManager: AuthenticationManager) {
        self.container = container
        self.authenticationManager = authenticationManager
        _viewModel = State(initialValue: container.makeSettingsViewModel())
    }

    var body: some View {
        Form {
            Section("Backend Connection") {
                TextField("Backend URL", text: $viewModel.backendBaseURLText)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("Apply") {
                    viewModel.applyBackendURL()
                }
                Text("Point this at your Mac's LAN address (e.g. http://192.168.1.42:4000) to connect over Wi-Fi.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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

            Section("Account") {
                if let user = authenticationManager.currentUser {
                    LabeledContent("Signed in as", value: user.email)
                }
                Button("Sign Out", role: .destructive) {
                    Task {
                        isSigningOut = true
                        await authenticationManager.signOut()
                        isSigningOut = false
                    }
                }
                .disabled(isSigningOut)
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
    NavigationStack {
        SettingsView(
            container: .preview,
            authenticationManager: AuthenticationManager(authClient: MockAuthClient(), apiClient: DependencyContainer.preview.apiClient)
        )
    }
}
