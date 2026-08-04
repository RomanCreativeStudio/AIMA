export const INVITATION_STATUSES = ['pending', 'accepted', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Beta Invitations & Notifications sprint: a founder-issued invite to a prospective beta tester. */
export interface Invitation {
  id: string;
  email: string;
  invitedBy: string;
  status: InvitationStatus;
  createdAt: string;
}

export interface CreateInvitationInput {
  email: string;
  invitedBy: string;
}
