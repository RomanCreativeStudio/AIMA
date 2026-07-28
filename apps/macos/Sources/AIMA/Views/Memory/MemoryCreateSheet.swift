import AIMACore
import SwiftUI

/// Creates a new memory (Phase 3.4, item 7) — the explicit, user-initiated counterpart to the advisory
/// `memorySuggestions` a chat turn may surface; nothing is saved until this form's "Create" is tapped.
struct MemoryCreateSheet: View {
    let onCreate: (CreateMemoryRequest) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var scope: MemoryScope = .workspace
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Content") {
                    TextEditor(text: $content)
                        .frame(minHeight: 100)
                }

                Section("Scope") {
                    Picker("Scope", selection: $scope) {
                        Text("User").tag(MemoryScope.user)
                        Text("Workspace").tag(MemoryScope.workspace)
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Memory")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            isSaving = true
                            await onCreate(CreateMemoryRequest(scope: scope, content: content))
                            isSaving = false
                            dismiss()
                        }
                    }
                    .disabled(isSaving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 280)
    }
}

#Preview {
    MemoryCreateSheet(onCreate: { _ in })
}
