import type { AIProvider } from '@aima/ai-engine';
import type { Message } from '../conversation/types';
import type { IntentAnalysis } from '../intent/types';
import type { IntentEngine } from '../intent/intentEngine';
import type { WorkspaceSlug } from '../types/workspace';
import { getAssistantProfile } from './assistantProfiles';
import { buildSystemPrompt } from './contextAssembly';
import type { ContextManager } from './contextManager';
import type { ContextLimits, UnifiedContext } from './types';

export interface AimaRequest {
  workspaceId: string;
  workspaceSlug: WorkspaceSlug;
  /** The user's current message. */
  query: string;
  /** Recent conversation turns, oldest first, already including the current turn — a persistence concern owned by the caller. */
  history: Message[];
  limits?: ContextLimits;
}

export interface AimaResponse {
  content: string;
  provider: string;
  model: string;
  context: UnifiedContext;
  intent: IntentAnalysis;
}

/**
 * The AIMA Core Service (Phase 1.6) — the coordinator that connects every
 * AIMA capability for a single request (docs/TECHNICAL_ARCHITECTURE.md §4):
 *
 *   Determine workspace context (assistant profile) → gather memory/document
 *   context (ContextManager) → detect intent (IntentEngine) → build the AI
 *   context (contextAssembly) → call the AI provider → return a structured
 *   response.
 *
 * Deliberately does not own persistence, workspace-isolation checks, or
 * action logging — those stay with ConversationService (which validates
 * the conversation belongs to the workspace and saves messages) so this
 * service can be reused by anything that needs "ask AIMA something,
 * workspace-aware" without needing a persisted conversation.
 */
export class AimaCoreService {
  constructor(
    private readonly contextManager: ContextManager,
    private readonly aiProvider: AIProvider,
    private readonly intentEngine: IntentEngine,
  ) {}

  async handleRequest(request: AimaRequest): Promise<AimaResponse> {
    const [context, intent] = await Promise.all([
      this.contextManager.gatherContext(
        request.workspaceId,
        request.workspaceSlug,
        request.query,
        request.history,
        request.limits,
      ),
      this.intentEngine.analyze(request.query),
    ]);

    const profile = getAssistantProfile(request.workspaceSlug);
    const systemPrompt = buildSystemPrompt(profile, context.memories, context.documentChunks);

    const completion = await this.aiProvider.complete({
      systemPrompt,
      messages: context.history.map((message) => ({ role: message.role, content: message.content })),
    });

    return {
      content: completion.content,
      provider: completion.provider,
      model: completion.model,
      context,
      intent,
    };
  }
}
