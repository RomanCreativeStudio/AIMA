import type { Intent, IntentClassifier, IntentDetectionResult } from './types';

interface Rule {
  intent: Intent;
  patterns: RegExp[];
  confidence: number;
}

/**
 * Checked in order, first match wins. Deliberately simple pattern matching —
 * no AI call, no network, no cost — sufficient for an MVP with a fixed,
 * small intent set. A future ModelBasedIntentClassifier could implement the
 * same IntentClassifier interface without any caller changing
 * (docs/decisions/0004-intent-and-approval-engine.md).
 */
const RULES: Rule[] = [
  {
    intent: 'search_memory',
    patterns: [
      /\bdo (you|i) remember\b/,
      /\bwhat do (you|i) (know|remember)\b/,
      /\bwhat did (i|we) (say|tell you)\b/,
      /\bsearch (my )?memor(y|ies)\b/,
      /\brecall\b/,
    ],
    confidence: 0.85,
  },
  {
    intent: 'remember',
    patterns: [/\bremember that\b/, /\bdon'?t forget\b/, /\bkeep in mind\b/, /\bnote that\b/, /\bplease remember\b/],
    confidence: 0.9,
  },
  {
    intent: 'create_task',
    patterns: [
      /\b(create|add|make)\s+(a\s+)?task\b/,
      /\bto-?do\b/,
      /\bremind me to\b/,
      /\badd (this|that) to my (task|to-?do) list\b/,
    ],
    confidence: 0.9,
  },
  {
    intent: 'draft_email',
    patterns: [/\bdraft\s+(an?\s+)?email\b/, /\bwrite\s+(an?\s+)?email\b/, /\bcompose\s+(an?\s+)?email\b/],
    confidence: 0.9,
  },
  {
    intent: 'summarize',
    patterns: [/\bsummarize\b/, /\bsummary\b/, /\btl;?dr\b/, /\bshort version\b/, /\bcondense\b/],
    confidence: 0.85,
  },
];

export class RuleBasedIntentClassifier implements IntentClassifier {
  readonly name = 'rule-based';

  async classify(message: string): Promise<IntentDetectionResult> {
    const trimmed = message.trim();

    if (trimmed.length === 0) {
      return { intent: 'unknown', confidence: 0 };
    }

    const text = trimmed.toLowerCase();

    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(text))) {
        return { intent: rule.intent, confidence: rule.confidence };
      }
    }

    return { intent: 'chat', confidence: 0.5 };
  }
}
