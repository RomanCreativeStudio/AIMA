import AIMACore
import SwiftUI

/// The confirmation dialog for an `ExecutionPreview` (Phase 2.6, item 8) —
/// shown after `NewExecutionSheet` requests a preview, before anything is
/// persisted. Confirming calls `ExecutionsViewModel.confirmPendingPreview`,
/// which creates the actual execution request (never runs it); cancelling
/// discards the preview entirely — nothing was ever created either way.
struct ExecutionConfirmationSheet: View {
    let preview: ExecutionPreview
    let onConfirm: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Action") {
                    LabeledContent("Type", value: preview.actionType.replacingOccurrences(of: "_", with: " ").capitalized)
                    LabeledContent("Provider", value: preview.provider.rawValue.capitalized)
                    LabeledContent("Tier", value: preview.tier)
                }

                Section("Payload") {
                    if preview.payload.isEmpty {
                        Text("No payload fields.").foregroundStyle(.secondary)
                    } else {
                        Text(JSONValue.object(preview.payload).displayString)
                            .font(.system(.callout, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }

                Section {
                    Label(
                        preview.integrationConnected
                            ? "Integration connected."
                            : "No connected \(preview.provider.rawValue.capitalized) integration — this will be rejected.",
                        systemImage: preview.integrationConnected ? "checkmark.circle.fill" : "xmark.octagon.fill"
                    )
                    .foregroundStyle(preview.integrationConnected ? .green : .red)

                    if preview.requiresApproval {
                        Label("This action requires your approval before it runs.", systemImage: "hand.raised.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Confirm Execution")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Confirm") {
                        onConfirm()
                        dismiss()
                    }
                    .disabled(!preview.integrationConnected)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 360)
    }
}

#Preview {
    ExecutionConfirmationSheet(
        preview: ExecutionPreview(
            actionType: "send_email", provider: .gmail, tier: "execute_with_approval",
            requiresApproval: true, integrationConnected: true,
            payload: ["to": .string("client@example.com"), "subject": .string("Hello")]
        ),
        onConfirm: {}, onCancel: {}
    )
}
