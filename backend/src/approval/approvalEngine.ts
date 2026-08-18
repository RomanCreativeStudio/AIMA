import type { Queryable } from '../db/queryable';
import type { PermissionEngine } from '../permissions/engine';
import {
  PendingApprovalAlreadyResolvedError,
  PendingApprovalExpiredError,
  PendingApprovalNotFoundError,
  UnregisteredCapabilityError,
} from './errors';
import type { ApprovalDecision, ApprovalStatus, PendingApproval } from './types';

/**
 * The DB-backed half of the approval workflow (docs/PRODUCT_BIBLE.md §5,
 * docs/TECHNICAL_ARCHITECTURE.md §5): creating, listing, approving, and
 * rejecting `pending_approvals` rows for a Tier 3 capability.
 *
 * This engine only ever *requests* permission for a future action — it
 * never executes one. `expires_at` is written once at creation; "expired"
 * is never persisted as its own status — it's computed here, at read time,
 * from `expires_at` vs. now(), so a stale request can't be approved or
 * rejected after the fact without needing a background job to flip it.
 */
export class ApprovalEngine {
  constructor(
    private readonly db: Queryable,
    private readonly permissionEngine: PermissionEngine,
  ) {}

  /**
   * For a Tier 1/2/4 capability, returns 'no_approval_needed' with no
   * database write. For a Tier 3 capability, creates a pending_approvals
   * row and returns 'pending' with its id.
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

    return { state: 'pending', pendingApprovalId: result.rows[0].id };
  }

  /** All approvals for a workspace, newest first, optionally filtered to one effective status (expiry-aware). */
  async list(workspaceId: string, status?: ApprovalStatus): Promise<PendingApproval[]> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT pa.id, pa.workspace_id, c.action_type, pa.payload, pa.status, pa.created_at, pa.expires_at, pa.resolved_at
       FROM pending_approvals pa
       JOIN capabilities c ON c.id = pa.capability_id
       WHERE pa.workspace_id = $1
       ORDER BY pa.sequence DESC`,
      [workspaceId],
    );

    const approvals = result.rows.map(mapApprovalRow);
    return status ? approvals.filter((approval) => approval.status === status) : approvals;
  }

  async get(workspaceId: string, pendingApprovalId: string): Promise<PendingApproval> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT pa.id, pa.workspace_id, c.action_type, pa.payload, pa.status, pa.created_at, pa.expires_at, pa.resolved_at
       FROM pending_approvals pa
       JOIN capabilities c ON c.id = pa.capability_id
       WHERE pa.id = $1 AND pa.workspace_id = $2`,
      [pendingApprovalId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new PendingApprovalNotFoundError(pendingApprovalId, workspaceId);
    }

    return mapApprovalRow(result.rows[0]);
  }

  async getStatus(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    const approval = await this.get(workspaceId, pendingApprovalId);
    return { state: approval.status, pendingApprovalId };
  }

  async approve(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    return this.resolve(workspaceId, pendingApprovalId, 'approved');
  }

  async reject(workspaceId: string, pendingApprovalId: string): Promise<ApprovalDecision> {
    return this.resolve(workspaceId, pendingApprovalId, 'rejected');
  }

  private async resolve(
    workspaceId: string,
    pendingApprovalId: string,
    newStatus: 'approved' | 'rejected',
  ): Promise<ApprovalDecision> {
    const existing = await this.get(workspaceId, pendingApprovalId);

    if (existing.status === 'expired') {
      throw new PendingApprovalExpiredError(pendingApprovalId);
    }
    if (existing.status !== 'pending') {
      throw new PendingApprovalAlreadyResolvedError(pendingApprovalId, existing.status);
    }

    const result = await this.db.query<{ status: ApprovalStatus }>(
      `UPDATE pending_approvals
       SET status = $1, resolved_at = now()
       WHERE id = $2 AND workspace_id = $3
       RETURNING status`,
      [newStatus, pendingApprovalId, workspaceId],
    );

    return { state: result.rows[0].status, pendingApprovalId };
  }
}

interface ApprovalRow {
  id: string;
  workspace_id: string;
  action_type: string;
  payload: unknown;
  status: 'pending' | 'approved' | 'rejected';
  created_at: Date | string;
  expires_at: Date | string;
  resolved_at: Date | string | null;
}

function mapApprovalRow(row: ApprovalRow): PendingApproval {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type,
    payload: row.payload,
    status: computeEffectiveStatus(row.status, row.expires_at),
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
  };
}

function computeEffectiveStatus(status: 'pending' | 'approved' | 'rejected', expiresAt: Date | string): ApprovalStatus {
  if (status === 'pending' && new Date(expiresAt).getTime() < Date.now()) {
    return 'expired';
  }
  return status;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
