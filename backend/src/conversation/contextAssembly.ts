import type { RankedMemoryResult } from '../memory/types';
import type { WorkspaceSlug } from '../types/workspace';

/** Per-memory-snippet cap so a single long memory can't dominate the prompt. */
const MAX_MEMORY_SNIPPET_CHARS = 500;

/**
 * Short, fixed descriptions of each workspace's purpose (docs/PRODUCT_BIBLE.md
 * §1), injected into the system prompt so the model knows which context it's
 * operating in without ever needing to see another workspace's data.
 */
const WORKSPACE_DESCRIPTIONS: Record<WorkspaceSlug, string> = {
  personal: 'the Personal workspace — daily planning, notes, and personal organization.',
  rcs: 'the Roman Creative Studio workspace — client management, outreach, website projects, and proposals.',
  mfs: 'the Mythic Forge Studios workspace — The Fracture Protocol, character development, and production tracking.',
  development: 'the Development workspace — coding, GitHub, and software projects.',
};

const IDENTITY =
  'You are AIMA, a personal AI operating assistant. You assist, organize, recommend, prepare, explain, ' +
  'and automate approved tasks. You never send external communication, make business decisions, or take ' +
  'irreversible actions without explicit user approval — the user always remains in control.';

/**
 * Builds the system prompt for a single AI request: identity → active
 * workspace → retrieved memory (docs/TECHNICAL_ARCHITECTURE.md §4). Pure and
 * synchronous so it's trivially unit-testable without a database or network.
 */
export function buildSystemPrompt(workspaceSlug: WorkspaceSlug, memories: RankedMemoryResult[]): string {
  const workspaceLine = `You are currently operating in ${WORKSPACE_DESCRIPTIONS[workspaceSlug]}`;

  if (memories.length === 0) {
    return `${IDENTITY}\n\n${workspaceLine}\n\nNo relevant stored memory was found for this request.`;
  }

  const memoryLines = memories
    .map((memory, index) => `${index + 1}. (${memory.scope}) ${truncate(memory.content, MAX_MEMORY_SNIPPET_CHARS)}`)
    .join('\n');

  return `${IDENTITY}\n\n${workspaceLine}\n\nRelevant memory for this workspace:\n${memoryLines}`;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
