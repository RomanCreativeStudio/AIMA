import AIMACore
import SwiftUI

/// One provider's card on the Integrations screen (Phase 2.3, item 5; Phase
/// 2.7 item 8): status, description, its capability display, token
/// expiration, and the connect/reconnect/disconnect/rotate actions. "Connect
/// via Browser" is the primary path (Phase 2.7's OAuth flow); manual
/// credential entry stays available as a secondary, less prominent option
/// for backward compatibility with Phase 2.3's original flow.
struct IntegrationCardView: View {
    let integration: WorkspaceIntegration
    let onConnectViaOAuth: () -> Void
    let onEnterCredentialsManually: () -> Void
    let onRotate: () -> Void
    let onDisconnect: () -> Void

    private var isTokenExpired: Bool {
        guard let tokenExpiresAt = integration.tokenExpiresAt, let expiry = ISO8601DateFormatter().date(from: tokenExpiresAt) else {
            return false
        }
        return expiry <= Date()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(integration.displayName).font(.headline)
                    Text(integration.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                IntegrationStatusPill(status: integration.status)
            }

            if integration.enabled, let tokenExpiresAt = integration.tokenExpiresAt {
                Label(
                    isTokenExpired ? "Token expired \(tokenExpiresAt) — reconnect to continue." : "Token expires \(tokenExpiresAt).",
                    systemImage: isTokenExpired ? "exclamationmark.triangle.fill" : "clock"
                )
                .font(.caption)
                .foregroundStyle(isTokenExpired ? .red : .secondary)
            }

            if !integration.capabilities.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Capabilities")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(integration.capabilities, id: \.actionType) { capability in
                        HStack(spacing: 6) {
                            Image(systemName: "lock.shield")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(capability.actionType)
                                .font(.caption)
                            Text("(\(capability.tier))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            HStack {
                if integration.enabled {
                    if isTokenExpired {
                        Button("Reconnect via Browser", action: onConnectViaOAuth)
                            .buttonStyle(.borderedProminent)
                    }
                    Button("Rotate Credentials", action: onRotate)
                    Button("Disconnect", role: .destructive, action: onDisconnect)
                } else {
                    Button("Connect via Browser", action: onConnectViaOAuth)
                        .buttonStyle(.borderedProminent)
                    Button("Enter Credentials Manually", action: onEnterCredentialsManually)
                        .buttonStyle(.plain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct IntegrationStatusPill: View {
    let status: IntegrationStatus

    private var color: Color {
        switch status {
        case .connected: return .green
        case .disconnected: return .secondary
        case .error: return .red
        }
    }

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }
}

#Preview {
    IntegrationCardView(
        integration: WorkspaceIntegration(
            workspaceId: "mock-ws-rcs", provider: .gmail, enabled: false, status: .disconnected,
            connectedAt: nil, lastValidatedAt: nil, tokenExpiresAt: nil, createdAt: "", updatedAt: "",
            displayName: "Gmail",
            description: "Send, save drafts, read the inbox/unread messages, and search a connected Gmail account.",
            capabilities: [
                IntegrationCapability(actionType: "read_email", tier: "execute_with_approval"),
                IntegrationCapability(actionType: "send_email", tier: "execute_with_approval"),
                IntegrationCapability(actionType: "draft_gmail_email", tier: "execute_with_approval"),
            ],
            requiredCredentialFields: ["accessToken", "refreshToken"]
        ),
        onConnectViaOAuth: {}, onEnterCredentialsManually: {}, onRotate: {}, onDisconnect: {}
    )
    .padding()
}
