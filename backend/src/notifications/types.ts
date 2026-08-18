import type { Invitation } from '../invitations/types';

/**
 * Beta Invitations & Notifications sprint: mirrors the provider-abstraction pattern already used throughout
 * this backend (`AIProvider`, `EmbeddingProvider`, `AuthProvider`, `Logger`) — callers depend only on this
 * interface, never a concrete transport. Every implementation must never throw: a notification failure is
 * never allowed to fail the operation that triggered it (see `WebhookNotificationService`'s own doc comment).
 */
export interface NotificationService {
  notifyInvitationCreated(invitation: Invitation): Promise<void>;
}
