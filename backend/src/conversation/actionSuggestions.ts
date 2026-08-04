import type { ActionCandidate, MemoryCandidate, MemoryCandidateCategory } from '@aima/ai-engine';
import { matchOpenTask } from '../insights/taskAnalysis';
import type { Task } from '../tasks/types';

/**
 * Conversation → Action sprint: the five categories the sprint asks
 * `sendMessage` to detect. `todo`/`follow_up`/`meeting` come from the new
 * `ActionDetector`; `reminder`/`decision` are NOT re-detected here — they
 * reuse the exact `MemoryCandidate`s `sendMessage` already computes via
 * `MemoryExtractor` (see `buildActionSuggestions` below), avoiding a second
 * regex pass over the same phrasing. Executive Assistant Loop sprint adds
 * `completed_task` (also reused from `MemoryExtractor`) and
 * `blocked`/`postponed`/`delegated` (from the `ActionDetector`'s new rules).
 */
export type ActionSuggestionCategory =
  | 'todo'
  | 'follow_up'
  | 'reminder'
  | 'meeting'
  | 'decision'
  | 'completed_task'
  | 'blocked'
  | 'postponed'
  | 'delegated';

export interface ActionSuggestion {
  content: string;
  category: ActionSuggestionCategory;
  confidence: number;
  reason: string;
  /**
   * Executive Assistant Loop sprint: the open task `content` most likely
   * refers to (keyword-overlap match via `taskAnalysis.ts#matchOpenTask`) —
   * populated only for the 4 task-referencing categories (`completed_task`/
   * `blocked`/`postponed`/`delegated`). Always `null` for `todo`/
   * `follow_up`/`meeting`/`reminder`/`decision`, which propose something new
   * rather than referencing an existing task, and for a task-referencing
   * category with no keyword-matching open task.
   */
  matchedTaskId: string | null;
}

/** The `MemoryCandidate` categories folded into `ActionSuggestion`s rather than re-detected. */
const REUSED_MEMORY_CATEGORIES: ReadonlySet<MemoryCandidateCategory> = new Set([
  'reminder',
  'decision',
  'completed_task',
]);

/** Categories that reference an existing open task rather than proposing a new one — see `matchOpenTask`. */
const TASK_REFERENCING_CATEGORIES: ReadonlySet<ActionSuggestionCategory> = new Set([
  'completed_task',
  'blocked',
  'postponed',
  'delegated',
]);

/**
 * Combines the `ActionDetector`'s todo/follow_up/meeting/blocked/postponed/
 * delegated candidates with the reminder/decision/completed_task candidates
 * `ConversationService.sendMessage` already extracted via `MemoryExtractor`
 * for this same turn — one extraction pass per concern, not two. `decision`
 * suggestions are included for API transparency (mirroring
 * `memorySuggestions`' "report everything detected" posture) even though a
 * wired-in `MemoryService` already silently auto-saves them (Personal
 * Workspace Memory sprint); the Chat UI simply doesn't render an Accept/
 * Dismiss card for that category since there is nothing left to accept.
 *
 * Deduplicates by normalized (trimmed, lowercased) content across the two
 * independent sources, first match wins — the same phrase should never be
 * offered twice just because two different rules happened to match it.
 *
 * `openTasks` (defaulting to `[]` so every pre-existing call site keeps
 * compiling) is used only to resolve `matchedTaskId` for the 4
 * task-referencing categories via `matchOpenTask` — no duplicate matching
 * logic, the same keyword-overlap heuristic `groupRelatedTasks` already
 * uses for task-to-task relatedness.
 */
export function buildActionSuggestions(
  actionCandidates: readonly ActionCandidate[],
  memoryCandidates: readonly MemoryCandidate[],
  openTasks: readonly Task[] = [],
): ActionSuggestion[] {
  const combined: Array<Omit<ActionSuggestion, 'matchedTaskId'>> = actionCandidates.map((candidate) => ({
    content: candidate.content,
    category: candidate.category,
    confidence: candidate.confidence,
    reason: candidate.reason,
  }));

  for (const candidate of memoryCandidates) {
    if (!REUSED_MEMORY_CATEGORIES.has(candidate.category)) {
      continue;
    }
    combined.push({
      content: candidate.content,
      category: candidate.category as 'reminder' | 'decision' | 'completed_task',
      confidence: candidate.confidence,
      reason: candidate.reason,
    });
  }

  const seen = new Set<string>();
  const deduped: ActionSuggestion[] = [];
  for (const suggestion of combined) {
    const key = suggestion.content.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...suggestion,
      matchedTaskId: TASK_REFERENCING_CATEGORIES.has(suggestion.category)
        ? (matchOpenTask(suggestion.content, openTasks)?.id ?? null)
        : null,
    });
  }

  return deduped;
}
