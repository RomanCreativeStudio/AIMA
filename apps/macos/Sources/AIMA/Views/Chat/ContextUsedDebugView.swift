import AIMACore
import SwiftUI

/// Debug-only developer aid (Context Assembly Engine sprint): shows how many memories/tasks/decisions were
/// actually injected into the most recent reply's system prompt (`ChatViewModel.lastContextMemoriesUsedCount`/
/// `lastContextTasksUsedCount`/`lastContextDecisionsUsedCount`) — transparency into the same context assembly
/// `ContextManager.gatherContext` performs server-side. Gated behind `#if DEBUG` rather than a new settings
/// toggle: no "developer settings" surface exists yet in this app, and Swift's built-in debug-build flag is an
/// existing mechanism, not a new one.
struct ContextUsedDebugView: View {
    let memoriesUsed: Int
    let tasksUsed: Int
    let decisionsUsed: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "wrench.and.screwdriver")
                .foregroundStyle(.secondary)
            Text("Context Used")
                .font(.caption)
                .fontWeight(.medium)
            Text("\(memoriesUsed) memories")
            Text("\(tasksUsed) tasks")
            Text("\(decisionsUsed) decisions")
            Spacer()
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.gray.opacity(0.1))
    }
}

#Preview {
    ContextUsedDebugView(memoriesUsed: 3, tasksUsed: 2, decisionsUsed: 1)
}
