import type { Queryable } from '../db/queryable';
import { WorkspaceNotFoundError } from '../types/errors';
import { DraftNotFoundError } from './errors';
import type { CreateDraftInput, Draft, DraftType, UpdateDraftInput } from './types';

/**
 * The Action Preparation Layer (Phase 1.7): a minimal, workspace-scoped
 * model for held content — email drafts, client responses, proposals,
 * reports — that a user reviews before anything is sent. Mirrors
 * TaskService's shape (Phase 1.6): create/list/get/update/delete, workspace
 * isolation enforced on every method. Deliberately does not send, execute,
 * or otherwise act on a draft's content — that's future work for whichever
 * Tier 3 capability (e.g. send_email) eventually consumes it.
 */
export class DraftService {
  constructor(private readonly db: Queryable) {}

  async createDraft(input: CreateDraftInput): Promise<Draft> {
    await this.assertWorkspaceExists(input.workspaceId);

    const result = await this.db.query(
      `INSERT INTO drafts (workspace_id, type, title, content, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, workspace_id, type, title, content, metadata, created_at, updated_at`,
      [input.workspaceId, input.type, input.title ?? null, input.content, JSON.stringify(input.metadata ?? {})],
    );

    return mapDraftRow(result.rows[0]);
  }

  async listDrafts(workspaceId: string, type?: DraftType): Promise<Draft[]> {
    const conditions = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const result = await this.db.query(
      `SELECT id, workspace_id, type, title, content, metadata, created_at, updated_at
       FROM drafts
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      params,
    );

    return result.rows.map(mapDraftRow);
  }

  async getDraft(workspaceId: string, draftId: string): Promise<Draft> {
    const result = await this.db.query(
      `SELECT id, workspace_id, type, title, content, metadata, created_at, updated_at
       FROM drafts WHERE id = $1 AND workspace_id = $2`,
      [draftId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new DraftNotFoundError(draftId, workspaceId);
    }

    return mapDraftRow(result.rows[0]);
  }

  async updateDraft(workspaceId: string, draftId: string, updates: UpdateDraftInput): Promise<Draft> {
    await this.getDraft(workspaceId, draftId); // existence + isolation check

    const fields: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.title !== undefined) set('title', updates.title);
    if (updates.content !== undefined) set('content', updates.content);
    if (updates.metadata !== undefined) set('metadata', JSON.stringify(updates.metadata));

    if (fields.length === 0) {
      return this.getDraft(workspaceId, draftId);
    }

    fields.push('updated_at = now()');
    params.push(draftId, workspaceId);

    const result = await this.db.query(
      `UPDATE drafts SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND workspace_id = $${params.length}
       RETURNING id, workspace_id, type, title, content, metadata, created_at, updated_at`,
      params,
    );

    return mapDraftRow(result.rows[0]);
  }

  async deleteDraft(workspaceId: string, draftId: string): Promise<void> {
    const result = await this.db.query('DELETE FROM drafts WHERE id = $1 AND workspace_id = $2', [
      draftId,
      workspaceId,
    ]);

    if (result.rowCount === 0) {
      throw new DraftNotFoundError(draftId, workspaceId);
    }
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface DraftRow {
  id: string;
  workspace_id: string;
  type: DraftType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapDraftRow(row: DraftRow): Draft {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
