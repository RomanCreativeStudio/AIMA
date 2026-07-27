export class PreferenceNotFoundError extends Error {
  constructor(preferenceId: string, workspaceId: string) {
    super(`Preference ${preferenceId} was not found in workspace ${workspaceId}`);
    this.name = 'PreferenceNotFoundError';
  }
}
