import type { Queryable } from '../db/queryable';
import type { PermissionEngine } from '../permissions/engine';
import { PendingApprovalAlreadyResolvedError, PendingApprovalNotFoundError, UnregisteredCapabilityError } from './errors';
import type { ApprovalDecision, ApprovalState } from './types';

/**
 * The DB-backed half of the approval workflow (docs/PRODUCT_BIBLE.md §5,
 * docs/TECHNICAL_ARCHITECTURE.md §5): creating, approving, denying, and
 * checking the status of a `pending_approvals` row for a Tier 3 capability.
 *
 * This engine only ever *requests* permission for a future action — it
 * never executes one. None of this sprint's initial intents map to a
 * Tier 3 capability (see docs/decisions/0004-intent-and-approval-engine.md),
 * so it is exercised directly today, ready for the first Tier 3 capability
 * (e.g. sending an email) that needs it.
 */
export class ApprovalEngine {
  constructor(
    private readonly db: Queryable,
    private readonly permissionEngine: PermissionEngine,
  ) {}

  /**
   * For a Tier 1/2/4 capability, returns 'no_approval_needed' with no
   * database write. For a Tier 3 capability, creates a pending_approvals
   * row and returns 'approval_required' with its id.
   */
  async evaluate(workspaceId: string, actionType: string, payload: unknown): Promise<ApprovalDecision> {
    const decision = this.permissionEngine.evaluate(actionType);

    if (decision.kind !== 'requires_approval') {
      return { state: 'no_approval_needed' };
    }

    const capabilityResult = await this.db.query<{ id: string }>(
      'SELECT id FROM capabilities WHERE action_type = $1',
      [actionType],
    );
    if (capabilityResult.rows.length === 0) {
      throw new UnregisteredCapabilityError(actionType);
    }

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pending_approvals (workspace_id, capability_id, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, capabilityResult.rows[0].id, JSON.stringify(payload ?? null)],
    );

    return { state: 'approval_required', pendingApprovalId: result.rows[0].id };
  }

  async getStatus(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    const result = await this.db.query<{ status: string }>(
      'SELECT status FROM pending_approvals WHERE id = $1 AND workspace_id = $2',
      [pendingApprovalId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new PendingApprovalNotFoundError(pendingApprovalId, workspaceId);
    }

    return { state: mapDbStatus(result.rows[0].status), pendingApprovalId };
  }

  async approve(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    return this.resolve(workspaceId, pendingApprovalId, 'approved');
  }

  async deny(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    return this.resolve(workspaceId, pendingApprovalId, 'declined');
  }

  private async resolve(
    workspaceId: string,
    pendingApprovalId: string,
    dbStatus: 'approved' | 'declined',
  ): Promise<ApprovalDecision> {
    const existing = await this.db.query<{ status: string }>(
      'SELECT status FROM pending_approvals WHERE id = $1 AND workspace_id = $2',
      [pendingApprovalId, workspaceId],
    );

    if (existing.rows.length === 0) {
      throw new PendingApprovalNotFoundError(pendingApprovalId, workspaceId);
    }
    if (existing.rows[0].status !== 'pending') {
      throw new PendingApprovalAlreadyResolvedError(pendingApprovalId, existing.rows[0].status);
    }

    const result = await this.db.query<{ status: string }>(
      `UPDATE pending_approvals
       SET status = $1, resolved_at = now()
       WHERE id = $2 AND workspace_id = $3
       RETURNING status`,
      [dbStatus, pendingApprovalId, workspaceId],
    );

    return { state: mapDbStatus(result.rows[0].status), pendingApprovalId };
  }
}

function mapDbStatus(status: string): ApprovalState {
  switch (status) {
    case 'pending':
      return 'approval_required';
    case 'approved':
      return 'approved';
    case 'declined':
      return 'denied';
    default:
      throw new Error(`Unknown pending_approvals status: "${status}"`);
  }
}
