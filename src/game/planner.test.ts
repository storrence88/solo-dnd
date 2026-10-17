import { describe, expect, it } from 'vitest';
import { pregens } from '../engine';
import { breakCamp, makeCamp } from './camp';
import { currentScene } from './campaign';
import { playerActs, viewGame } from './game';
import { parseOutline } from './outline';
import { newCampaign, parseScenePlan, writeRecap } from './planner';
import { migrateState, type GameState } from './state';
import { FakeModel, narrate, OUTLINE, scenePlan } from './testing/fakeModel';

const start = (model = new FakeModel()) => newCampaign(model, { premise: 'missing salt miners', tone: 'mystery' }, 'gen', 11);

/** A generated game whose current scene has just ended. */
async function sceneOver(model: FakeModel, state?: GameState): Promise<GameState> {
  const s = state ?? (await start(model));
  await playerActs(s, currentScene(s)!, model, 'We go down.');
  expect(s.mode).toBe('over');
  return s;
}

const ends = (outcome = 'The party found the drowned gallery.') => narrate('Done.', { type: 'endScene', outcome });

describe('starting a generated campaign', () => {
  it('plans the campaign and its first scene, showing the player only the public parts', async () => {
    const model = new FakeModel();
    const state = await start(model);
    expect(model.seen('outline')[0]).toContain('PREMISE: missing salt miners');
    expect(model.seen('outline')[0]).toContain('TONE: mystery');
    expect(state.outline?.title).toBe('The Brine Crown');
    expect(state.scene?.title).toBe('The Salt Steps');
    expect(state.transcript.map((e) => e.kind)).toEqual(['chapter', 'dm']);
    expect(state.quests).toEqual([{ id: 'find-the-missing-miners', title: 'Find the missing miners', goal: 'Learn what happened to the night shift.', status: 'active', notes: [] }]);
    expect(state.companions.quill!.mood).toBe('twitchy');

    const view = viewGame(state, currentScene(state)!);
    expect(view.campaignTitle).toBe('The Brine Crown');
    expect(view.journal).toMatchObject({ act: { n: 1, total: 3, title: 'Missing Miners' }, factions: [] });
    const shown = JSON.stringify(view);
    for (const hidden of ['Brine Queen', 'feeding miners', 'Hide the drowned shrine', 'Seal the shrine or bargain', 'paid to send the shift']) expect(shown).not.toContain(hidden);
  });

  it('tells the DM the campaign\'s public face but never its plan, threat or locked secrets', async () => {
    const model = new FakeModel();
    const state = await start(model);
    await playerActs(state, currentScene(state)!, model, 'Where is the night shift?');
    const dm = model.seen('dm')[0]!;
    expect(dm).toContain('CAMPAIGN: The Brine Crown');
    expect(dm).toContain('CURRENT ACT (1 of 3): Missing Miners');
    expect(dm).toContain('- Find the missing miners');
    expect(dm).toContain('The Salt Guild (neutral)');
    for (const hidden of ['Brine Queen', 'feeding miners', 'Hide the drowned shrine', 'paid to send the shift']) expect(dm).not.toContain(hidden);
  });

  it('gives each companion their hook for this story', async () => {
    const model = new FakeModel({ 'poll:quill': [{ intent: 'lead', urgency: 5 }] });
    const state = await start(model);
    await playerActs(state, currentScene(state)!, model, 'Quill?');
    expect(model.seen('companion', 'quill')[0]).toContain('WHY YOU ARE ON THIS JOURNEY:\nYou owe the Salt Guild money.');
    expect(model.seen('companion', 'quill')[0]).not.toContain('TEMPTATION');
  });
});

