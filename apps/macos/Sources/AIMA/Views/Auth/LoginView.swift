import AIMACore
import SwiftUI

/// The sign-in screen (macOS Authentication Foundation) — shown by `AIMAApp` whenever
/// `AuthenticationViewModel.isAuthenticated` is false. Contains no authentication logic of its own; every
/// action here just calls through to the view model, which is the only thing that talks to `AuthClient`.
struct LoginView: View {
    @Bindable var viewModel: AuthenticationViewModel
    @FocusState private var focusedField: Field?

    private enum Field {
        case email, password
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
                TextField("Email", text: $viewModel.email)
                    .textContentType(.username)
                    .focused($focusedField, equals: .email)
                    .onSubmit { focusedField = .password }

                SecureField("Password", text: $viewModel.password)
                    .textContentType(.password)
                    .focused($focusedField, equals: .password)
                    .onSubmit(signIn)
            }
            .textFieldStyle(.roundedBorder)
            .disabled(viewModel.isLoading)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(action: signIn) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign In")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isLoading || viewModel.email.isEmpty || viewModel.password.isEmpty)
            .keyboardShortcut(.defaultAction)
        }
        .padding(32)
        .frame(width: 320)
        .onAppear { focusedField = .email }
    }

    private func signIn() {
        Task { await viewModel.signIn() }
    }
}

#Preview {
    LoginView(viewModel: AuthenticationViewModel(authClient: MockAuthClient()))
}
