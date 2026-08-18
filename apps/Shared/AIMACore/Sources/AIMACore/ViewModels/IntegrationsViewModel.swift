import Foundation
import Observation

/// Backs the Integrations screen (Phase 2.3, item 5): connection status,
/// connect/disconnect/rotate, and capability display for the three fixed
/// providers. Scoped to one workspace, like `TasksViewModel`/
/// `ApprovalsViewModel`. Uses `@Observable` (not Combine) so this package
/// stays Linux-buildable — see `Package.swift`.
@MainActor
@Observable
public final class IntegrationsViewModel {
    public private(set) var integrations: [WorkspaceIntegration] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    /// A one-shot confirmation for the most recent connect/disconnect/rotate — cleared at the start of every new action, not a persistent status.
    public private(set) var lastActionConfirmation: String?

    private let apiClient: APIClient
    private let workspaceId: String

    public init(apiClient: APIClient, workspaceId: String) {
        self.apiClient = apiClient
        self.workspaceId = workspaceId
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            integrations = try await apiClient.listIntegrations(workspaceId: workspaceId)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func connect(provider: IntegrationProvider, credentials: [String: String]) async {
        errorMessage = nil
        lastActionConfirmation = nil
        do {
            let integration = try await apiClient.connectIntegration(workspaceId: workspaceId, provider: provider, credentials: credentials)
            apply(integration)
            lastActionConfirmation = "Connected \(integration.displayName)."
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func disconnect(provider: IntegrationProvider) async {
        errorMessage = nil
        lastActionConfirmation = nil
        do {
            let integration = try await apiClient.disconnectIntegration(workspaceId: workspaceId, provider: provider)
            apply(integration)
            lastActionConfirmation = "Disconnected \(integration.displayName)."
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Starts an OAuth connection (or reconnection) for `provider` (Phase 2.7, item 8) — returns the URL the view
    /// should open in the system browser. Unlike `connect`, this never itself marks the integration connected:
    /// the backend completes the connection server-side once the provider redirects back, so the view must call
    /// `load()` again (e.g. from a "Refresh Status" button) to see the result — there is no background polling.
    public func startOAuthConnection(provider: IntegrationProvider) async -> URL? {
        errorMessage = nil
        lastActionConfirmation = nil
        do {
            let authorizationUrl = try await apiClient.startIntegrationOAuth(workspaceId: workspaceId, provider: provider)
            guard let url = URL(string: authorizationUrl) else {
                errorMessage = "The server returned an invalid authorization URL."
                return nil
            }
            return url
        } catch let error as APIError {
            errorMessage = error.userMessage
            return nil
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    public func rotate(provider: IntegrationProvider, credentials: [String: String]) async {
        errorMessage = nil
        lastActionConfirmation = nil
        do {
            let integration = try await apiClient.rotateIntegrationCredentials(workspaceId: workspaceId, provider: provider, credentials: credentials)
            apply(integration)
            lastActionConfirmation = "Rotated credentials for \(integration.displayName)."
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(_ integration: WorkspaceIntegration) {
        if let index = integrations.firstIndex(where: { $0.provider == integration.provider }) {
            integrations[index] = integration
        } else {
            integrations.append(integration)
        }
    }
}
