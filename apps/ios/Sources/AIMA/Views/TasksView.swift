import AIMACore
import SwiftUI

/// The Tasks tab — a direct port of `apps/macos/Sources/AIMA/Views/Tasks/TasksView.swift` (`List`, the segmented
/// status-filter `Picker`, and `ContentUnavailableView` are all cross-platform SwiftUI; nothing here needed to
/// change for iOS). Verifies the sprint's "task appears in Tasks" flow — a task created in Chat (or on another
/// client) shows up here once loaded.
struct TasksView: View {
    let container: DependencyContainer
    @State private var viewModel: TasksViewModel

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeTasksViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(spacing: 0) {
            statusFilterPicker

            Divider()

            content
        }
        .navigationTitle("Tasks")
        .task {
            await viewModel.load()
        }
    }

    private var statusFilterPicker: some View {
        Picker("Status", selection: statusFilterBinding) {
            Text("All").tag(TaskStatus?.none)
            ForEach(TaskStatus.allCases) { status in
                Text(status.displayName).tag(TaskStatus?.some(status))
            }
        }
        .labelsHidden()
        .pickerStyle(.segmented)
        .padding(8)
    }

    private var statusFilterBinding: Binding<TaskStatus?> {
        Binding(
            get: { viewModel.statusFilter },
            set: { newValue in Task { await viewModel.setStatusFilter(newValue) } }
        )
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage = viewModel.errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .padding()
        }

        if viewModel.isLoading && viewModel.tasks.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.tasks.isEmpty {
            ContentUnavailableView(
                "No Tasks",
                systemImage: "checklist",
                description: Text("Nothing matches this filter.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(viewModel.tasks) { task in
                TaskRow(task: task)
            }
            .listStyle(.plain)
        }
    }
}

private struct TaskRow: View {
    let task: TaskItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            PriorityIndicator(priority: task.priority)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title).fontWeight(.medium)
                if let description = task.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Text(task.status.displayName)
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.quaternary.opacity(0.5), in: Capsule())
        }
        .padding(.vertical, 4)
    }
}

private struct PriorityIndicator: View {
    let priority: TaskPriority

    private var color: Color {
        switch priority {
        case .high: return .red
        case .medium: return .orange
        case .low: return .secondary
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
    }
}

#Preview {
    NavigationStack {
        TasksView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
