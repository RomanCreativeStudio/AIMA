import AIMACore
import SwiftUI

/// A freeform key/value input form for starting a workflow run (Phase 2.4,
/// item 5). `WorkflowDefinition` carries no declared input-field list (the
/// backend's `WorkflowRunInput` is an open `Record<string,string>`, unlike
/// `WorkspaceIntegration.requiredCredentialFields`), so this form lets the
/// user supply whatever key/value pairs a workflow's handler happens to
/// read (e.g. `topic`, `title`, `repository`) rather than hardcoding
/// per-workflow field lists here.
struct NewWorkflowRunSheet: View {
    let definition: WorkflowDefinition
    let onSubmit: ([String: String]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [InputRow] = [InputRow()]
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach($rows) { $row in
                        HStack {
                            TextField("Key", text: $row.key)
                            TextField("Value", text: $row.value)
                        }
                    }
                    .onDelete { rows.remove(atOffsets: $0) }

                    Button("Add Field") {
                        rows.append(InputRow())
                    }
                } header: {
                    Text("Start \(definition.displayName)")
                } footer: {
                    Text(definition.description)
                }

                Section("Steps") {
                    ForEach(definition.steps) { step in
                        HStack {
                            Text(step.displayName)
                            Spacer()
                            if let capability = step.capability {
                                Text(capability)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Run")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        Task {
                            isSubmitting = true
                            await onSubmit(inputDictionary)
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

    private var inputDictionary: [String: String] {
        var result: [String: String] = [:]
        for row in rows {
            let key = row.key.trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            result[key] = row.value
        }
        return result
    }
}

private struct InputRow: Identifiable {
    let id = UUID()
    var key: String = ""
    var value: String = ""
}

#Preview {
    NewWorkflowRunSheet(
        definition: WorkflowDefinition(
            key: .draftEmailReply, displayName: "Draft Email Reply",
            description: "Compose a reply and save it to the local draft queue for review.",
            steps: [
                WorkflowStepDefinition(key: "compose_reply", displayName: "Compose reply", capability: nil),
                WorkflowStepDefinition(key: "save_draft", displayName: "Save as email draft", capability: "draft_email"),
            ],
            triggerPhrases: ["draft a reply"]
        ),
        onSubmit: { _ in }
    )
}
