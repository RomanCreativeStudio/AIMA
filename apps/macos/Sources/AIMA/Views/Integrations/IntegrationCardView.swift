import AIMACore
import SwiftUI

/// One provider's card on the Integrations screen (Phase 2.3, item 5):
/// status, description, its capability display, and the connect/disconnect/
/// rotate actions.
struct IntegrationCardView: View {
    let integration: WorkspaceIntegration
    let onConnect: () -> Void
    let onRotate: () -> Void
    let onDisconnect: () -> Void

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
                    Button("Rotate Credentials", action: onRotate)
                    Button("Disconnect", role: .destructive, action: onDisconnect)
                } else {
                    Button("Connect", action: onConnect)
                        .buttonStyle(.borderedProminent)
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
            connectedAt: nil, lastValidatedAt: nil, createdAt: "", updatedAt: "",
            displayName: "Gmail",
            description: "Read-only access to Gmail messages, plus preparing drafts for review before anything is sent.",
            capabilities: [
                IntegrationCapability(actionType: "read_email", tier: "execute_with_approval"),
                IntegrationCapability(actionType: "draft_gmail_email", tier: "execute_with_approval"),
            ],
            requiredCredentialFields: ["accessToken", "refreshToken"]
        ),
        onConnect: {}, onRotate: {}, onDisconnect: {}
    )
    .padding()
}
