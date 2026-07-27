import type { Queryable } from '../db/queryable';
import { UserNotFoundError } from '../users/errors';
import { WorkspaceNotFoundError } from '../types/errors';
import { WORKSPACE_TYPE_BY_SLUG, type WorkspaceSlug, type WorkspaceType } from '../types/workspace';
import { WorkspaceAlreadyExistsError } from './errors';
import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from './types';

const UNIQUE_VIOLATION = '23505';

/**
 * The Workspace Configuration System (Phase 1.8): create/get/list/update
 * over the `workspaces` table, now that it carries real configuration
 * (`type`, `instructions`, `assistantBehavior`, `metadata`) beyond the
 * fixed `slug` identity. Before this phase, workspaces were only ever
 * inserted directly via SQL in tests/dev — this is the first application
 * service to own the table.
 */
export class WorkspaceService {
  constructor(private readonly db: Queryable) {}

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const userResult = await this.db.query('SELECT 1 FROM users WHERE id = $1', [input.userId]);
    if (userResult.rows.length === 0) {
      throw new UserNotFoundError(input.userId);
    }

    const type = input.type ?? WORKSPACE_TYPE_BY_SLUG[input.slug];

    try {
      const result = await this.db.query(
        `INSERT INTO workspaces (user_id, slug, name, type, instructions, assistant_behavior, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         RETURNING id, user_id, slug, name, type, instructions, assistant_behavior, metadata, created_at, updated_at`,
        [
          input.userId,
          input.slug,
          input.name,
          type,
          input.instructions ?? null,
          JSON.stringify(input.assistantBehavior ?? {}),
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      return mapWorkspaceRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WorkspaceAlreadyExistsError(input.userId, input.slug);
      }
      throw error;
    }
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const result = await this.db.query(
      `SELECT id, user_id, slug, name, type, instructions, assistant_behavior, metadata, created_at, updated_at
       FROM workspaces WHERE id = $1`,
      [workspaceId],
    );

    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    return mapWorkspaceRow(result.rows[0]);
  }

  async listWorkspaces(userId: string): Promise<Workspace[]> {
    const result = await this.db.query(
      `SELECT id, user_id, slug, name, type, instructions, assistant_behavior, metadata, created_at, updated_at
       FROM workspaces WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );

    return result.rows.map(mapWorkspaceRow);
  }

  async updateWorkspace(workspaceId: string, updates: UpdateWorkspaceInput): Promise<Workspace> {
    await this.getWorkspace(workspaceId); // existence check

    const fields: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.name !== undefined) set('name', updates.name);
    if (updates.type !== undefined) set('type', updates.type);
    if (updates.instructions !== undefined) set('instructions', updates.instructions);
    if (updates.assistantBehavior !== undefined) set('assistant_behavior', JSON.stringify(updates.assistantBehavior));
    if (updates.metadata !== undefined) set('metadata', JSON.stringify(updates.metadata));

    if (fields.length === 0) {
      return this.getWorkspace(workspaceId);
    }

    fields.push('updated_at = now()');
    params.push(workspaceId);

    const result = await this.db.query(
      `UPDATE workspaces SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, user_id, slug, name, type, instructions, assistant_behavior, metadata, created_at, updated_at`,
      params,
    );

    return mapWorkspaceRow(result.rows[0]);
  }
}

interface WorkspaceRow {
  id: string;
  user_id: string;
  slug: WorkspaceSlug;
  name: string;
  type: WorkspaceType | null;
  instructions: string | null;
  assistant_behavior: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    type: row.type ?? WORKSPACE_TYPE_BY_SLUG[row.slug],
    instructions: row.instructions,
    assistantBehavior: row.assistant_behavior,
    metadata: row.metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
