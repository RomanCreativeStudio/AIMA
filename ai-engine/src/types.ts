export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface AICompletionRequest {
  /** Conversation turns, oldest first. Does not include the system prompt. */
  messages: AIMessage[];
  /** Assembled by ai-engine's context layer: identity, active workspace rules, retrieved memory/knowledge. */
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AICompletionUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AICompletionResult {
  content: string;
  /** The underlying model identifier reported by the provider (e.g. "claude-sonnet-5"). */
  model: string;
  /** The provider that served this request (e.g. "claude", "mock"). */
  provider: string;
  stopReason?: string;
  usage?: AICompletionUsage;
}

/**
 * Every AI provider AIMA can talk to implements this interface. Nothing outside
 * ai-engine/src/providers may depend on a specific provider's SDK or API shape —
 * callers only ever see AIProvider (see docs/TECHNICAL_ARCHITECTURE.md §4).
 */
export interface AIProvider {
  readonly name: string;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}
