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
  /**
   * The capability/capabilities gating write access through this integration
   * (Phase 2.7): plural because Phase 2.6/2.7 added more than one per
   * provider (GitHub's create-issue/create-pull-request, Calendar's
   * create/update/delete-event) — a single `writeCapability` string could
   * only ever describe one action, not "every write this integration can
   * do." Empty for a provider with no write action at all.
   */
  writeCapabilities: string[];
  /** Credential fields a connector needs to authenticate — validated by `IntegrationService` before ever calling a connector. */
  requiredCredentialFields: string[];
}

export const DEFAULT_INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: 'gmail',
    displayName: 'Gmail',
    description: 'Send, save drafts, read the inbox/unread messages, and search a connected Gmail account.',
    readCapability: 'read_email',
    writeCapabilities: ['send_email', 'draft_gmail_email'],
    requiredCredentialFields: ['accessToken', 'refreshToken'],
  },
  {
    provider: 'github',
    displayName: 'GitHub',
    description: 'Read repositories, issues, and pull requests, plus creating issues and pull requests on a connected repository.',
    readCapability: 'read_repositories',
    writeCapabilities: ['create_github_issue', 'create_github_pull_request'],
    requiredCredentialFields: ['accessToken'],
  },
  {
    provider: 'calendar',
    displayName: 'Calendar',
    description: 'List calendars, read events, and create/update/delete events on a connected Calendar account.',
    readCapability: 'read_calendar',
    writeCapabilities: ['create_calendar_event', 'update_calendar_event', 'delete_calendar_event'],
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
