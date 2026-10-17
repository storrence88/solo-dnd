import { describe, expect, it } from 'vitest';
import { OpenAICompatibleClient, parseJsonObject, providerConfigFromEnv, retryAfterMs } from './model';

describe('provider config', () => {
  it('defaults to Groq and accepts either key name', () => {
    const groq = providerConfigFromEnv({ GROQ_API_KEY: 'k1' });
    expect(groq).toEqual({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k1', dmModel: 'openai/gpt-oss-120b', helperModel: 'openai/gpt-oss-20b' });
    const local = providerConfigFromEnv({ LLM_API_KEY: 'k2', LLM_BASE_URL: 'http://localhost:11434/v1/', DM_MODEL: 'qwen3:32b' });
    expect(local).toMatchObject({ baseUrl: 'http://localhost:11434/v1', apiKey: 'k2', dmModel: 'qwen3:32b' });
  });
});

describe('OpenAICompatibleClient', () => {
  const config = providerConfigFromEnv({ GROQ_API_KEY: 'secret' });

  it('sends the model, JSON mode, low reasoning and the key, and returns the content', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new OpenAICompatibleClient(config, fakeFetch);
    const out = await client.complete({ role: 'helper', messages: [{ role: 'user', content: 'hi' }], json: true });
    expect(out).toBe('{"ok":true}');
    expect(seen!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ model: 'openai/gpt-oss-20b', response_format: { type: 'json_object' }, reasoning_effort: 'low', temperature: 0.2 });
  });

  it('reports HTTP errors', async () => {
    const fakeFetch = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const client = new OpenAICompatibleClient(config, fakeFetch);
    await expect(client.complete({ role: 'dm', messages: [], json: true })).rejects.toThrow(/401.*bad key/);
  });

  it('waits out a rate limit and tries again', async () => {
    let calls = 0;
    const waits: number[] = [];
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) return new Response('{"error":{"message":"Rate limit reached ... Please try again in 4.935s."}}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new OpenAICompatibleClient(config, fakeFetch, async (ms) => { waits.push(ms); });
    expect(await client.complete({ role: 'dm', messages: [], json: true })).toBe('ok');
    expect(waits).toEqual([5185]);
  });

  it('gives a plain message when the rate limit does not clear', async () => {
    const fakeFetch = (async () => new Response('try again in 1s', { status: 429 })) as unknown as typeof fetch;
    const client = new OpenAICompatibleClient(config, fakeFetch, async () => {});
    await expect(client.complete({ role: 'dm', messages: [], json: true })).rejects.toThrow(/rate limiting/);
  });

  it('reads waits from headers and Groq messages', () => {
    expect(retryAfterMs('2', '')).toBe(2250);
    expect(retryAfterMs(null, 'Please try again in 1m2.5s.')).toBe(62750);
    expect(retryAfterMs(null, 'try again in 300ms')).toBe(550);
    expect(retryAfterMs(null, 'nothing useful')).toBe(5000);
  });
});

describe('parseJsonObject', () => {
  it('tolerates code fences and stray text', () => {
    expect(parseJsonObject('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonObject('no json here')).toThrow();
  });
});
