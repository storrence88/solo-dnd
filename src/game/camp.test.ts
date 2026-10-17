import { describe, expect, it } from 'vitest';
import { breakCamp, campTalk, chooseApproach, makeCamp } from './camp';
import { newGame, playerActs, viewGame } from './game';
import { recallMemories } from './memory';
import { GREYFORD } from './scenes/greyford';
import { HOLLINS_REST } from './scenes/hollinsRest';
import type { GameState } from './state';
import { FakeModel, narrate } from './testing/fakeModel';

const scene = GREYFORD;

/** A Greyford game whose scene has just ended. */
async function sceneOver(model = new FakeModel({ dm: [narrate('You cross.', { type: 'endScene', outcome: 'The party crossed with all the medicine.' })] })): Promise<GameState> {
  const state = newGame(scene, 'road-test', 7, 'road');
  await playerActs(state, scene, model, 'We pay Gorr and cross.');
  expect(state.mode).toBe('over');
  return state;
}

/** Gives a companion a run of logged grievances against the PC. */
function sour(state: GameState, id: string, trust: number, warned = false) {
  const cs = state.companions[id]!;
  cs.trust.steven = trust;
  cs.warned = warned;
  cs.approvals.push(...['he lied to Vess', 'he mocked Gorr', 'he left Lira'].map((why, i) => ({ chapter: 0, beat: i, delta: -1 as const, why })));
}

describe('making camp', () => {
  it('records the scene, rests the party, and lets each companion reflect', async () => {
    const state = await sceneOver();
    state.party.steven!.hp = 3;
    state.party.brenna!.slots = [0, 0, 0];
    const model = new FakeModel({
      chronicle: [{ summary: 'The party paid Gorr and crossed. Vess let them go.' }],
      'reflection:brenna': [{ memories: [{ text: 'I watched Steven pay a hungry man instead of hurting him.', importance: 4 }], beliefs: ['Steven is kinder than he looks.'], feeling: 'warmer toward you', mood: 'hopeful', intention: 'reach Maren by noon', trust: { quill: 8 } }],
    });
    await makeCamp(state, scene, model);

    expect(state.mode).toBe('camp');
    expect(state.camp?.summary).toBe('The party paid Gorr and crossed. Vess let them go.');
    expect(state.party.steven!.hp).toBe(viewGame(state, scene).party[0]!.character.maxHp);
    expect(state.party.brenna!.slots?.some((n) => n > 0)).toBe(true);
    expect(state.companions.brenna).toMatchObject({ beliefs: ['Steven is kinder than he looks.'], feeling: 'warmer toward you', mood: 'hopeful', intention: 'reach Maren by noon' });
    expect(state.companions.brenna!.memories).toEqual([{ chapter: 0, text: 'I watched Steven pay a hungry man instead of hurting him.', importance: 4 }]);
    expect(state.companions.brenna!.trust.quill).toBe(5); // moves one point a night at most
    expect(viewGame(state, scene).nextTitle).toBe(HOLLINS_REST.title);
  });

  it('has two companions talk by the fire and one seek out the PC privately', async () => {
    const state = await sceneOver();
    state.companions.quill!.approvals.push({ chapter: 0, beat: 1, delta: 1, why: 'clever deal' });
    const model = new FakeModel({
      'banter:brenna': [{ say: 'You went quiet on the bridge.', act: '', thought: '' }, { say: 'Lantern keep you.', act: '', thought: '' }],
      'banter:quill': [{ say: 'Bridges. Hate them.', act: '', thought: 'Corrin.' }],
      'approach:quill': [{ say: 'Big Man. Got a minute?', act: 'Quill sits beside Steven.', thought: 'Not yet.' }],
    });
    await makeCamp(state, scene, model);
    const night = state.transcript.slice(state.transcript.findIndex((e) => e.kind === 'campStart') + 1);
    expect(night.map((e) => (e.kind === 'companion' ? `${e.id}:${e.role}` : e.kind))).toEqual(['brenna:banter', 'quill:banter', 'brenna:banter', 'quill:private']);
    expect(night.at(-1)).toMatchObject({ hiddenFrom: ['brenna'] });
    expect(state.camp?.approacher).toBe('quill');
    // The banter answers what was said: Quill hears Brenna's opener.
    expect(model.seen('banter', 'quill')[0]).toContain('You went quiet on the bridge.');
  });

  it('keeps the private talk private', async () => {
    const state = await sceneOver();
    const model = new FakeModel({ 'talk:quill': [{ say: 'I knew Corrin once.', act: '', thought: '', mood: 'raw', approve: 1, because: 'he listened' }] });
    await makeCamp(state, scene, model);
    await campTalk(state, scene, model, 'Who was that bandit to you?', 'quill');
    expect(state.transcript.at(-3)).toMatchObject({ kind: 'player', text: 'Who was that bandit to you?', hiddenFrom: ['brenna'] });
    expect(state.companions.quill!.trust.steven).toBe(7);
    expect(state.transcript.at(-1)).toMatchObject({ kind: 'approval', id: 'quill', delta: 1 });
    await campTalk(state, scene, model, 'Brenna, you awake?', 'brenna');
    const brennaHeard = model.seen('talk', 'brenna')[0]!;
    expect(brennaHeard).toContain('Brenna, you awake?');
    expect(brennaHeard).not.toContain('Who was that bandit');
    expect(brennaHeard).not.toContain('I knew Corrin once');
  });

  it('only happens after a scene ends, and only if another scene follows', async () => {
    const solo = newGame(scene, 'solo', 1);
    await expect(makeCamp(solo, scene, new FakeModel())).rejects.toThrow(/scene is over/);
    solo.mode = 'over';
    await expect(makeCamp(solo, scene, new FakeModel())).rejects.toThrow(/adventure is over/);
  });
});

