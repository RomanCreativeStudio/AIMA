/** Thrown by `InvitationService.createInvitation` when the invitee's email already belongs to an active beta tester — mirrors `WorkspaceAlreadyExistsError`'s "reject the redundant action" shape. */
export class UserAlreadyBetaTesterError extends Error {
  constructor(email: string) {
    super(`${email} is already a beta tester`);
    this.name = 'UserAlreadyBetaTesterError';
  }
}
