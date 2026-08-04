import type { Invitation } from '../invitations/types';
import type { Logger } from '../logging/types';
import type { NotificationService } from './types';

/**
 * Beta Invitations & Notifications sprint: POSTs a JSON payload to a configured webhook URL when an
 * invitation is created — the smallest possible outward signal (Slack/Discord/Zapier can all consume a
 * plain webhook) without picking a transactional-email vendor. Only constructed (`backend/src/index.ts`)
 * when `WEBHOOK_URL` is set; unconfigured means `InvitationService` simply has no `notificationService` at
 * all, the same optional-dependency posture as every other integration in this codebase.
 *
 * Never throws: a failed or unreachable webhook is logged and swallowed, never surfaced to the caller —
 * invitation creation must never fail (or roll back) because a downstream notification didn't go through.
 */
export class WebhookNotificationService implements NotificationService {
  constructor(
    private readonly webhookUrl: string,
    private readonly logger: Logger,
  ) {}

  async notifyInvitationCreated(invitation: Invitation): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'invitation.created', invitation }),
      });
      if (!response.ok) {
        this.logger.warn('Invitation webhook returned a non-2xx response', {
          webhookUrl: this.webhookUrl,
          status: response.status,
        });
      }
    } catch (error) {
      this.logger.warn('Invitation webhook request failed', {
        webhookUrl: this.webhookUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
