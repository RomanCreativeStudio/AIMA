import type { WorkflowRegistry } from './registry';
import type { WorkflowKey, WorkflowRunInput, WorkflowSuggestion } from './types';

interface WorkflowMatchRule {
  workflowKey: WorkflowKey;
  patterns: RegExp[];
  confidence: number;
  extract: (text: string) => WorkflowRunInput;
}

/**
 * Checked in order, first match wins — deliberately the same "simple
 * pattern matching, no AI call" shape as `ai-engine`'s
 * `RuleBasedIntentClassifier`, just scoped to workflows instead of the
 * fixed 9-intent set. Kept in `backend/` rather than `ai-engine/` because
 * it depends on `WorkflowRegistry`, a backend-only concept.
 */
const RULES: WorkflowMatchRule[] = [
  {
    workflowKey: 'summarize_unread_email',
    patterns: [/\bsummarize (?:my )?(?:unread email|inbox)\b/, /\bsummarize my last\b.*\bemails?\b/],
    confidence: 0.85,
    extract: (text): WorkflowRunInput => {
      const limitMatch = text.match(/\blast (\d+)\b/i);
      return limitMatch ? { limit: limitMatch[1] } : {};
    },
  },
  {
    workflowKey: 'daily_workspace_briefing',
    patterns: [/\b(?:daily|workspace) briefing\b/, /\bgive me my briefing\b/],
    confidence: 0.85,
    extract: () => ({}),
  },
  {
    workflowKey: 'create_github_issue_draft',
    patterns: [/\bcreate (?:a |an )?github issue\b/, /\bdraft (?:a |an )?github issue\b/, /\bfile an issue\b/],
    confidence: 0.8,
    extract: (text) => {
      const forMatch = text.match(/\bfor\s+([a-z0-9_\-./]+)\b/i);
      const aboutMatch = text.match(/\babout\s+(.+)$/i);
      const input: WorkflowRunInput = {};
      if (forMatch) input.repository = forMatch[1];
      if (aboutMatch) input.summary = aboutMatch[1].trim();
      return input;
    },
  },
  {
    workflowKey: 'draft_email_reply',
    patterns: [/\bdraft (?:a |an )?(?:email )?reply\b/, /\breply to\b/],
    confidence: 0.8,
    extract: (text): WorkflowRunInput => {
      const replyToMatch = text.match(/\breply to\s+([a-z0-9 .'-]+?)\s+about\s+(.+)$/i);
      if (replyToMatch) {
        return { recipientName: replyToMatch[1].trim(), topic: replyToMatch[2].trim() };
      }
      const aboutMatch = text.match(/\babout\s+(.+)$/i);
      return aboutMatch ? { topic: aboutMatch[1].trim() } : {};
    },
  },
];

/**
 * Detects workflow intent (Phase 2.4, item 4) — pure and stateless, never
 * touches the database or creates a `WorkflowRun`. A match is only ever an
 * advisory `WorkflowSuggestion`; starting the workflow for real is always
 * a separate, explicit call the user (or client) makes afterward.
 */
export class WorkflowIntentMatcher {
  constructor(private readonly workflowRegistry: WorkflowRegistry) {}

  match(message: string): WorkflowSuggestion | null {
    const text = message.trim();
    if (text.length === 0) {
      return null;
    }
    const lower = text.toLowerCase();

    for (const rule of RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(lower))) {
        continue;
      }

      const definition = this.workflowRegistry.get(rule.workflowKey);
      if (!definition) {
        continue;
      }

      return {
        workflowKey: definition.key,
        displayName: definition.displayName,
        description: definition.description,
        confidence: rule.confidence,
        steps: definition.steps,
        extractedInput: rule.extract(text),
      };
    }

    return null;
  }
}
