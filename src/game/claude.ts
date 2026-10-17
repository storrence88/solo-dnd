import Anthropic from '@anthropic-ai/sdk';
import { ModelError, type CompletionRequest, type ModelClient } from './model';

export type Effort = 'low' | 'medium' | 'high';

export interface ClaudeConfig {
  apiKey: string;
  dmModel: string;
  companionModel: string;
  helperModel: string;
  /** How hard the models think before answering. Low keeps turns quick and cheap. */
  effort: Effort;
}

/** Talks to Claude through Anthropic's own API. */
export class ClaudeClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(
    private readonly config: ClaudeConfig,
    client?: Anthropic,
  ) {
    // One quick retry: if Claude is struggling, the fallback provider is the better bet.
    this.client = client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: 1, timeout: 90_000 });
  }

  async complete(request: CompletionRequest): Promise<string> {
    const model = request.role === 'dm' ? this.config.dmModel : request.role === 'companion' ? this.config.companionModel : this.config.helperModel;
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages: Anthropic.MessageParam[] = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        // Room for thinking as well as the reply; the prompts already ask for short JSON.
        max_tokens: request.maxTokens ?? (request.role === 'helper' ? 2048 : 4096),
        // The rules and scene at the top of every prompt rarely change, so later calls read them from cache.
        ...(system ? { system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] } : {}),
        output_config: { effort: this.config.effort },
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ModelError('Claude is rate limiting us (too many requests this minute). Wait a moment and try again.');
      if (e instanceof Anthropic.APIError) throw new ModelError(`Claude call failed (${e.status ?? 'network'}): ${e.message.slice(0, 300)}`);
      throw e;
    }
    if (response.stop_reason === 'refusal') throw new ModelError('Claude declined to answer this one');
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!text.trim()) throw new ModelError('Claude returned an empty reply');
    return text;
  }
}

/**
 * Uses the primary provider, and the backup whenever the primary fails (down, out of credits,
 * rate limited, declined). After a failure the primary sits out for a while, so a dead provider
 * doesn't slow every call down.
 */
export class FallbackClient implements ModelClient {
  private resumeAt = 0;

  constructor(
    private readonly primary: ModelClient,
    private readonly backup: ModelClient,
    private readonly opts: { cooldownMs?: number; now?: () => number; onFallback?: (error: Error) => void } = {},
  ) {}

  async complete(request: CompletionRequest): Promise<string> {
    const now = this.opts.now ?? Date.now;
    if (now() >= this.resumeAt) {
      try {
        return await this.primary.complete(request);
      } catch (e) {
        this.resumeAt = now() + (this.opts.cooldownMs ?? 60_000);
        this.opts.onFallback?.(e as Error);
      }
    }
    return this.backup.complete(request);
  }
}
