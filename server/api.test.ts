import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelClient } from '../src/game/model';
import { modelSetupFromEnv } from '../src/game/providers';
import { GREYFORD } from '../src/game/scenes/greyford';
import { FakeModel } from '../src/game/testing/fakeModel';
import { createApi, SaveStore } from './api';
import { LiveHub, type LiveEvent } from './live';

const reply = (narration: string) => JSON.stringify({ narration, action: { type: 'none' }, revealed: [], prompt: 'What do you do?' });

async function setup(model: ModelClient) {
  const dir = await mkdtemp(join(tmpdir(), 'solo-dnd-'));
  const api = createApi({ store: new SaveStore(dir), model, provider: modelSetupFromEnv({ GROQ_API_KEY: 'shh' }).info });
  return { api, dir };
}

describe('game API', () => {
  it('creates, plays and reloads a game from its save file', async () => {
    const model: ModelClient = { complete: async (r) => (r.role === 'helper' ? '{"met":["sick-child"]}' : reply('Vess scowls.')) };
    const { api, dir } = await setup(model);
    const created = await api('POST', '/api/games', {});
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const played = await api('POST', `/api/games/${id}/act`, { text: 'Why do you need it?' });
    expect(played.status).toBe(200);
    expect(JSON.stringify(played.body)).not.toContain(GREYFORD.secrets[0]!.text);

    const loaded = await api('GET', `/api/games/${id}`, null);
    expect((loaded.body as { transcript: unknown[] }).transcript).toHaveLength(3);
    expect(await readdir(dir)).toEqual([`${id}.json`]);
    expect(((await api('GET', '/api/games', null)).body as unknown[]).length).toBe(1);
  });

  it('keeps the save unchanged when the model fails', async () => {
    const model: ModelClient = { complete: async () => { throw new Error('Model call failed (429): slow down'); } };
    const { api } = await setup(model);
    const id = ((await api('POST', '/api/games', {})).body as { id: string }).id;
    const failed = await api('POST', `/api/games/${id}/act`, { text: 'Hello' });
    expect(failed.status).toBe(502);
    expect((failed.body as { error: string }).error).toMatch(/429/);
    expect(((await api('GET', `/api/games/${id}`, null)).body as { transcript: unknown[] }).transcript).toHaveLength(1);
  });

  it('plans a new campaign from a premise, and recaps it on return', async () => {
    const model = new FakeModel({ recap: [{ recap: 'You came to Saltmere.' }] });
    const { api } = await setup(model);
    const created = await api('POST', '/api/games', { premise: 'missing salt miners', tone: 'mystery' });
    expect(created.status).toBe(201);
    const view = created.body as { id: string; campaignTitle: string; title: string; journal: { quests: unknown[] } };
    expect(view).toMatchObject({ campaignTitle: 'The Brine Crown', title: 'The Salt Steps' });
    expect(view.journal.quests).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('Brine Queen');

    const list = (await api('GET', '/api/games', null)).body as { title: string; scene: string }[];
    expect(list[0]).toMatchObject({ title: 'The Brine Crown', scene: 'The Salt Steps' });
    const recap = await api('POST', `/api/games/${view.id}/recap`, null);
    expect((recap.body as { recap: string }).recap).toBe('You came to Saltmere.');
  });

  it('starts a campaign as the player\'s own character, and checks level-up choices', async () => {
    const { api } = await setup(new FakeModel());
    const bad = await api('POST', '/api/games', { premise: 'salt', tone: 'grim', character: { name: 'Ash', classId: 'bard' } });
    expect(bad.status).toBe(400);
    const created = await api('POST', '/api/games', { premise: 'salt', tone: 'grim', character: { name: 'Ash Fen', classId: 'rogue', pronouns: 'he/him', background: 'A smuggler.' } });
    expect(created.status).toBe(201);
    const view = created.body as { id: string; pcId: string; level: number; party: { character: { name: string; classId: string } }[] };
    expect(view).toMatchObject({ pcId: 'ash-fen', level: 3 });
    expect(view.party[0]!.character).toMatchObject({ name: 'Ash Fen', classId: 'rogue' });
    const early = await api('POST', `/api/games/${view.id}/levelup`, { boosts: { dex: 2 } });
    expect(early.status).toBe(400);
    expect((early.body as { error: string }).error).toMatch(/no level-up/);
  });

  it('shows a turn as it happens: each new line, and the narration as it is written', async () => {
    const live = new LiveHub();
    const dir = await mkdtemp(join(tmpdir(), 'solo-dnd-'));
    const model = new FakeModel({ dm: [JSON.stringify({ narration: 'The river roars.', action: { type: 'none' }, revealed: [], prompt: 'What now?' })] });
    const api = createApi({ store: new SaveStore(dir), model, provider: modelSetupFromEnv({ GROQ_API_KEY: 'shh' }).info, live });
    const id = ((await api('POST', '/api/games', { campaignId: 'road' })).body as { id: string }).id;
    const events: LiveEvent[] = [];
    const stop = live.subscribe(id, (e) => events.push(e));
    await api('POST', `/api/games/${id}/act`, { text: 'I wade in.' });
    stop();
    const kinds = events.map((e) => (e.type === 'entry' ? e.entry.kind : e.type));
    expect(kinds[0]).toBe('player');
    expect(kinds.at(-1)).toBe('dm');
    const narration = events.filter((e) => e.type === 'narration').map((e) => (e as { text: string }).text);
    expect(narration.at(-1)).toBe('The river roars.');
    expect(kinds.indexOf('narration')).toBeGreaterThan(kinds.lastIndexOf('companion'));
  });

  it('never reports the key, and rejects odd ids', async () => {
    const { api } = await setup({ complete: async () => reply('x') });
    const status = await api('GET', '/api/status', null);
    expect(status.body).toMatchObject({ hasKey: true, provider: 'api.groq.com' });
    expect(JSON.stringify(status.body)).not.toContain('shh');
    expect((await api('GET', '/api/games/..%2Fetc', null)).status).toBe(404);
  });
});
