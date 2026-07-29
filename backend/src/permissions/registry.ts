import type { CapabilityDefinition } from './types';

/**
 * Starting set of capabilities. Every capability AIMA can perform must be
 * declared here with a tier before any code path may act on it
 * (docs/PRODUCT_BIBLE.md §9 Rule 1: "No unclassified capabilities").
 *
 * No capability in this seed defaults to "automatic_safe" — per Rule 2,
 * Tier 4 is only reached through explicit, logged user promotion at runtime,
 * never as a shipped default.
 */
export const DEFAULT_CAPABILITIES: CapabilityDefinition[] = [
  {
    actionType: 'suggest_followup',
    defaultTier: 'suggest',
    tierLocked: false,
    description: 'Propose a follow-up action to the user. No draft or execution occurs.',
  },
  {
    actionType: 'draft_email',
    defaultTier: 'prepare',
    tierLocked: false,
    description: "Draft an email into the user's review queue. Nothing is sent.",
  },
  {
    actionType: 'draft_proposal',
    defaultTier: 'prepare',
    tierLocked: false,
    description: "Draft a client proposal into the user's review queue. Nothing is sent.",
  },
  {
    actionType: 'draft_client_response',
    defaultTier: 'prepare',
    tierLocked: false,
    description: "Draft a response to a client into the user's review queue. Nothing is sent.",
  },
  {
    actionType: 'draft_report',
    defaultTier: 'prepare',
    tierLocked: false,
    description: "Draft a report into the user's review queue. Nothing is sent.",
  },
  {
    actionType: 'draft_github_issue',
    defaultTier: 'prepare',
    tierLocked: false,
    description:
      "Draft a GitHub issue into the user's review queue. Nothing is created on GitHub — the read-only " +
      'GitHub integration (Phase 2.3) has no write capability, by design.',
  },
  {
    actionType: 'send_email',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      "Send an email on the user's behalf. External communication — permanently locked at Tier 3 minimum.",
  },
  {
    actionType: 'create_task',
    defaultTier: 'prepare',
    tierLocked: false,
    description: 'Create a task/project item for user review before it is added.',
  },
  {
    actionType: 'log_note',
    defaultTier: 'prepare',
    tierLocked: false,
    description: 'File a note into the correct workspace. Eligible for future Tier 4 promotion once proven reliable.',
  },
  {
    actionType: 'create_memory',
    defaultTier: 'prepare',
    tierLocked: false,
    description:
      'Store a new long-term memory record for a workspace (docs/TECHNICAL_ARCHITECTURE.md §4). Internal only — no external effect.',
  },
  {
    actionType: 'generate_ai_response',
    defaultTier: 'suggest',
    tierLocked: false,
    description:
      'Generate a conversational AI reply within a workspace. Text only, no draft or execution — logged for transparency, not gated.',
  },
  {
    actionType: 'summarize_content',
    defaultTier: 'suggest',
    tierLocked: false,
    description: 'Summarize requested content within a workspace. Text only, no draft or execution.',
  },
  {
    actionType: 'import_document',
    defaultTier: 'prepare',
    tierLocked: false,
    description:
      'Import a document into a workspace knowledge base (docs/TECHNICAL_ARCHITECTURE.md §4). Internal only — no external effect.',
  },
  {
    actionType: 'reindex_document',
    defaultTier: 'prepare',
    tierLocked: false,
    description: 'Re-chunk and re-embed an already-imported document.',
  },
  {
    actionType: 'semantic_search',
    defaultTier: 'suggest',
    tierLocked: false,
    description:
      'Run a semantic similarity search across a workspace (memories, conversations, tasks). Read-only, advisory.',
  },
  {
    actionType: 'reindex_embeddings',
    defaultTier: 'prepare',
    tierLocked: false,
    description: 'Re-chunk and re-embed a workspace\'s conversations and tasks for semantic search.',
  },
  {
    actionType: 'set_preference',
    defaultTier: 'prepare',
    tierLocked: false,
    description:
      'Set a structured workspace preference (writing style, response preferences, workflow preferences, project rules) that shapes future assistant behavior.',
  },
  {
    actionType: 'delete_document',
    defaultTier: 'prepare',
    tierLocked: false,
    description: 'Remove an imported document and its chunks from a workspace. Reversible by re-importing the source.',
  },
  {
    actionType: 'read_email',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Read messages from a connected Gmail integration. External account data — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'draft_gmail_email',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      "Draft an email directly within a connected Gmail integration — distinct from the local draft queue's " +
      "draft_email, which never touches an external account. External account data — permanently locked at Tier 3 minimum.",
  },
  {
    actionType: 'read_repositories',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Read repositories and issues from a connected GitHub integration. External account data — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'read_calendar',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Read events from a connected Calendar integration. External account data — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'create_github_issue',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Create an issue directly on a connected GitHub repository — distinct from draft_github_issue, which only ' +
      'ever writes to the local draft queue. External write — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'create_github_pull_request',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Open a pull request directly on a connected GitHub repository. External write — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'create_calendar_event',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Create an event directly on a connected Calendar integration. External write — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'update_calendar_event',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Update an existing event directly on a connected Calendar integration. External write — permanently locked at Tier 3 minimum.',
  },
  {
    actionType: 'delete_calendar_event',
    defaultTier: 'execute_with_approval',
    tierLocked: true,
    description:
      'Delete an existing event directly on a connected Calendar integration. External write — permanently locked at Tier 3 minimum.',
  },
];

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDefinition>();

  constructor(seed: CapabilityDefinition[] = DEFAULT_CAPABILITIES) {
    for (const capability of seed) {
      this.register(capability);
    }
  }

  register(capability: CapabilityDefinition): void {
    if (this.capabilities.has(capability.actionType)) {
      throw new Error(`Capability already registered: "${capability.actionType}"`);
    }
    this.capabilities.set(capability.actionType, capability);
  }

  get(actionType: string): CapabilityDefinition | undefined {
    return this.capabilities.get(actionType);
  }

  list(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }
}
