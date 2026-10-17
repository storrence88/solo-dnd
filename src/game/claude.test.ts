import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeClient, FallbackClient } from './claude';
import type { CompletionRequest, ModelClient } from './model';
import { modelSetupFromEnv } from './providers';

const config = { apiKey: 'k', dmModel: 'claude-sonnet-5-5', companionModel: 'claude-haiku-5-5', helperModel: 'claude-haiku-5-5', effort: 'low' as const };

/** A stand-in for the Anthropic SDK that records each request and returns a scripted message. */
function fakeSdk(reply: Partial<Anthropic.Message>) {
  const sent: Record<string, unknown>[] = [];
  const sdk = { messages: { create: async (params: Record<string, unknown>) => (sent.push(params), { stop_reason: 'end_turn', content: [], ...reply }) } };
  return { sdk: sdk as unknown as Anthropic, sent };
}

const request = (role: CompletionRequest['role']): CompletionRequest => ({
  role,
  json: true,
  messages: [
    { role: 'system', content: 'You are the DM.' },
    { role: 'user', content: 'Story so far.' },
  ],
});

describe('Claude client', () => {
  it('sends the system prompt as a cached block, picks the model by role, and returns the text', async () => {
    const { sdk, sent } = fakeSdk({ content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"narration":"Hi"}', citations: null }] as Anthropic.ContentBlock[] });
    const client = new ClaudeClient(config, sdk);
    expect(await client.complete(request('dm'))).toBe('{"narration":"Hi"}');
    await client.complete(request('helper'));
    expect(sent[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: [{ type: 'text', text: 'You are the DM.', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Story so far.' }],
    });
    expect(sent[0]).not.toHaveProperty('temperature');
    expect(sent[1]!.model).toBe('claude-haiku-5-5');
  });

  it('treats a refusal or an empty reply as a failure', async () => {
    await expect(new ClaudeClient(config, fakeSdk({ stop_reason: 'refusal' }).sdk).complete(request('dm'))).rejects.toThrow(/declined/);
    await expect(new ClaudeClient(config, fakeSdk({}).sdk).complete(request('dm'))).rejects.toThrow(/empty/);
  });
});

describe('falling back', () => {
  const ok = (text: string): ModelClient => ({ complete: async () => text });
  const failing = () => {
    let calls = 0;
    return { client: { complete: async () => { calls += 1; throw new Error('Claude call failed (529): overloaded'); } } as ModelClient, calls: () => calls };
  };

  it('uses the primary while it works', async () => {
    expect(await new FallbackClient(ok('claude'), ok('groq')).complete(request('dm'))).toBe('claude');
  });

  it('switches to the backup when the primary fails, and gives the primary a rest before trying again', async () => {
    let now = 0;
    const primary = failing();
    const notes: string[] = [];
    const client = new FallbackClient(primary.client, ok('groq'), { cooldownMs: 60_000, now: () => now, onFallback: (e) => notes.push(e.message) });
    expect(await client.complete(request('dm'))).toBe('groq');
    expect(await client.complete(request('dm'))).toBe('groq');
    expect(primary.calls()).toBe(1);
    now = 61_000;
    await client.complete(request('dm'));
    expect(primary.calls()).toBe(2);
    expect(notes[0]).toMatch(/529/);
  });

  it('reports the backup\'s error when both fail', async () => {
    await expect(new FallbackClient(failing().client, { complete: async () => { throw new Error('Groq is down'); } }).complete(request('dm'))).rejects.toThrow('Groq is down');
  });
});

describe('choosing providers from .env', () => {
  it('uses Groq alone, Claude alone, or Claude with Groq behind it', () => {
    expect(modelSetupFromEnv({ GROQ_API_KEY: 'g' }).info).toEqual({ hasKey: true, provider: 'api.groq.com', dmModel: 'openai/gpt-oss-120b' });
    expect(modelSetupFromEnv({ ANTHROPIC_API_KEY: 'a' }).info).toEqual({ hasKey: true, provider: 'Claude', dmModel: 'claude-sonnet-5-5' });
    const both = modelSetupFromEnv({ ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g', CLAUDE_DM_MODEL: 'claude-haiku-5-5' });
    expect(both.info).toEqual({ hasKey: true, provider: 'Claude, falling back to api.groq.com', dmModel: 'claude-haiku-5-5' });
    expect(both.client).toBeInstanceOf(FallbackClient);
    expect(modelSetupFromEnv({}).info.hasKey).toBe(false);
  });
});
