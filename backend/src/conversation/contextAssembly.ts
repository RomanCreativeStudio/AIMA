import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { RankedMemoryResult } from '../memory/types';
import type { WorkspaceSlug } from '../types/workspace';

/** Per-snippet cap so a single long memory or document chunk can't dominate the prompt. */
const MAX_SNIPPET_CHARS = 500;

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
 * workspace → retrieved memory → retrieved documentation
 * (docs/TECHNICAL_ARCHITECTURE.md §4). Memory and documentation are kept as
 * two separate, clearly labeled sections rather than merged into one
 * interleaved ranked list — they carry different metadata (scope vs.
 * document/section) and merging would need an arbitrary cross-type ranking
 * rule that isn't needed for this MVP (docs/decisions/0005-knowledge-
 * ingestion.md). Pure and synchronous so it's trivially unit-testable
 * without a database or network.
 */
export function buildSystemPrompt(
  workspaceSlug: WorkspaceSlug,
  memories: RankedMemoryResult[],
  documentChunks: RankedDocumentChunkResult[] = [],
): string {
  const workspaceLine = `You are currently operating in ${WORKSPACE_DESCRIPTIONS[workspaceSlug]}`;

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

  return [IDENTITY, workspaceLine, memorySection, documentSection].filter((section) => section !== null).join('\n\n');
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
