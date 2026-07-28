import AIMACore
import SwiftUI

/// Edits a single memory's content, importance, and confidence (Phase 3.4, item 7). A user-initiated form, not
/// an auto-save field — nothing is sent until "Save" is tapped, matching "user controlled, no hidden storage".
struct MemoryEditSheet: View {
    let memory: MemoryRecord
    let onSave: (UpdateMemoryRequest) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var content: String
    @State private var importance: Double
    @State private var confidence: Double
    @State private var isSaving = false

    init(memory: MemoryRecord, onSave: @escaping (UpdateMemoryRequest) async -> Void) {
        self.memory = memory
        self.onSave = onSave
        _content = State(initialValue: memory.content)
        _importance = State(initialValue: memory.importanceScore ?? 0.5)
        _confidence = State(initialValue: memory.confidenceScore ?? 1.0)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Content") {
                    TextEditor(text: $content)
                        .frame(minHeight: 100)
                }

                Section("Scoring") {
                    LabeledContent("Importance: \(Int(importance * 100))%") {
                        Slider(value: $importance, in: 0...1)
                    }
                    LabeledContent("Confidence: \(Int(confidence * 100))%") {
                        Slider(value: $confidence, in: 0...1)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Edit Memory")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            isSaving = true
                            await onSave(
                                UpdateMemoryRequest(
                                    content: content == memory.content ? nil : content,
                                    importanceScore: importance,
                                    confidenceScore: confidence
                                )
                            )
                            isSaving = false
                            dismiss()
                        }
                    }
                    .disabled(isSaving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 320)
    }
}

#Preview {
    MemoryEditSheet(
        memory: MemoryRecord(
            id: "mock-memory-1", workspaceId: "mock-ws-rcs", scope: .workspace,
            content: "Acme's project timeline was pushed back two weeks last quarter.",
            source: nil, conversationId: nil, projectKey: nil, metadata: [:],
            createdAt: "2026-01-01T00:00:00.000Z", importanceScore: 0.8, confidenceScore: 0.9
        ),
        onSave: { _ in }
    )
}
