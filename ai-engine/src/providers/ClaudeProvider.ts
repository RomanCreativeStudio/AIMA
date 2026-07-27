import Anthropic from '@anthropic-ai/sdk';
import type { AICompletionRequest, AICompletionResult, AIProvider } from '../types';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 1024;

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');

    return {
      content: textBlock && textBlock.type === 'text' ? textBlock.text : '',
      model: response.model,
      provider: this.name,
      stopReason: response.stop_reason ?? undefined,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  }
}
