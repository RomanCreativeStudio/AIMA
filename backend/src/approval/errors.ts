/**
 * Thrown for both "no such id" and "id belongs to a different workspace" —
 * both cases are reported identically so a cross-workspace lookup attempt
 * learns nothing about whether the approval exists elsewhere
 * (docs/TECHNICAL_ARCHITECTURE.md §6), mirroring ConversationNotFoundError.
 */
export class PendingApprovalNotFoundError extends Error {
  constructor(pendingApprovalId: string, workspaceId: string) {
    super(`Pending approval ${pendingApprovalId} was not found in workspace ${workspaceId}`);
    this.name = 'PendingApprovalNotFoundError';
  }
}

export class PendingApprovalAlreadyResolvedError extends Error {
  constructor(pendingApprovalId: string, currentStatus: string) {
    super(`Pending approval ${pendingApprovalId} was already resolved (status: ${currentStatus})`);
    this.name = 'PendingApprovalAlreadyResolvedError';
  }
}

export class UnregisteredCapabilityError extends Error {
  constructor(actionType: string) {
    super(
      `Capability "${actionType}" is not synced to the database. ` +
        'Call syncCapabilitiesToDatabase(db, registry) at startup before creating approvals.',
    );
    this.name = 'UnregisteredCapabilityError';
  }
}