describe('who seeks the PC out', () => {
  it('puts a companion losing faith first, then one ready to confide, then whoever today stirred most', async () => {
    const state = await sceneOver();
    expect(chooseApproach(state, scene, ['brenna', 'quill'])).toMatchObject({ reason: 'talk' });
    state.companions.brenna!.trust.steven = 9;
    expect(chooseApproach(state, scene, ['brenna', 'quill'])).toEqual({ id: 'brenna', reason: 'confide' });
    sour(state, 'quill', 3);
    expect(chooseApproach(state, scene, ['brenna', 'quill'])).toEqual({ id: 'quill', reason: 'confront' });
    state.companions.quill!.warned = true;
    expect(chooseApproach(state, scene, ['brenna', 'quill'])).toEqual({ id: 'brenna', reason: 'confide' });
  });

  it('names the grievances when a companion confronts the PC, and counts it as the warning', async () => {
    const state = await sceneOver();
    sour(state, 'quill', 2);
    const model = new FakeModel();
    await makeCamp(state, scene, model);
    expect(state.companions.quill!.warned).toBe(true);
    expect(model.seen('approach', 'quill')[0]).toContain('he lied to Vess; he mocked Gorr; he left Lira');
  });
});

describe('breaking camp', () => {
  it('files the scene away and opens the next one, with the companions remembering', async () => {
    const state = await sceneOver();
    const model = new FakeModel({
      chronicle: [{ summary: 'The party paid Gorr and crossed. Vess let them go.' }],
      'reflection:quill': [{ memories: [{ text: 'Corrin saw me on the bridge. He knows.', importance: 5 }], beliefs: ['Steven doesn\'t ask questions. Good.'], feeling: 'jokey but watchful', mood: 'uneasy', intention: 'keep my head down', trust: {} }],
      dm: [narrate('After the bridge, the valley. Hollin\'s Rest waits behind a rope.')],
    });
    await makeCamp(state, scene, model);
    await breakCamp(state, scene, model);

    expect(state).toMatchObject({ mode: 'explore', chapter: 1, sceneId: 'hollins-rest', unlockedSecrets: [], removedEnemies: [], roster: ['brenna', 'quill'] });
    expect(state.camp).toBeUndefined();
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ sceneId: 'greyford', outcome: 'The party crossed with all the medicine.', summary: 'The party paid Gorr and crossed. Vess let them go.' });
    expect(state.transcript.map((e) => e.kind)).toEqual(['chapter', 'dm']);
    expect(model.seen('dm').at(-1)).toContain('EARLIER CHAPTERS');
    expect(model.seen('dm').at(-1)).toContain('Vess let them go.');

    await playerActs(state, HOLLINS_REST, model, 'I walk up to the rope.');
    const quillNow = model.seen('poll', 'quill').at(-1)!;
    expect(quillNow).toContain('WHAT YOU REMEMBER FROM EARLIER:\n- Corrin saw me on the bridge. He knows.');
    expect(quillNow).toContain('Steven doesn\'t ask questions. Good.');
    expect(model.seen('poll', 'brenna').at(-1)).not.toContain('Corrin saw me');
    const view = viewGame(state, HOLLINS_REST);
    expect(view.chapters.map((c) => c.title)).toEqual([GREYFORD.title]);
    expect(view.title).toBe(HOLLINS_REST.title);
  });

  it('turns the night\'s conversations into memories', async () => {
    const state = await sceneOver();
    const model = new FakeModel({ 'campMemory:quill': [{ memories: [{ text: 'I told Steven about Corrin. He didn\'t flinch.', importance: 5 }] }] });
    await makeCamp(state, scene, model);
    await campTalk(state, scene, model, 'Tell me about Corrin.', 'quill');
    await breakCamp(state, scene, model);
    expect(state.companions.quill!.memories.map((m) => m.text)).toContain('I told Steven about Corrin. He didn\'t flinch.');
    // Brenna heard the banter, so she gets a memory pass too; but not of the private talk.
    expect(model.seen('campMemory', 'brenna')[0]).not.toContain('Tell me about Corrin.');
  });

  it('lets a warned companion with no trust left betray the party, naming why', async () => {
    const state = await sceneOver();
    await makeCamp(state, scene, new FakeModel());
    sour(state, 'quill', 1, true);
    const model = new FakeModel({ 'departure:quill': [{ decision: 'betray', note: 'You lied to Vess and left Lira. I\'m done. Took two crates. Sorry, Big Man.', thought: '' }] });
    await breakCamp(state, scene, model);
    expect(state.roster).toEqual(['brenna']);
    expect(state.transcript[1]).toMatchObject({ kind: 'departure', id: 'quill', betrayed: true });
    expect(state.history[0]!.summary).toContain('Quill left the party that night, betraying them');
    expect(model.seen('dm')[0]).toContain('QUILL LEFT THE PARTY in the night, betraying them');
    expect(viewGame(state, HOLLINS_REST).party.map((m) => m.character.id)).toEqual(['steven', 'brenna']);
  });

  it('never lets a companion leave without the warning first', async () => {
    const state = await sceneOver();
    await makeCamp(state, scene, new FakeModel());
    sour(state, 'quill', 0, false);
    const model = new FakeModel();
    await breakCamp(state, scene, model);
    expect(model.seen('departure')).toEqual([]);
    expect(state.roster).toEqual(['brenna', 'quill']);
  });

  it('keeps a companion who decides to give the PC another chance', async () => {
    const state = await sceneOver();
    await makeCamp(state, scene, new FakeModel());
    sour(state, 'brenna', 1, true);
    const model = new FakeModel({ 'departure:brenna': [{ decision: 'betray', note: 'x' }] }); // Brenna has no betrayal; it reads as staying
    await breakCamp(state, scene, model);
    expect(model.seen('departure', 'brenna')).toHaveLength(1);
    expect(state.roster).toEqual(['brenna', 'quill']);
  });
});

describe('recalling memories', () => {
  it('prefers important, recent and relevant memories, and keeps them in order', () => {
    const memories = [
      { chapter: 0, text: 'The bread at the inn was stale.', importance: 1 },
      { chapter: 0, text: 'Corrin recognised me at the bridge.', importance: 4 },
      { chapter: 0, text: 'Brenna prayed over the wounded bandit.', importance: 2 },
      { chapter: 2, text: 'Harl offered me gold for the medicine.', importance: 3 },
    ];
    expect(recallMemories(memories, 'Corrin is here', 2, 2).map((m) => m.text)).toEqual(['Corrin recognised me at the bridge.', 'Harl offered me gold for the medicine.']);
    expect(recallMemories(memories, 'the wounded bandit prayed', 2, 2).map((m) => m.text)).toEqual(['Brenna prayed over the wounded bandit.', 'Harl offered me gold for the medicine.']);
    expect(recallMemories(memories, 'anything', 2, 10)).toHaveLength(4);
  });
});