describe('checking the planner\'s work', () => {
  it('needs three acts and a hook for every companion', () => {
    expect(() => parseOutline(JSON.stringify({ ...OUTLINE, acts: OUTLINE.acts.slice(0, 2) }), ['brenna', 'quill'])).toThrow(/3 acts/);
    expect(() => parseOutline(JSON.stringify({ ...OUTLINE, companions: { brenna: OUTLINE.companions.brenna } }), ['brenna', 'quill'])).toThrow(/quill/);
  });

  it('keeps fights to real stat blocks within the budget, and away from party ids', () => {
    const scene = parseScenePlan(
      JSON.stringify(
        scenePlan('Ambush', {
          enemies: [
            { id: 'quill', monster: 'bandit', name: 'False Quill' },
            { id: 'dragon', monster: 'adultRedDragon', name: 'Smaug' },
            { id: 'ogre', monster: 'ogre', name: 'Big Tam' },
            { id: 'vet', monster: 'veteran', name: 'Ser Hollis' },
            { id: 'orc', monster: 'orc', name: 'Grul' },
          ],
        }),
      ),
      'chapter-2',
      pregens.STEVEN,
      ['brenna', 'quill'],
    );
    // bandit 1 + ogre 5 + orc 2 fit the budget of 12; the dragon isn't a stat block and the veteran (7) doesn't fit.
    expect(scene.enemies).toEqual([
      { id: 'enemy-quill', monster: 'bandit', name: 'False Quill' },
      { id: 'ogre', monster: 'ogre', name: 'Big Tam' },
      { id: 'orc', monster: 'orc', name: 'Grul' },
    ]);
    expect(scene.companions).toEqual(['brenna', 'quill']);
  });
});

describe('the end of a generated scene', () => {
  it('updates quests and factions, and logs the changes for the player', async () => {
    const model = new FakeModel({ dm: [ends()] });
    const state = await sceneOver(model);
    const camp = new FakeModel({
      ledger: [
        {
          summary: 'The party found the drowned gallery and angered the guild.',
          quests: [
            { id: 'find-the-missing-miners', status: 'done', note: 'The miners drowned in the old gallery.' },
            { id: 'guild-books', title: 'Read the guild\'s books', goal: 'Find who sent the shift down.', status: 'active', note: '' },
          ],
          factions: [{ id: 'guild', change: -1, why: 'We broke into their mine.' }, { id: 'nobody', change: 1, why: '' }],
          actDone: false,
        },
      ],
    });
    await makeCamp(state, currentScene(state)!, camp);
    expect(state.mode).toBe('camp');
    expect(state.camp?.summary).toBe('The party found the drowned gallery and angered the guild.');
    expect(state.quests.map((q) => [q.title, q.status])).toEqual([['Find the missing miners', 'done'], ['Read the guild\'s books', 'active']]);
    expect(state.factions.find((f) => f.id === 'guild')).toMatchObject({ attitude: -1, met: true, reasons: ['We broke into their mine.'] });
    expect(state.transcript.find((e) => e.kind === 'journal')).toEqual({
      kind: 'journal',
      lines: ['Quest complete: Find the missing miners', 'New quest: Read the guild\'s books', 'You have dealt with The Salt Guild: wary'],
    });
    expect(viewGame(state, currentScene(state)!).journal?.factions).toEqual([{ id: 'guild', name: 'The Salt Guild', description: 'Owns the mine.', attitude: 'wary' }]);
  });

  it('plans the next morning\'s scene from everything so far', async () => {
    const model = new FakeModel({ dm: [ends()] });
    const state = await sceneOver(model);
    await makeCamp(state, currentScene(state)!, new FakeModel({ ledger: [{ summary: 'They found the gallery.', quests: [], factions: [], actDone: true }] }));
    const morning = new FakeModel({ plan: [scenePlan('The Guildhall')] });
    await breakCamp(state, currentScene(state)!, morning);
    expect(state.chapter).toBe(1);
    expect(state.act).toBe(1);
    expect(state.transcript.map((e) => e.kind)).toEqual(['chapter', 'dm']);
    expect(currentScene(state)?.title).toBe('The Guildhall');
    expect(state.sceneId).toBe('chapter-2');
    const plan = morning.seen('plan')[0]!;
    expect(plan).toContain('1. The Salt Steps: They found the gallery.');
    expect(plan).toContain('CURRENT ACT: 2 of 3, "The Guild\'s Lie"');
    expect(morning.seen('dm')).toEqual([]); // the planned opening is used as written
  });

  it('pushes a long act to its climax, then moves on regardless', async () => {
    const model = new FakeModel({ dm: [ends()] });
    const state = await sceneOver(model);
    state.actChapters = 3;
    await makeCamp(state, currentScene(state)!, new FakeModel());
    const morning = new FakeModel();
    await breakCamp(state, currentScene(state)!, morning);
    expect(morning.seen('plan')[0]).toContain('This scene is the act\'s climax');
    expect(state.act).toBe(0);

    await sceneOver(new FakeModel({ dm: [ends()] }), state);
    await makeCamp(state, currentScene(state)!, new FakeModel());
    expect(state.act).toBe(1);
    expect(state.transcript.find((e) => e.kind === 'journal')).toEqual({ kind: 'journal', lines: ['Act 2 begins: The Guild\'s Lie'] });
  });

  it('ends the campaign with an epilogue when the last act is done', async () => {
    const model = new FakeModel({ dm: [ends('The shrine is sealed.')] });
    const state = await sceneOver(model);
    state.act = 2;
    const finale = new FakeModel({ ledger: [{ summary: 'They sealed the shrine.', quests: [], factions: [], actDone: true }], dm: [narrate('Years later, Saltmere still sings of you.')] });
    await makeCamp(state, currentScene(state)!, finale);
    expect(state.mode).toBe('ended');
    expect(state.camp).toBeUndefined();
    expect(finale.seen('dm')[0]).toContain('Write the epilogue');
    expect(finale.seen('dm')[0]).toContain('The shrine is sealed. / The Brine Queen rises.');
    expect(state.transcript.slice(-2)).toMatchObject([{ kind: 'chapter', title: 'Epilogue' }, { kind: 'dm', text: 'Years later, Saltmere still sings of you.' }]);
    const view = viewGame(state, currentScene(state)!);
    expect(view.hasNext).toBe(false);
    await expect(breakCamp(state, currentScene(state)!, finale)).rejects.toThrow();
  });
});

