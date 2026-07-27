import type { Message } from '../conversation/types';
import type { DocumentService } from '../knowledge/documentService';
import type { MemoryService } from '../memory/memoryService';
import type { WorkspaceSlug } from '../types/workspace';
import type { ContextLimits, UnifiedContext } from './types';

const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_DOCUMENT_LIMIT = 5;

/**
 * The Unified Context Manager (Phase 1.6): combines conversation history,
 * memory, and document context for one AI request, with configurable
 * limits on each. Extracted out of ConversationService so context
 * gathering is independently testable and reusable by anything else that
 * needs "what does AIMA currently know that's relevant to this workspace
 * and query" — not just the chat pipeline.
 *
 * History is accepted pre-fetched rather than queried here: loading and
 * capping conversation history is a persistence concern that belongs to
 * whichever service owns the `messages` table (ConversationService), not
 * to context assembly.
 */
export class ContextManager {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly documentService: DocumentService,
  ) {}

  async gatherContext(
    workspaceId: string,
    workspaceSlug: WorkspaceSlug,
    query: string,
    history: Message[],
    limits: ContextLimits = {},
  ): Promise<UnifiedContext> {
    const memoryLimit = limits.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    const documentLimit = limits.documentLimit ?? DEFAULT_DOCUMENT_LIMIT;

    const [memories, documentChunks] = await Promise.all([
      this.memoryService.getWorkspaceContext(workspaceId, query, memoryLimit),
      this.documentService.search(workspaceId, query, documentLimit),
    ]);

    return { workspaceSlug, history, memories, documentChunks };
  }
}
