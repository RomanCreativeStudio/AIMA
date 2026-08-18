import type { AIProvider } from '@aima/ai-engine';
import type { ApprovalEngine } from '../approval/approvalEngine';
import type { ApprovalDecision } from '../approval/types';
import type { Message } from '../conversation/types';
import { INTENT_CAPABILITY_MAP } from '../intent/intentCapabilityMap';
import type { IntentAnalysis } from '../intent/types';
import type { IntentEngine } from '../intent/intentEngine';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { WorkspaceSlug } from '../types/workspace';
import { buildEffectiveProfile } from './assistantProfiles';
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
  /**
   * The real approval lifecycle decision for the intent's mapped capability
   * (docs/decisions/0007-intent-and-approval-workflows.md) — distinct from
   * `intent.approval`, which is only an advisory "would this need approval"
   * flag. When the mapped capability is Tier 3, this is backed by an actual
   * pending_approvals row (created via ApprovalEngine); otherwise it's
   * `{ state: 'no_approval_needed' }` with no database write.
   */
  approvalDecision: ApprovalDecision;
}

/**
 * The AIMA Core Service (Phase 1.6) — the coordinator that connects every
 * AIMA capability for a single request (docs/TECHNICAL_ARCHITECTURE.md §4):
 *
 *   Determine which workspace is active and load its configuration
 *   (WorkspaceService) → gather memory/document/preference context
 *   (ContextManager) → detect intent (IntentEngine) → evaluate whether the
 *   detected intent's capability needs real approval (ApprovalEngine) →
 *   build the effective assistant profile (static per-slug default +
 *   workspace-specific instructions/behavior, Phase 1.8) → build the AI
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
    private readonly approvalEngine: ApprovalEngine,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async handleRequest(request: AimaRequest): Promise<AimaResponse> {
    const [context, intent, workspace] = await Promise.all([
      this.contextManager.gatherContext(
        request.workspaceId,
        request.workspaceSlug,
        request.query,
        request.history,
        request.limits,
      ),
      this.intentEngine.analyze(request.query),
      this.workspaceService.getWorkspace(request.workspaceId),
    ]);

    const profile = buildEffectiveProfile(workspace);
    const systemPrompt = buildSystemPrompt(
      profile,
      context.memories,
      context.documentChunks,
      context.preferences,
      context.tasks,
      context.decisions,
    );
    const capability = INTENT_CAPABILITY_MAP[intent.intent];

    const [completion, approvalDecision] = await Promise.all([
      this.aiProvider.complete({
        systemPrompt,
        messages: context.history.map((message) => ({ role: message.role, content: message.content })),
      }),
      capability
        ? this.approvalEngine.evaluate(request.workspaceId, capability, intent.parameters)
        : Promise.resolve<ApprovalDecision>({ state: 'no_approval_needed' }),
    ]);

    return {
      content: completion.content,
      provider: completion.provider,
      model: completion.model,
      context,
      intent,
      approvalDecision,
    };
  }
}
