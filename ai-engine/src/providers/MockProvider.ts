import type { AICompletionRequest, AICompletionResult, AIProvider } from '../types';

/**
 * Deterministic, no-network provider. Default for local development and tests
 * so the rest of the system can be exercised without an API key or provider cost.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const lastMessage = request.messages[request.messages.length - 1];

    return {
      content: `[mock response] You said: "${lastMessage?.content ?? ''}"`,
      model: 'mock-1',
      provider: this.name,
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
