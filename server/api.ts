import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CombatAction } from '../src/engine';
import { newGame, playerActs, playerCombatAction, viewGame } from '../src/game/game';
import type { ModelClient, ProviderConfig } from '../src/game/model';
import { SCENES } from '../src/game/scenes';
import type { GameState } from '../src/game/state';

export interface ApiResult {
  status: number;
  body: unknown;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Game saves: one JSON file per game in a local folder. */
export class SaveStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new ApiError(404, 'No such game');
    return join(this.dir, `${id}.json`);
  }

  async load(id: string): Promise<GameState> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as GameState;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(404, 'No such game');
    }
  }

  async save(state: GameState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.path(state.id);
    await writeFile(`${file}.tmp`, JSON.stringify(state, null, 1));
    await rename(`${file}.tmp`, file);
  }

  async list(): Promise<GameState[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const games = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => this.load(n.slice(0, -5)).catch(() => null)));
    return games.filter((g): g is GameState => g !== null);
  }
}

/**
 * The game's HTTP API, independent of the web server so it can be tested directly.
 * The model client and API key stay here on the server; the browser only ever gets a GameView.
 */
export function createApi(opts: { store: SaveStore; model: ModelClient; provider: ProviderConfig }) {
  const { store, model, provider } = opts;
  const busy = new Set<string>();

  const sceneFor = (state: GameState) => {
    const scene = SCENES[state.sceneId];
    if (!scene) throw new ApiError(500, `Unknown scene ${state.sceneId}`);
    return scene;
  };

  /** Runs a turn on a copy of the game and saves it only if the whole turn worked, so a failed model call loses nothing. */
  const turn = async (id: string, run: (state: GameState) => Promise<void>): Promise<ApiResult> => {
    if (busy.has(id)) throw new ApiError(409, 'Still working on the last turn');
    busy.add(id);
    try {
      const state = await store.load(id);
      const draft = structuredClone(state);
      await run(draft);
      await store.save(draft);
      return { status: 200, body: viewGame(draft, sceneFor(draft)) };
    } finally {
      busy.delete(id);
    }
  };

  return async function handle(method: string, path: string, body: unknown): Promise<ApiResult> {
    try {
      const parts = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      if (method === 'GET' && parts[0] === 'status' && parts.length === 1) {
        return { status: 200, body: { hasKey: provider.apiKey !== '', provider: new URL(provider.baseUrl).host, dmModel: provider.dmModel, scenes: Object.values(SCENES).map((s) => ({ id: s.id, title: s.title })) } };
      }
      if (parts[0] !== 'games') throw new ApiError(404, 'Not found');
      const [, id, sub] = parts;

      if (!id) {
        if (method === 'GET') {
          const games = await store.list();
          return { status: 200, body: games.map((g) => ({ id: g.id, title: SCENES[g.sceneId]?.title ?? g.sceneId, mode: g.mode, turns: g.transcript.filter((e) => e.kind === 'player').length })) };
        }
        if (method === 'POST') {
          const sceneId = String((body as { sceneId?: unknown } | null)?.sceneId ?? 'greyford');
          const scene = SCENES[sceneId];
          if (!scene) throw new ApiError(400, 'Unknown scene');
          const state = newGame(scene, randomUUID(), Math.floor(Math.random() * 2 ** 31));
          await store.save(state);
          return { status: 201, body: viewGame(state, scene) };
        }
      }
      if (id && !sub && method === 'GET') {
        const state = await store.load(id);
        return { status: 200, body: viewGame(state, sceneFor(state)) };
      }
      if (id && sub === 'act' && method === 'POST') {
        const text = String((body as { text?: unknown } | null)?.text ?? '').slice(0, 2000);
        if (!text.trim()) throw new ApiError(400, 'Say what you do');
        return await turn(id, (state) => playerActs(state, sceneFor(state), model, text));
      }
      if (id && sub === 'combat' && method === 'POST') {
        const action = (body as { action?: CombatAction } | null)?.action;
        if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing action');
        return await turn(id, (state) => playerCombatAction(state, sceneFor(state), model, action));
      }
      throw new ApiError(404, 'Not found');
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: e.message } };
      return { status: 502, body: { error: (e as Error).message } };
    }
  };
}
