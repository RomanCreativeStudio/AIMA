import AIMACore
import SwiftUI

/// The sign-in screen (macOS Auth Bootstrap sprint) — shown by `AIMAApp` whenever `AuthenticationManager.state`
/// is `.signedOut`. Contains no authentication logic of its own; every action here just calls through to
/// `manager.signIn`, which is the only thing that talks to `AuthClient`. `email`/`password` are transient UI
/// state owned by this view (not `AuthenticationManager`, which has no reason to hold in-progress form text),
/// mirroring `SettingsView`'s existing `displayNameDraft`/`communicationStyleDraft` pattern.
struct LoginView: View {
    let manager: AuthenticationManager
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    private enum Field {
        case email, password
    }

    private var isSigningIn: Bool {
        if case .loading = manager.state { return true }
        return false
    }

    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 40))
                    .foregroundStyle(.tint)
                Text("Sign in to AIMA")
                    .font(.title2.bold())
            }

            VStack(alignment: .leading, spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .focused($focusedField, equals: .email)
                    .onSubmit { focusedField = .password }

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .focused($focusedField, equals: .password)
                    .onSubmit(signIn)
            }
            .textFieldStyle(.roundedBorder)
            .disabled(isSigningIn)

            if let errorMessage = manager.errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(action: signIn) {
                if isSigningIn {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign In")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSigningIn || email.isEmpty || password.isEmpty)
            .keyboardShortcut(.defaultAction)
        }
        .padding(32)
        .frame(width: 320)
        .onAppear { focusedField = .email }
    }

    private func signIn() {
        Task {
            await manager.signIn(email: email, password: password)
            // Cleared locally, not by `AuthenticationManager` (which never holds in-progress form text) — only
            // on success, matching this screen's prior behavior: a failed attempt leaves the password in place
            // so a typo is easy to fix without retyping everything.
            if case .authenticated = manager.state {
                password = ""
            }
        }
    }
}

#Preview {
    LoginView(manager: AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient()))
}
