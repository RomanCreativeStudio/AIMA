import type { Message } from '../conversation/types';
import type { RankedDocumentChunkResult } from '../knowledge/types';
import type { RankedMemoryResult } from '../memory/types';
import type { Preference } from '../preferences/types';
import type { WorkspaceSlug } from '../types/workspace';

/** The Unified Context Manager's output (Phase 1.6): everything gathered for one AI request. */
export interface UnifiedContext {
  workspaceSlug: WorkspaceSlug;
  /** Recent conversation turns, oldest first, already capped by the caller (a persistence concern). */
  history: Message[];
  memories: RankedMemoryResult[];
  documentChunks: RankedDocumentChunkResult[];
  /** All structured preferences for the workspace (Phase 1.8) — small and curated, so unlike memory/documents this is never limit-capped. */
  preferences: Preference[];
}

export interface ContextLimits {
  /** Max memory records retrieved (a context limit — count-based, not token-based). */
  memoryLimit?: number;
  /** Max document chunks retrieved (a context limit). */
  documentLimit?: number;
}
