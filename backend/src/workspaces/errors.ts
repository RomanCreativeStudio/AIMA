/** The fixed (user_id, slug) uniqueness constraint from 0001_init.sql — a user can only have one workspace per slug. */
export class WorkspaceAlreadyExistsError extends Error {
  constructor(userId: string, slug: string) {
    super(`User ${userId} already has a workspace with slug "${slug}"`);
    this.name = 'WorkspaceAlreadyExistsError';
  }
}
