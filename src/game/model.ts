/** A chat message in the OpenAI-style format every supported provider speaks. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  /** dm: the Dungeon Master; companion: a companion's full turn; helper: small bookkeeping calls. */
  role: 'dm' | 'companion' | 'helper';
  messages: ChatMessage[];
  /** Ask for a single JSON object back. */
  json: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** Anything that turns messages into text: Groq, Ollama, a hosted model, or a scripted fake in tests. */
export interface ModelClient {
  complete(request: CompletionRequest): Promise<string>;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  dmModel: string;
  companionModel: string;
  helperModel: string;
}

export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig {
  const apiKey = env.LLM_API_KEY ?? env.GROQ_API_KEY ?? '';
  return {
    baseUrl: (env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    apiKey,
    dmModel: env.DM_MODEL ?? 'openai/gpt-oss-120b',
    companionModel: env.COMPANION_MODEL ?? env.DM_MODEL ?? 'openai/gpt-oss-120b',
    helperModel: env.HELPER_MODEL ?? 'openai/gpt-oss-20b',
  };
}

export class ModelError extends Error {}

/** Talks to any OpenAI-compatible /chat/completions endpoint (Groq, Ollama, LM Studio, OpenRouter...). */
export class OpenAICompatibleClient implements ModelClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async complete(request: CompletionRequest): Promise<string> {
    const model = request.role === 'dm' ? this.config.dmModel : request.role === 'companion' ? this.config.companionModel : this.config.helperModel;
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? (request.role === 'helper' ? 0.2 : 0.9),
      // Free tiers count this reservation against tokens-per-minute, so keep it no bigger than a turn needs.
      max_completion_tokens: request.maxTokens ?? (request.role === 'helper' ? 512 : 1024),
    };
    if (request.json) body.response_format = { type: 'json_object' };
    // gpt-oss models think before answering; low effort keeps turns fast.
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    let res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    // Rate limited (e.g. Groq's free tier tokens-per-minute): wait as long as the provider asks, then try again.
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
      const wait = retryAfterMs(res.headers.get('retry-after'), await res.clone().text().catch(() => ''));
      if (wait > 60_000) break;
      await this.sleep(wait);
      res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    if (res.status === 429) throw new ModelError('The model provider is rate limiting us (too many tokens this minute). Wait a moment and try again.');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ModelError(`Model call failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ModelError('Model returned an empty reply');
    return content;
  }
}

/** How long a 429 asks us to wait: the Retry-After header, or Groq's "try again in 4.9s" / "1m2.5s" text. */
export function retryAfterMs(header: string | null, body: string): number {
  const fromHeader = Number(header);
  if (header && Number.isFinite(fromHeader)) return Math.ceil(fromHeader * 1000) + 250;
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(body);
  if (m) {
    const minutes = Number(m[1] ?? 0);
    const amount = Number(m[2]);
    return Math.ceil(minutes * 60_000 + (m[3] === 'ms' ? amount : amount * 1000)) + 250;
  }
  return 5_000;
}

/** Pulls the first JSON object out of a reply, tolerating code fences or stray text around it. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new ModelError('Reply contained no JSON object');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new ModelError(`Reply was not valid JSON: ${(e as Error).message}`);
  }
}
