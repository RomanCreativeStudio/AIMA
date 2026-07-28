import type { WorkflowDefinition, WorkflowKey } from './types';

/**
 * The four built-in workflows (Phase 2.4, item 2). Deliberately a spread of
 * step shapes: two that only ever touch AIMA's own data (compose text,
 * save a local draft — Tier 2, auto-execute), one genuinely gated on a
 * Tier 3 capability (reading a connected Gmail inbox), and one that's
 * entirely internal (no capability at all). See docs/decisions/
 * 0012-workflow-orchestration-foundation.md for why each one is shaped
 * this way.
 */
export const DEFAULT_WORKFLOWS: WorkflowDefinition[] = [
  {
    key: 'draft_email_reply',
    displayName: 'Draft Email Reply',
    description: "Compose a reply and save it to the local draft queue for review. Never sends anything.",
    steps: [
      { key: 'compose_reply', displayName: 'Compose reply' },
      { key: 'save_draft', displayName: 'Save as email draft', capability: 'draft_email' },
    ],
    triggerPhrases: ['draft a reply', 'draft an email reply', 'reply to'],
  },
  {
    key: 'create_github_issue_draft',
    displayName: 'Create GitHub Issue Draft',
    description:
      'Compose a GitHub issue title and body and save it to the local draft queue. Never creates anything on GitHub — the read-only GitHub integration has no write capability, by design.',
    steps: [
      { key: 'compose_issue', displayName: 'Compose issue' },
      { key: 'save_draft', displayName: 'Save as GitHub issue draft', capability: 'draft_github_issue' },
    ],
    triggerPhrases: ['create a github issue', 'draft a github issue', 'file an issue'],
  },
  {
    key: 'summarize_unread_email',
    displayName: 'Summarize Unread Email',
    description:
      "Read recent messages from a connected Gmail integration and summarize them — the read step requires your approval.",
    steps: [
      { key: 'read_unread_email', displayName: 'Read unread email', capability: 'read_email' },
      { key: 'summarize', displayName: 'Summarize messages' },
    ],
    triggerPhrases: ['summarize my unread email', 'summarize unread email', 'summarize my inbox'],
  },
  {
    key: 'daily_workspace_briefing',
    displayName: 'Daily Workspace Briefing',
    description:
      'Gather this workspace\'s tasks, pending approvals, and system status into a short daily briefing. Entirely internal — nothing to approve.',
    steps: [
      { key: 'gather_snapshot', displayName: 'Gather workspace snapshot' },
      { key: 'compose_briefing', displayName: 'Compose briefing' },
    ],
    triggerPhrases: ['daily briefing', 'workspace briefing', 'give me my briefing'],
  },
];

export class WorkflowRegistry {
  private readonly definitions = new Map<WorkflowKey, WorkflowDefinition>();

  constructor(seed: WorkflowDefinition[] = DEFAULT_WORKFLOWS) {
    for (const definition of seed) {
      this.register(definition);
    }
  }

  register(definition: WorkflowDefinition): void {
    if (this.definitions.has(definition.key)) {
      throw new Error(`Workflow already registered: "${definition.key}"`);
    }
    this.definitions.set(definition.key, definition);
  }

  get(key: WorkflowKey): WorkflowDefinition | undefined {
    return this.definitions.get(key);
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }
}
