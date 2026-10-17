import { describe, expect, it } from 'vitest';
import { legalActions } from '../engine';
import { newGame, playerActs, playerCombatAction, replayCombat, viewGame } from './game';
import type { CompletionRequest, ModelClient } from './model';
import { GREYFORD } from './scenes/greyford';
import type { GameState } from './state';

/** Returns scripted replies per role, and remembers every request so tests can check what the model saw. */
class FakeModel implements ModelClient {
  requests: CompletionRequest[] = [];
  constructor(private replies: { dm?: unknown[]; helper?: unknown[] }) {}
  async complete(req: CompletionRequest): Promise<string> {
    this.requests.push(req);
    const queue = this.replies[req.role] ?? [];
    const next = queue.shift();
    if (next === undefined) return req.role === 'helper' ? '{"met":[]}' : JSON.stringify(narrate('The river roars.'));
    return typeof next === 'string' ? next : JSON.stringify(next);
  }
  seen(role: 'dm' | 'helper'): string[] {
    return this.requests.filter((r) => r.role === role).map((r) => r.messages.map((m) => m.content).join('\n'));
  }
}

const narrate = (narration: string, action: unknown = { type: 'none' }, revealed: string[] = []) => ({
  narration, action, revealed, prompt: 'What do you do?',
});

const scene = GREYFORD;
const fresh = (seed = 42): GameState => newGame(scene, 'test', seed);

/** Plays the player's turns with the first attack on the first foe, ending the turn whenever no action is left. */
async function fightToEnd(state: GameState, model: ModelClient): Promise<void> {
  for (let i = 0; i < 200 && state.mode === 'combat'; i++) {
    const { enc } = replayCombat(state, scene);
    const options = legalActions(enc);
    const pick = options.find((o) => o.action.kind === 'attack') ?? options.find((o) => o.action.kind === 'endTurn')!;
    await playerCombatAction(state, scene, model, pick.action);
  }
}

describe('exploration', () => {
  it('opens with the scene text without calling the model', () => {
    const state = fresh();
    expect(state.transcript).toEqual([{ kind: 'dm', text: scene.opening, prompt: 'What do you do?' }]);
  });

  it('records the player and the DM reply', async () => {
    const state = fresh();
    const model = new FakeModel({ dm: [narrate('Vess folds her arms. "Half the crates."')] });
    await playerActs(state, scene, model, 'I ask what toll they want.');
    expect(state.transcript.slice(1).map((e) => e.kind)).toEqual(['player', 'dm']);
    expect(state.transcript[2]).toMatchObject({ text: 'Vess folds her arms. "Half the crates."' });
  });

  it('keeps every secret from the DM until the gatekeeper unlocks it', async () => {
    const state = fresh();
    const model = new FakeModel({ helper: ['{"met":[]}', '{"met":["sick-child"]}'] });
    await playerActs(state, scene, model, 'I wave.');
    expect(state.unlockedSecrets).toEqual([]);
    for (const s of scene.secrets) expect(model.seen('dm')[0]).not.toContain(s.text);

    await playerActs(state, scene, model, 'Why do you need medicine so badly?');
    expect(state.unlockedSecrets).toEqual(['sick-child']);
    const latest = model.seen('dm').at(-1)!;
    expect(latest).toContain(scene.secrets[0]!.text);
    expect(latest).not.toContain(scene.secrets[1]!.text);
  });

  it('shows the gatekeeper triggers but never the secret text', async () => {
    const state = fresh();
    const model = new FakeModel({});
    await playerActs(state, scene, model, 'Hello.');
    const gate = model.seen('helper')[0]!;
    for (const s of scene.secrets) {
      expect(gate).toContain(s.trigger);
      expect(gate).not.toContain(s.text);
    }
  });

  it('ignores secret ids the gatekeeper makes up, and survives it failing', async () => {
    const state = fresh();
    const model = new FakeModel({ helper: ['{"met":["dragon","ford"]}', 'not json'] });
    await playerActs(state, scene, model, 'Is there another way across?');
    await playerActs(state, scene, model, 'Hmm.');
    expect(state.unlockedSecrets).toEqual(['ford']);
  });

  it('rolls checks in the engine and asks the DM to narrate the result', async () => {
    const state = fresh();
    const model = new FakeModel({
      dm: [
        narrate('You lean in, watching her face.', { type: 'check', check: 'insight', dc: 12, reason: 'read Vess' }),
        narrate('Her jaw tightens when you mention the fever.'),
      ],
    });
    await playerActs(state, scene, model, 'I study Vess.');
    const kinds = state.transcript.slice(1).map((e) => e.kind);
    expect(kinds).toEqual(['player', 'dm', 'check', 'dm']);
    const check = state.transcript[3]!;
    if (check.kind !== 'check') throw new Error('expected a check');
    expect(check).toMatchObject({ label: 'Insight', dc: 12, reason: 'read Vess' });
    expect(check.total).toBe(check.rolls[0]! + check.modifier);
    expect(check.success).toBe(check.total >= 12);
    expect(state.checksRolled).toBe(1);
    expect(model.seen('dm').at(-1)).toContain(`rolled ${check.total}`);
  });

  it('gives the same check result for the same seed', async () => {
    const run = async () => {
      const state = fresh(7);
      const model = new FakeModel({ dm: [narrate('You try.', { type: 'check', check: 'athletics', dc: 14, reason: 'x' })] });
      await playerActs(state, scene, model, 'I climb.');
      return state.transcript[3];
    };
    expect(await run()).toEqual(await run());
  });

  it('retries once when the DM breaks a rule, then gives up', async () => {
    const state = fresh();
    const model = new FakeModel({ dm: [narrate('Lira is sick!', { type: 'none' }, ['sick-child']), narrate('Vess says nothing.')] });
    await playerActs(state, scene, model, 'Hi.');
    expect(state.transcript.at(-1)).toMatchObject({ text: 'Vess says nothing.' });
    expect(model.seen('dm')[1]).toContain('not an unlocked secret');

    const stubborn = new FakeModel({ dm: ['nope', '{"narration": ""}'] });
    await expect(playerActs(state, scene, stubborn, 'Hello?')).rejects.toThrow(/could not be used/);
  });

  it('refuses enemies that are not in the scene', async () => {
    const state = fresh();
    const model = new FakeModel({
      dm: [narrate('A fourth bandit!', { type: 'combat', enemies: ['vess', 'archer'] }), narrate('Steel rings.', { type: 'combat', enemies: ['vess'] })],
    });
    await playerActs(state, scene, model, 'I draw my sword.');
    expect(model.seen('dm')[1]).toContain('archer');
    expect(state.combat?.enemyIds).toEqual(['vess']);
  });

  it('ends the scene', async () => {
    const state = fresh();
    const model = new FakeModel({ dm: [narrate('You turn the wagon around.', { type: 'endScene', outcome: 'The PC turned back.' })] });
    await playerActs(state, scene, model, 'I turn back.');
    expect(state.mode).toBe('over');
    await expect(playerActs(state, scene, model, 'Wait.')).rejects.toThrow(/over/);
  });
});