describe('recaps', () => {
  it('writes a "previously on" once, until the story moves on', async () => {
    const model = new FakeModel({ recap: [{ recap: 'You went to Saltmere.' }, { recap: 'You went down the steps.' }] });
    const state = await start(model);
    await writeRecap(state, currentScene(state)!, 'The Brine Crown', model);
    await writeRecap(state, currentScene(state)!, 'The Brine Crown', model);
    expect(model.seen('recap')).toHaveLength(1);
    expect(model.seen('recap')[0]).toContain('CAMPAIGN: The Brine Crown');
    expect(viewGame(state, currentScene(state)!).recap).toBe('You went to Saltmere.');

    await playerActs(state, currentScene(state)!, model, 'We go down.');
    expect(viewGame(state, currentScene(state)!).recap).toBeUndefined();
    await writeRecap(state, currentScene(state)!, 'The Brine Crown', model);
    expect(state.recap?.text).toBe('You went down the steps.');
  });
});

describe('older saves', () => {
  it('gives a Phase 4 game of the Road its companions\' original hooks', () => {
    const v3 = { version: 3, id: 'old', campaignId: 'road', chapter: 1, sceneId: 'hollins-rest', seed: 1, mode: 'explore', transcript: [], history: [], roster: ['brenna', 'quill'], unlockedSecrets: [], removedEnemies: [], checksRolled: 0, beat: 4, party: {}, companions: {} };
    const state = migrateState(v3);
    expect(state).toMatchObject({ version: 4, act: 0, actChapters: 1, quests: [], factions: [] });
    expect(state.hooks.quill?.betrayal).toContain('medicine');
    expect(state.hooks.brenna?.hook).toContain('Hollin\'s Rest');
  });
});
