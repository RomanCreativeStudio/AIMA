import AIMACore
import SwiftUI

/// The first step of starting an execution (Phase 2.6, item 8: "Execution
/// Preview"). Unlike `NewWorkflowRunSheet`'s freeform workflow key, the four
/// built-in execution action types are fixed — `ExecutionsViewModel` and
/// `MockAPIClient` only recognize these — so this picks one from a closed
/// list. Submitting only requests a preview; nothing is created until the
/// confirmation dialog (`ExecutionConfirmationSheet`) is accepted.
struct NewExecutionSheet: View {
    let onSubmit: (String, [String: JSONValue]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var actionType: String = NewExecutionSheet.actionTypes[0].value
    @State private var rows: [PayloadRow] = [PayloadRow()]
    @State private var isSubmitting = false

    private static let actionTypes: [(label: String, value: String)] = [
        ("Send Email (Gmail)", "send_email"),
        ("Save Draft (Gmail)", "draft_gmail_email"),
        ("Create Issue (GitHub)", "create_github_issue"),
        ("Create Pull Request (GitHub)", "create_github_pull_request"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Action") {
                    Picker("Action Type", selection: $actionType) {
                        ForEach(Self.actionTypes, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                }

                Section {
                    ForEach($rows) { $row in
                        HStack {
                            TextField("Key", text: $row.key)
                            TextField("Value", text: $row.value)
                        }
                    }
                    .onDelete { rows.remove(atOffsets: $0) }

                    Button("Add Field") {
                        rows.append(PayloadRow())
                    }
                } header: {
                    Text("Payload")
                } footer: {
                    Text("The next step previews the tier, required approval, and connected-integration status before anything is created.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Execution")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Preview") {
                        Task {
                            isSubmitting = true
                            await onSubmit(actionType, payloadDictionary)
                            isSubmitting = false
                            dismiss()
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 320)
    }

    private var payloadDictionary: [String: JSONValue] {
        var result: [String: JSONValue] = [:]
        for row in rows {
            let key = row.key.trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            result[key] = .string(row.value)
        }
        return result
    }
}

private struct PayloadRow: Identifiable {
    let id = UUID()
    var key: String = ""
    var value: String = ""
}

#Preview {
    NewExecutionSheet(onSubmit: { _, _ in })
}