describe('combat', () => {
  const startFight = async (seed = 42) => {
    const state = fresh(seed);
    const model = new FakeModel({ dm: [narrate('Corrin lunges.', { type: 'combat', enemies: [] })] });
    await playerActs(state, scene, model, 'I attack Corrin.');
    return { state, model };
  };

  it('starts with every enemy present when none are named', async () => {
    const { state } = await startFight();
    expect(state.mode).toBe('combat');
    expect(state.combat?.enemyIds).toEqual(['vess', 'corrin', 'gorr']);
  });

  it('replays the same fight from the seed and recorded actions', async () => {
    const { state, model } = await startFight();
    const { enc } = replayCombat(state, scene);
    const attack = legalActions(enc).find((o) => o.action.kind === 'attack')!;
    await playerCombatAction(state, scene, model, attack.action);
    const a = replayCombat(state, scene).enc.events;
    const b = replayCombat(state, scene).enc.events;
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('rejects actions the rules do not allow', async () => {
    const { state, model } = await startFight();
    await expect(playerCombatAction(state, scene, model, { kind: 'cast', spellId: 'fireBolt', targetIds: ['vess'] })).rejects.toThrow(/not allowed/);
    expect(state.combat?.actions).toEqual([]);
  });

  it('narrates once per round, not after every action', async () => {
    const { state, model } = await startFight();
    const dmCalls = () => model.seen('dm').length;
    const before = dmCalls();
    const attack = legalActions(replayCombat(state, scene).enc).find((o) => o.action.kind === 'attack')!;
    await playerCombatAction(state, scene, model, attack.action);
    if (state.mode !== 'combat') return; // a lucky first blow can end it
    expect(dmCalls()).toBe(before);
    await playerCombatAction(state, scene, model, { kind: 'endTurn' });
    if (state.mode !== 'combat') return;
    expect(dmCalls()).toBe(before + 1);
    expect(state.transcript.at(-2)?.kind).toBe('combatLog');
    expect(state.transcript.at(-1)?.kind).toBe('dm');
  });

  it('fights to an ending, then returns to exploration with HP carried over', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state, model } = await startFight(seed);
      await fightToEnd(state, model);
      const end = state.transcript.find((e) => e.kind === 'combatEnd');
      expect(end, `seed ${seed}`).toBeDefined();
      if (end?.kind !== 'combatEnd') continue;
      expect(state.combat).toBeUndefined();
      expect(state.pc.hp).toBeGreaterThanOrEqual(1);
      if (end.result === 'defeat') expect(state.pc.hp).toBe(1);
      if (end.result === 'enemiesFled') expect(state.removedEnemies.sort()).toEqual(['corrin', 'gorr', 'vess']);
      if (state.mode === 'explore') {
        expect(viewGame(state, scene).combat).toBeUndefined();
      }
    }
  });

  it('does not let the DM start a fight with enemies who are already gone', async () => {
    const state = fresh();
    state.removedEnemies = ['vess', 'corrin', 'gorr'];
    const model = new FakeModel({ dm: [narrate('x', { type: 'combat' }), narrate('The bridge is empty.')] });
    await playerActs(state, scene, model, 'I attack!');
    expect(state.mode).toBe('explore');
    expect(model.seen('dm')[1]).toContain('Combat cannot start');
  });
});

describe('what the browser sees', () => {
  it('never includes secret text, even after secrets unlock', async () => {
    const state = fresh();
    const model = new FakeModel({ helper: ['{"met":["sick-child","ford","gorr-wavers"]}'] });
    await playerActs(state, scene, model, 'Tell me everything.');
    const json = JSON.stringify(viewGame(state, scene));
    for (const s of scene.secrets) {
      expect(json).not.toContain(s.text);
      expect(json).not.toContain(s.trigger);
    }
  });

  it('lists legal actions only on the player\'s turn', async () => {
    const state = fresh();
    const model = new FakeModel({ dm: [narrate('Fight!', { type: 'combat' })] });
    await playerActs(state, scene, model, 'I attack.');
    const view = viewGame(state, scene);
    expect(view.combat?.yourTurn).toBe(true);
    expect(view.combat?.actions.some((a) => a.action.kind === 'endTurn')).toBe(true);
  });
});
