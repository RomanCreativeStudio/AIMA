import AIMACore
import SwiftUI

/// Which credential-entry flow a sheet is for — connect (first-time) or
/// rotate (replace existing credentials). Both collect the same fields,
/// just with a different verb and a different `IntegrationsViewModel` call.
struct ConnectSheetContext: Identifiable {
    enum Mode: String {
        case connect = "Connect"
        case rotate = "Rotate Credentials"
    }

    let integration: WorkspaceIntegration
    let mode: Mode

    var id: String { "\(integration.id):\(mode.rawValue)" }
}

/// A dynamic credential-entry form (Phase 2.3, item 5) — one secure field
/// per `WorkspaceIntegration.requiredCredentialFields`, so this sheet needs
/// no per-provider special-casing; a fourth connector added later needs no
/// change here, only a new `IntegrationDefinition` server-side.
struct CredentialEntrySheet: View {
    let context: ConnectSheetContext
    let onSubmit: ([String: String]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var fieldValues: [String: String] = [:]
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(context.integration.requiredCredentialFields, id: \.self) { field in
                        SecureField(field, text: fieldBinding(for: field))
                    }
                } header: {
                    Text("\(context.mode.rawValue) \(context.integration.displayName)")
                } footer: {
                    Text("Credentials are encrypted at rest and never displayed again after this step.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle(context.mode.rawValue)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(context.mode.rawValue) {
                        Task {
                            isSubmitting = true
                            await onSubmit(fieldValues)
                            isSubmitting = false
                            dismiss()
                        }
                    }
                    .disabled(isSubmitting || !allFieldsFilled)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 240)
    }

    private var allFieldsFilled: Bool {
        context.integration.requiredCredentialFields.allSatisfy {
            !(fieldValues[$0] ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    private func fieldBinding(for field: String) -> Binding<String> {
        Binding(
            get: { fieldValues[field] ?? "" },
            set: { fieldValues[field] = $0 }
        )
    }
}

#Preview {
    CredentialEntrySheet(
        context: ConnectSheetContext(
            integration: WorkspaceIntegration(
                workspaceId: "mock-ws-rcs", provider: .gmail, enabled: false, status: .disconnected,
                connectedAt: nil, lastValidatedAt: nil, createdAt: "", updatedAt: "",
                displayName: "Gmail", description: "Read-only access to Gmail messages.",
                capabilities: [], requiredCredentialFields: ["accessToken", "refreshToken"]
            ),
            mode: .connect
        ),
        onSubmit: { _ in }
    )
}
