export class TaskNotFoundError extends Error {
  constructor(taskId: string, workspaceId: string) {
    super(`Task ${taskId} was not found in workspace ${workspaceId}`);
    this.name = 'TaskNotFoundError';
  }
}
