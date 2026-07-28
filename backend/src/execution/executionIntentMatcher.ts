import type { ExecutionRegistry } from './registry';
import type { ExecutionRequestPayload, ExecutionSuggestion } from './types';

interface ExecutionMatchRule {
  actionType: string;
  patterns: RegExp[];
  confidence: number;
  extract: (text: string) => ExecutionRequestPayload;
}

/**
 * Checked in order, first match wins — the same pure, stateless,
 * rule-based shape as `WorkflowIntentMatcher` (Phase 2.4), scoped to real
 * external actions instead of workflows. Trigger phrases are kept
 * distinct from `WorkflowIntentMatcher`'s own where practical, but the two
 * are allowed to both match the same message (e.g. "create a github
 * issue" already suggests the local-draft workflow) — both stay purely
 * advisory, so a message carrying both suggestions is harmless; the user
 * picks which one they actually want.
 */
const RULES: ExecutionMatchRule[] = [
  {
    actionType: 'send_email',
    patterns: [/\bsend (?:an )?email to\b/, /\bsend .* an email\b/],
    confidence: 0.75,
    extract: (text): ExecutionRequestPayload => {
      const toMatch = text.match(/\bto\s+([a-z0-9 .'-]+?@[a-z0-9.-]+\.[a-z]{2,})/i);
      const subjectMatch = text.match(/\babout\s+(.+)$/i);
      const payload: ExecutionRequestPayload = {};
      if (toMatch) payload.to = toMatch[1].trim();
      if (subjectMatch) payload.subject = subjectMatch[1].trim();
      return payload;
    },
  },
  {
    actionType: 'draft_gmail_email',
    patterns: [/\bsave (?:a |this as a )?gmail draft\b/, /\bdraft (?:this )?(?:directly )?in gmail\b/],
    confidence: 0.7,
    extract: () => ({}),
  },
  {
    actionType: 'create_github_issue',
    patterns: [/\bopen an issue on github\b/, /\bcreate an issue (?:directly )?on github\b/],
    confidence: 0.75,
    extract: (text): ExecutionRequestPayload => {
      const repoMatch = text.match(/\brepo(?:sitory)?\s+([a-z0-9_\-./]+)\b/i);
      const titleMatch = text.match(/\babout\s+(.+)$/i);
      const payload: ExecutionRequestPayload = {};
      if (repoMatch) payload.repository = repoMatch[1];
      if (titleMatch) payload.title = titleMatch[1].trim();
      return payload;
    },
  },
  {
    actionType: 'create_github_pull_request',
    patterns: [/\bopen (?:a |an )?(?:pull request|pr)\b/, /\bcreate (?:a |an )?(?:pull request|pr)\b/],
    confidence: 0.75,
    extract: (text): ExecutionRequestPayload => {
      const repoMatch = text.match(/\brepo(?:sitory)?\s+([a-z0-9_\-./]+)\b/i);
      const payload: ExecutionRequestPayload = {};
      if (repoMatch) payload.repository = repoMatch[1];
      return payload;
    },
  },
];

/**
 * Detects real external-action intent (Phase 2.6, item 5) — pure and
 * stateless, never touches the database or creates an execution. A match
 * is only ever an advisory `ExecutionSuggestion`; nothing here ever
 * executes anything, and it's never invoked outside a chat turn — the
 * user always drives execution through a dedicated preview/create/execute
 * request afterward.
 */
export class ExecutionIntentMatcher {
  constructor(private readonly executionRegistry: ExecutionRegistry) {}

  match(message: string): ExecutionSuggestion | null {
    const text = message.trim();
    if (text.length === 0) {
      return null;
    }
    const lower = text.toLowerCase();

    for (const rule of RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(lower))) {
        continue;
      }

      const executor = this.executionRegistry.get(rule.actionType);
      if (!executor) {
        continue;
      }

      return {
        actionType: executor.actionType,
        provider: executor.provider,
        confidence: rule.confidence,
        extractedPayload: rule.extract(text),
      };
    }

    return null;
  }
}
