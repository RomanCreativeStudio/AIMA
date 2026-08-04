import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import type { CreateFeedbackInput, Feedback, FeedbackType } from './types';

/**
 * Beta Tester Infrastructure sprint: the minimum storage needed to collect feedback/bug reports/feature
 * requests from beta testers. Workspace-scoped and isolated the same way TaskService is — every method
 * requires a workspaceId and every query filters by it — reusing the existing
 * requireWorkspaceOwnership middleware already wired for `/api/workspaces/:workspaceId/*` rather than a
 * new authorization mechanism.
 */
export class FeedbackService {
  constructor(private readonly db: Queryable) {}

  async createFeedback(input: CreateFeedbackInput): Promise<Feedback> {
    await this.assertWorkspaceExists(input.workspaceId);

    const result = await this.db.query(
      `INSERT INTO feedback (workspace_id, user_id, type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, workspace_id, user_id, type, message, created_at`,
      [input.workspaceId, input.userId, input.type ?? 'general', input.message],
    );

    return mapFeedbackRow(result.rows[0]);
  }

  async listFeedback(workspaceId: string): Promise<Feedback[]> {
    await this.assertWorkspaceExists(workspaceId);

    const result = await this.db.query(
      `SELECT id, workspace_id, user_id, type, message, created_at
       FROM feedback WHERE workspace_id = $1 ORDER BY sequence DESC`,
      [workspaceId],
    );

    return result.rows.map(mapFeedbackRow);
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface FeedbackRow {
  id: string;
  workspace_id: string;
  user_id: string;
  type: FeedbackType;
  message: string;
  created_at: Date | string;
}

function mapFeedbackRow(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    type: row.type,
    message: row.message,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
