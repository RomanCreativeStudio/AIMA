import AIMACore
import SwiftUI

/// The Feedback screen (Beta Tester Infrastructure sprint): submit a bug report/feature request/general note
/// and see this workspace's prior submissions. Workspace-scoped like Memory/Tasks/Search — every submission
/// is an explicit user action, nothing collected in the background.
struct FeedbackView: View {
    let container: DependencyContainer
    @State private var viewModel: FeedbackViewModel
    @State private var type: FeedbackType = .general
    @State private var message = ""

    init(container: DependencyContainer, workspaceId: String) {
        self.container = container
        _viewModel = State(initialValue: container.makeFeedbackViewModel(workspaceId: workspaceId))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            form

            Divider()

            submissionsList
        }
        .navigationTitle("Feedback")
        .task {
            await viewModel.load()
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Share a bug, a feature idea, or general feedback — it goes straight to the AIMA team.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Picker("Type", selection: $type) {
                ForEach(FeedbackType.allCases) { type in
                    Text(type.displayName).tag(type)
                }
            }
            .pickerStyle(.segmented)

            TextEditor(text: $message)
                .frame(minHeight: 80, maxHeight: 140)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.separator))

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.callout)
            }

            HStack {
                Spacer()
                Button(viewModel.isSubmitting ? "Submitting…" : "Submit") {
                    Task {
                        if await viewModel.submit(type: type, message: message) {
                            message = ""
                            type = .general
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isSubmitting || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding()
    }

    @ViewBuilder
    private var submissionsList: some View {
        if viewModel.isLoading && viewModel.submissions.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.submissions.isEmpty {
            ContentUnavailableView(
                "No Feedback Yet",
                systemImage: "bubble.left.and.exclamationmark.bubble.right",
                description: Text("Submissions from this workspace will show up here.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(viewModel.submissions) { submission in
                VStack(alignment: .leading, spacing: 4) {
                    Text(submission.type.displayName).font(.caption).foregroundStyle(.secondary)
                    Text(submission.message)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        FeedbackView(container: .preview, workspaceId: "mock-ws-rcs")
    }
}
