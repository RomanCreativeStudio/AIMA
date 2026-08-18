import AIMACore
import SwiftUI

/// The sign-in screen — adapted from `apps/macos/Sources/AIMA/Views/Auth/LoginView.swift` (same
/// `AuthenticationManager`-only logic; `.textFieldStyle(.roundedBorder)` and `.keyboardShortcut(.defaultAction)`
/// are both cross-platform SwiftUI, so this differs only in a couple of iOS-appropriate touches: no fixed
/// `.frame(width:)`, and `.textInputAutocapitalization(.never)` on the email field so iOS doesn't capitalize it).
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
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
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
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign In")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSigningIn || email.isEmpty || password.isEmpty)
        }
        .padding(32)
        .frame(maxWidth: 400)
        .onAppear { focusedField = .email }
    }

    private func signIn() {
        Task {
            await manager.signIn(email: email, password: password)
            if case .authenticated = manager.state {
                password = ""
            }
        }
    }
}

#Preview {
    LoginView(manager: AuthenticationManager(authClient: MockAuthClient(), apiClient: MockAPIClient()))
}
