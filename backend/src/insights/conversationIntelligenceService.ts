import type { AIProvider } from '@aima/ai-engine';
import type { ConversationService } from '../conversation/conversationService';
import type { MemoryService } from '../memory/memoryService';
import type { ConversationIntelligence } from './types';

const DEFAULT_CONTEXT_LIMIT = 10;
const DEFAULT_RELATED_MEMORY_LIMIT = 5;
const DEFAULT_FOLLOW_UP_LIMIT = 3;

export interface ConversationIntelligenceOptions {
  contextLimit?: number;
  relatedMemoryLimit?: number;
}

/**
 * Conversation Intelligence (Phase 2.5, item 3): a summary and suggested
 * follow-ups for one conversation's recent turns, plus the recent context
 * and related memories that grounded them. Unlike Task Intelligence, this
 * genuinely needs the AI provider — "what should I ask next" has no
 * deterministic substitute. Read-only: no message is created, no memory is
 * written, nothing here feeds back into the conversation itself.
 */
export class ConversationIntelligenceService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly memoryService: MemoryService,
    private readonly aiProvider: AIProvider,
  ) {}

  async analyze(
    workspaceId: string,
    conversationId: string,
    options: ConversationIntelligenceOptions = {},
  ): Promise<ConversationIntelligence> {
    const recentContext = await this.conversationService.listMessages(
      workspaceId,
      conversationId,
      options.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    );

    const generatedAt = new Date().toISOString();

    if (recentContext.length === 0) {
      return { workspaceId, conversationId, summary: '', suggestedFollowUps: [], recentContext: [], relatedMemories: [], generatedAt };
    }

    const transcript = recentContext.map((message) => `${message.role}: ${message.content}`).join('\n');
    const lastUserMessage =
      [...recentContext].reverse().find((message) => message.role === 'user')?.content ??
      recentContext[recentContext.length - 1].content;

    const [summaryCompletion, followUpCompletion, relatedMemories] = await Promise.all([
      this.aiProvider.complete({
        messages: [{ role: 'user', content: `Summarize this conversation in 1-2 sentences:\n${transcript}` }],
        systemPrompt: 'You write short, neutral summaries of a workspace conversation.',
      }),
      this.aiProvider.complete({
        messages: [
          { role: 'user', content: `Suggest up to ${DEFAULT_FOLLOW_UP_LIMIT} short follow-up questions or actions based on this conversation, one per line:\n${transcript}` },
        ],
        systemPrompt: 'You suggest brief, actionable follow-ups for a workspace owner. One per line, no numbering.',
      }),
      this.memoryService.getWorkspaceContext(workspaceId, lastUserMessage, options.relatedMemoryLimit ?? DEFAULT_RELATED_MEMORY_LIMIT),
    ]);

    return {
      workspaceId,
      conversationId,
      summary: summaryCompletion.content,
      suggestedFollowUps: parseFollowUps(followUpCompletion.content),
      recentContext,
      relatedMemories,
      generatedAt,
    };
  }
}

/** Splits the AI's newline-separated follow-up suggestions, strips leading "- "/"1. " list markers, and caps at DEFAULT_FOLLOW_UP_LIMIT. */
function parseFollowUps(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.replace(/^[\s\-*]*\d*[.)]?\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, DEFAULT_FOLLOW_UP_LIMIT);
}
