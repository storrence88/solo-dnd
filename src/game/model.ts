/** A chat message in the OpenAI-style format every supported provider speaks. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  role: 'dm' | 'helper';
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
  helperModel: string;
}

export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig {
  const apiKey = env.LLM_API_KEY ?? env.GROQ_API_KEY ?? '';
  return {
    baseUrl: (env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    apiKey,
    dmModel: env.DM_MODEL ?? 'openai/gpt-oss-120b',
    helperModel: env.HELPER_MODEL ?? 'openai/gpt-oss-20b',
  };
}

export class ModelError extends Error {}

/** Talks to any OpenAI-compatible /chat/completions endpoint (Groq, Ollama, LM Studio, OpenRouter...). */
export class OpenAICompatibleClient implements ModelClient {
  constructor(private readonly config: ProviderConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(request: CompletionRequest): Promise<string> {
    const model = request.role === 'dm' ? this.config.dmModel : this.config.helperModel;
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? (request.role === 'dm' ? 0.9 : 0.2),
      max_completion_tokens: request.maxTokens ?? 2048,
    };
    if (request.json) body.response_format = { type: 'json_object' };
    // gpt-oss models think before answering; low effort keeps turns fast.
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
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
