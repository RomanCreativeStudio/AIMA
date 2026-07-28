import type { IntegrationProvider } from './types';

/**
 * Static metadata for one connectable provider — the integration-layer
 * counterpart to `CapabilityRegistry`'s `CapabilityDefinition` (backend/src/
 * permissions/registry.ts). `readCapability`/`writeCapability` name the
 * capability (registered there, not here) that gates actually using the
 * connection once it exists — this registry only describes what a provider
 * *is*, never enforces a permission tier itself.
 */
export interface IntegrationDefinition {
  provider: IntegrationProvider;
  displayName: string;
  description: string;
  /** The capability gating read access through this integration. */
  readCapability: string;
  /** The capability gating write/draft access through this integration, if it has one. */
  writeCapability?: string;
  /** Credential fields a connector needs to authenticate — validated by `IntegrationService` before ever calling a connector. */
  requiredCredentialFields: string[];
}

export const DEFAULT_INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: 'gmail',
    displayName: 'Gmail',
    description: 'Read-only access to Gmail messages, plus preparing drafts for review before anything is sent.',
    readCapability: 'read_email',
    writeCapability: 'draft_gmail_email',
    requiredCredentialFields: ['accessToken', 'refreshToken'],
  },
  {
    provider: 'github',
    displayName: 'GitHub',
    description: 'Read-only access to repositories and issues.',
    readCapability: 'read_repositories',
    requiredCredentialFields: ['accessToken'],
  },
  {
    provider: 'calendar',
    displayName: 'Calendar',
    description: 'Read-only access to calendar events.',
    readCapability: 'read_calendar',
    requiredCredentialFields: ['accessToken', 'refreshToken'],
  },
];

export class IntegrationRegistry {
  private readonly definitions = new Map<IntegrationProvider, IntegrationDefinition>();

  constructor(seed: IntegrationDefinition[] = DEFAULT_INTEGRATIONS) {
    for (const definition of seed) {
      this.register(definition);
    }
  }

  register(definition: IntegrationDefinition): void {
    if (this.definitions.has(definition.provider)) {
      throw new Error(`Integration provider already registered: "${definition.provider}"`);
    }
    this.definitions.set(definition.provider, definition);
  }

  get(provider: IntegrationProvider): IntegrationDefinition | undefined {
    return this.definitions.get(provider);
  }

  list(): IntegrationDefinition[] {
    return Array.from(this.definitions.values());
  }
}
