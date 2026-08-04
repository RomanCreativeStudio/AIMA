import AIMACore
import SwiftUI

/// The first-run welcome screen (Beta Onboarding sprint): shown once, between `LoginView` and
/// `RootNavigationView`, for any authenticated session where `AuthenticationManager.hasCompletedOnboarding`
/// is still `false`. Explains what AIMA does and its five core capabilities before handing the user to the
/// real app. Contains no state of its own beyond "is the completion call in flight" — completion itself is
/// `AuthenticationManager.completeOnboarding()`, the same `preferences` round-trip every other profile update
/// in this app already uses, not a new state manager.
struct OnboardingView: View {
    let manager: AuthenticationManager
    @State private var isCompleting = false

    private let capabilities: [(systemImage: String, title: String, detail: String)] = [
        ("brain", "Remember information", "AIMA keeps track of what you tell it, so you don't repeat yourself."),
        ("bubble.left.and.bubble.right", "Understand conversations", "It follows context across a conversation, not just one message at a time."),
        ("lightbulb", "Surface insights", "Patterns in your work turn into insights on your Dashboard automatically."),
        ("checklist", "Suggest actions", "AIMA proposes next steps based on what's happening in your workspace."),
        ("checkmark.seal", "Execute approved tasks safely", "Nothing runs without your approval — you always confirm before AIMA acts."),
    ]

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(.tint)
                Text("Welcome to AIMA")
                    .font(.title.bold())
                Text("Your AI-powered workspace assistant — it remembers context, surfaces insights, and helps you get things done.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }

            VStack(alignment: .leading, spacing: 16) {
                ForEach(capabilities, id: \.title) { capability in
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: capability.systemImage)
                            .font(.title3)
                            .foregroundStyle(.tint)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(capability.title)
                                .fontWeight(.medium)
                            Text(capability.detail)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(maxWidth: 440, alignment: .leading)

            if let errorMessage = manager.errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(action: getStarted) {
                if isCompleting {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Get Started")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isCompleting)
            .keyboardShortcut(.defaultAction)
            .frame(maxWidth: 200)
        }
        .padding(40)
        .frame(width: 520)
    }

    private func getStarted() {
        isCompleting = true
        Task {
            await manager.completeOnboarding()
            isCompleting = false
        }
    }
}

#Preview {
    OnboardingView(manager: AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient()))
}
