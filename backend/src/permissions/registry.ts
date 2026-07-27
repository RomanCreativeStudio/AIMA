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
const DEFAULT_CAPABILITIES: CapabilityDefinition[] = [
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
