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
    intent: 'search_documents',
    patterns: [
      /\bsearch (?:the )?docs?\b/,
      /\bsearch (?:the )?documents?\b/,
      /\bsearch (?:the )?knowledge base\b/,
      /\bfind .+ in (?:the )?docs?\b/,
      /\bfind .+ in (?:the )?documents?\b/,
      /\blook up .+ in (?:the )?(?:docs?|documents?)\b/,
    ],
    confidence: 0.85,
  },
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
    intent: 'draft_proposal',
    patterns: [
      /\bdraft\s+(a\s+|an\s+)?proposal\b/,
      /\bwrite\s+(a\s+|an\s+)?proposal\b/,
      /\bcreate\s+(a\s+|an\s+)?proposal\b/,
      /\bput together\s+(a\s+|an\s+)?proposal\b/,
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

/**
 * Best-effort slot extraction, run only after an intent has already been
 * decided by RULES above. Each entry tries its trigger patterns in order —
 * first one that leaves a non-empty remainder wins — and returns whatever
 * text follows the trigger as the named parameter. No NLP, just "the rest
 * of the sentence after the keyword," which is enough for an MVP where the
 * AI provider (not this classifier) does the real reasoning over the
 * extracted value. A lazy `.*?` before a closing keyword (e.g. `about`) lets
 * a pattern skip over a recipient/target clause of any length.
 */
const PARAM_EXTRACTORS: Partial<Record<Intent, { key: string; after: RegExp[] }>> = {
  remember: {
    key: 'content',
    after: [/\bremember that\b/, /\bdon'?t forget\b/, /\bkeep in mind\b/, /\bnote that\b/, /\bplease remember\b/],
  },
  create_task: {
    key: 'title',
    after: [/\bremind me to\b/, /\b(?:create|add|make)\s+(?:a\s+)?task(?:\s+to)?\b/, /\bto-?do\b/],
  },
  draft_email: {
    key: 'topic',
    after: [/\b(?:draft|write|compose)\s+(?:an?\s+)?email\b.*?\babout\b/, /\b(?:draft|write|compose)\s+(?:an?\s+)?email\b/],
  },
  draft_proposal: {
    key: 'topic',
    after: [
      /\b(?:draft|write|create|put together)\s+(?:a\s+|an\s+)?proposal\b.*?\b(?:for|about)\b/,
      /\b(?:draft|write|create|put together)\s+(?:a\s+|an\s+)?proposal\b/,
    ],
  },
  summarize: {
    key: 'subject',
    after: [/\bsummarize\b/],
  },
  search_memory: {
    key: 'query',
    after: [
      /\bdo (?:you|i) remember\b/,
      /\bwhat do (?:you|i) (?:know|remember)\b/,
      /\bwhat did (?:i|we) (?:say|tell you)\b/,
      /\bsearch (?:my )?memor(?:y|ies)\b/,
      /\brecall\b/,
    ],
  },
  search_documents: {
    key: 'query',
    after: [
      /\bsearch (?:the )?(?:docs?|documents?|knowledge base)\s+for\b/,
      /\bsearch (?:the )?(?:docs?|documents?|knowledge base)\b/,
      /\bfind\b/,
      /\blook up\b/,
    ],
  },
};

function extractParameters(intent: Intent, text: string): Record<string, string> {
  const extractor = PARAM_EXTRACTORS[intent];
  if (!extractor) {
    return {};
  }

  for (const pattern of extractor.after) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }

    const remainder = text.slice(match.index + match[0].length).trim();
    const cleaned = remainder
      .replace(/^(?:that|to|about|for)\s+/, '')
      .replace(/\s+in (?:the )?(?:docs?|documents?)\s*$/, '')
      .replace(/[.?!]+$/, '')
      .trim();

    if (cleaned.length > 0) {
      return { [extractor.key]: cleaned };
    }
  }

  return {};
}

export class RuleBasedIntentClassifier implements IntentClassifier {
  readonly name = 'rule-based';

  async classify(message: string): Promise<IntentDetectionResult> {
    const trimmed = message.trim();

    if (trimmed.length === 0) {
      return { intent: 'unknown', confidence: 0, parameters: {} };
    }

    const text = trimmed.toLowerCase();

    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(text))) {
        return { intent: rule.intent, confidence: rule.confidence, parameters: extractParameters(rule.intent, text) };
      }
    }

    return { intent: 'chat', confidence: 0.5, parameters: {} };
  }
}
