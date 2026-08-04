import type { ActionCandidate, ActionCandidateCategory, ActionDetector } from './types';

interface DetectionRule {
  category: ActionCandidateCategory;
  pattern: RegExp;
  confidence: number;
  reason: string;
}

/**
 * Checked in order; every matching rule produces a candidate (mirrors
 * `RuleBasedMemoryExtractor`'s "every match counts" posture, not
 * `RuleBasedIntentClassifier`'s first-match-wins). Deliberately simple
 * pattern matching — no AI call, no network, no cost — the same
 * "explainable, testable, no hidden behavior" reasoning `RuleBasedMemoryExtractor`
 * established.
 */
const RULES: DetectionRule[] = [
  {
    category: 'todo',
    pattern: /\bi need to [^.?!]+/i,
    confidence: 0.75,
    reason: 'Matched "I need to ..." todo phrasing',
  },
  {
    category: 'todo',
    pattern: /\bi have to [^.?!]+/i,
    confidence: 0.7,
    reason: 'Matched "I have to ..." todo phrasing',
  },
  {
    category: 'todo',
    pattern: /\btodo:?\s+[^.?!]+/i,
    confidence: 0.85,
    reason: 'Matched "todo: ..." phrasing',
  },
  {
    category: 'follow_up',
    pattern: /\bfollow up (?:on|with) [^.?!]+/i,
    confidence: 0.8,
    reason: 'Matched "follow up on/with ..." phrasing',
  },
  {
    category: 'follow_up',
    pattern: /\bcircle back (?:on|with|to) [^.?!]+/i,
    confidence: 0.75,
    reason: 'Matched "circle back ..." phrasing',
  },
  {
    category: 'meeting',
    pattern: /\b(?:let'?s |we should )?schedule a (?:meeting|call)[^.?!]*/i,
    confidence: 0.8,
    reason: 'Matched "schedule a meeting/call ..." phrasing',
  },
  {
    category: 'meeting',
    pattern: /\blet'?s meet [^.?!]+/i,
    confidence: 0.7,
    reason: 'Matched "let\'s meet ..." phrasing',
  },
];

export class RuleBasedActionDetector implements ActionDetector {
  readonly name = 'rule-based';

  detect(text: string): ActionCandidate[] {
    const candidates: ActionCandidate[] = [];

    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (!match) {
        continue;
      }
      candidates.push({
        content: match[0].trim(),
        category: rule.category,
        confidence: rule.confidence,
        reason: rule.reason,
      });
    }

    return candidates;
  }
}
