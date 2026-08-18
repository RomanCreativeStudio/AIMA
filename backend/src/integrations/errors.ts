/**
 * Thrown for both "never connected" and "connected then disabled" — a
 * workspace with no enabled row for a provider is not distinguished from
 * one that never had a row at all, mirroring `WorkspaceNotFoundError`'s
 * "don't leak which case it was" reasoning.
 */
export class IntegrationNotFoundError extends Error {
  constructor(workspaceId: string, provider: string) {
    super(`No connected ${provider} integration was found in workspace ${workspaceId}`);
    this.name = 'IntegrationNotFoundError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor(provider: string, missingFields: string[]) {
    super(`Missing required credential field(s) for ${provider}: ${missingFields.join(', ')}`);
    this.name = 'InvalidCredentialsError';
  }
}

/** Thrown when a connector's `testConnection` reports the supplied credentials don't actually work. */
export class IntegrationConnectionFailedError extends Error {
  constructor(provider: string, detail?: string) {
    super(`Could not connect the ${provider} integration${detail ? `: ${detail}` : ''}`);
    this.name = 'IntegrationConnectionFailedError';
  }
}
