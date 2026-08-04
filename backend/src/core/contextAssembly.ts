import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { MemoryRecord, RankedMemoryResult } from '../memory/types';
import type { Preference } from '../preferences/types';
import type { Task } from '../tasks/types';
import type { AssistantProfile } from './assistantProfiles';

/** Per-snippet cap so a single long memory or document chunk can't dominate the prompt. */
const MAX_SNIPPET_CHARS = 500;

const IDENTITY =
  'You are AIMA, a personal AI operating assistant. You assist, organize, recommend, prepare, explain, ' +
  'and automate approved tasks. You never send external communication, make business decisions, or take ' +
  'irreversible actions without explicit user approval — the user always remains in control.';

/**
 * Builds the system prompt for a single AI request: identity → active
 * workspace + its effective behavior profile → structured preferences →
 * retrieved memory → retrieved documentation (docs/TECHNICAL_ARCHITECTURE.md
 * §4). Memory, documentation, and preferences are kept as separate, clearly
 * labeled sections rather than merged into one interleaved ranked list —
 * they carry different metadata and merging would need an arbitrary
 * cross-type ranking rule that isn't needed for this MVP
 * (docs/decisions/0005-knowledge-ingestion.md). Pure and synchronous so
 * it's trivially unit-testable without a database or network.
 */
export function buildSystemPrompt(
  profile: AssistantProfile,
  memories: RankedMemoryResult[],
  documentChunks: RankedDocumentChunkResult[] = [],
  preferences: Preference[] = [],
  tasks: Task[] = [],
  decisions: MemoryRecord[] = [],
): string {
  const workspaceLine = `You are currently operating in ${profile.description} ${profile.responseInstructions}`;

  const preferenceSection =
    preferences.length === 0
      ? null
      : `Workspace preferences to follow:\n${preferences
          .map((preference, index) => `${index + 1}. [${preference.category}] ${preference.key}: ${preference.value}`)
          .join('\n')}`;

  const memorySection =
    memories.length === 0
      ? 'No relevant stored memory was found for this request.'
      : `Relevant memory for this workspace:\n${memories
          .map((memory, index) => `${index + 1}. (${memory.scope}) ${truncate(memory.content, MAX_SNIPPET_CHARS)}`)
          .join('\n')}`;

  const documentSection =
    documentChunks.length === 0
      ? null
      : `Relevant documentation for this workspace:\n${documentChunks
          .map((chunk, index) => {
            const label = [chunk.documentTitle ?? 'Untitled document', chunk.section].filter(Boolean).join(' — ');
            return `${index + 1}. [${label}] ${truncate(chunk.content, MAX_SNIPPET_CHARS)}`;
          })
          .join('\n')}`;

  const taskSection =
    tasks.length === 0
      ? null
      : `Open tasks for this workspace (overdue ones ranked first):\n${tasks
          .map((task, index) => `${index + 1}. [${task.priority}] ${task.title}${task.dueDate ? ` (due ${task.dueDate})` : ''}`)
          .join('\n')}`;

  const decisionSection =
    decisions.length === 0
      ? null
      : `Recent decisions for this workspace:\n${decisions
          .map((decision, index) => `${index + 1}. ${truncate(decision.content, MAX_SNIPPET_CHARS)}`)
          .join('\n')}`;

  return [IDENTITY, workspaceLine, preferenceSection, memorySection, documentSection, taskSection, decisionSection]
    .filter((section) => section !== null)
    .join('\n\n');
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
