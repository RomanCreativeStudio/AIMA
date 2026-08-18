import type { MemoryCandidate, MemoryCandidateCategory, MemoryExtractor } from './types';

interface ExtractionRule {
  category: MemoryCandidateCategory;
  pattern: RegExp;
  confidence: number;
  reason: string;
}

/**
 * Static per-category importance — this rule-based extractor has no signal
 * beyond "which phrasing matched," so importance is a fixed default per
 * category rather than a fabricated per-instance number. A future
 * model-based extractor could produce genuinely independent importance
 * scores without any caller changing (same `MemoryExtractor` interface).
 */
const DEFAULT_IMPORTANCE: Record<MemoryCandidateCategory, number> = {
  fact: 0.7,
  preference: 0.6,
  completed_task: 0.6,
  decision: 0.75,
  reminder: 0.8,
  project_update: 0.65,
};

/**
 * Checked in order; every matching rule produces a candidate (unlike
 * `RuleBasedIntentClassifier`'s first-match-wins, a single message can
 * plausibly contain more than one fact/preference worth surfacing).
 * Deliberately simple pattern matching — no AI call, no network, no cost —
 * the same "explainable, testable, no hidden behavior" reasoning
 * `RuleBasedIntentClassifier` established (docs/decisions/
 * 0004-intent-and-approval-engine.md).
 */
const RULES: ExtractionRule[] = [
  {
    category: 'fact',
    pattern: /\bmy name is [^.?!]+/i,
    confidence: 0.95,
    reason: 'Matched "my name is ..." fact phrasing',
  },
  {
    category: 'fact',
    pattern: /\bremember that [^.?!]+/i,
    confidence: 0.9,
    reason: 'Matched "remember that ..." fact phrasing',
  },
  {
    category: 'fact',
    pattern: /\bdon'?t forget (?:that )?[^.?!]+/i,
    confidence: 0.85,
    reason: 'Matched "don\'t forget ..." fact phrasing',
  },
  {
    category: 'fact',
    pattern: /\bnote that [^.?!]+/i,
    confidence: 0.85,
    reason: 'Matched "note that ..." fact phrasing',
  },
  {
    category: 'preference',
    pattern: /\bi prefer [^.?!]+/i,
    confidence: 0.8,
    reason: 'Matched "I prefer ..." preference phrasing',
  },
  {
    category: 'preference',
    pattern: /\bi always [^.?!]+/i,
    confidence: 0.75,
    reason: 'Matched "I always ..." preference phrasing',
  },
  {
    category: 'preference',
    pattern: /\bi never [^.?!]+/i,
    confidence: 0.75,
    reason: 'Matched "I never ..." preference phrasing',
  },
  {
    category: 'preference',
    pattern: /\bi (?:don'?t|do not) like [^.?!]+/i,
    confidence: 0.6,
    reason: 'Matched "I don\'t like ..." preference phrasing',
  },
  {
    category: 'preference',
    pattern: /\bi (?:really )?like [^.?!]+/i,
    confidence: 0.55,
    reason: 'Matched "I like ..." preference phrasing',
  },
  // Personal Workspace Memory sprint: four new categories, matching the outcomes
  // ConversationService auto-saves (see its AUTO_SAVE_CATEGORIES) rather than
  // leaving advisory-only.
  {
    category: 'completed_task',
    pattern: /\bi(?:'ve| have) (?:just )?(?:finished|completed) [^.?!]+/i,
    confidence: 0.85,
    reason: 'Matched "I\'ve finished/completed ..." completed-task phrasing',
  },
  {
    category: 'completed_task',
    pattern: /\bdone with [^.?!]+/i,
    confidence: 0.7,
    reason: 'Matched "done with ..." completed-task phrasing',
  },
  {
    category: 'decision',
    pattern: /\b(?:we|i)(?:'ve| have)? decided (?:to|that) [^.?!]+/i,
    confidence: 0.85,
    reason: 'Matched "decided to/that ..." decision phrasing',
  },
  {
    category: 'decision',
    pattern: /\blet'?s go with [^.?!]+/i,
    confidence: 0.7,
    reason: 'Matched "let\'s go with ..." decision phrasing',
  },
  {
    category: 'reminder',
    pattern: /\bremind me to [^.?!]+/i,
    confidence: 0.9,
    reason: 'Matched "remind me to ..." reminder phrasing',
  },
  {
    category: 'project_update',
    pattern: /\b(?:project|status) update:? [^.?!]+/i,
    confidence: 0.75,
    reason: 'Matched "project/status update: ..." phrasing',
  },
];

export class RuleBasedMemoryExtractor implements MemoryExtractor {
  readonly name = 'rule-based';

  extract(text: string): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (!match) {
        continue;
      }
      candidates.push({
        content: match[0].trim(),
        category: rule.category,
        importance: DEFAULT_IMPORTANCE[rule.category],
        confidence: rule.confidence,
        reason: rule.reason,
      });
    }

    return candidates;
  }
}
