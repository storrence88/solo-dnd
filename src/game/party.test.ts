import { describe, expect, it } from 'vitest';
import { legalActions } from '../engine';
import { newGame, playerActs, playerCombatAction, replayCombat, viewGame } from './game';
import { perceptionFor } from './prompts';
import { FakeModel, narrate, type Reply } from './testing/fakeModel';
import { GREYFORD } from './scenes/greyford';
import { chooseSpeakers, type Poll } from './spotlight';
import { migrateState, type GameState } from './state';

const scene = GREYFORD;
const fresh = (seed = 42): GameState => newGame(scene, 'party', seed);

describe('spotlight', () => {
  const poll = (over: Partial<Poll>): Poll => ({ id: 'brenna', name: 'Brenna Ashford', intent: 'pass', urgency: 1, interests: [], lastLed: 0, ...over });
  const input = { playerText: 'I wave.', recentText: '', beat: 1, handOff: false };

  it('lets the most urgent companion who wants the lead go first, then the supporter', () => {
    const speakers = chooseSpeakers({
      ...input,
      polls: [poll({ id: 'brenna', intent: 'support', urgency: 4 }), poll({ id: 'quill', name: 'Quill', intent: 'lead', urgency: 3 })],
    });
    expect(speakers).toEqual([{ id: 'quill', role: 'lead' }, { id: 'brenna', role: 'support' }]);
  });

  it('keeps companions who pass quiet, unless the player names them', () => {
    const polls = [poll({ id: 'brenna' }), poll({ id: 'quill', name: 'Quill' })];
    expect(chooseSpeakers({ ...input, polls })).toEqual([]);
    expect(chooseSpeakers({ ...input, polls, playerText: 'Quill, can you pick that lock?' })).toEqual([{ id: 'quill', role: 'lead' }]);
  });

  it('hands the lead to someone when the player holds back', () => {
    const polls = [poll({ id: 'brenna', urgency: 2 }), poll({ id: 'quill', name: 'Quill', urgency: 3 })];
    expect(chooseSpeakers({ ...input, polls, handOff: true })[0]).toEqual({ id: 'quill', role: 'lead' });
  });

  it('pulls a companion in when the moment touches their interests, and nudges whoever has been quiet', () => {
    const brenna = poll({ id: 'brenna', intent: 'lead', urgency: 2, interests: ['fever', 'child'], lastLed: 5 });
    const quill = poll({ id: 'quill', name: 'Quill', intent: 'lead', urgency: 3, lastLed: 5 });
    expect(chooseSpeakers({ ...input, beat: 6, polls: [brenna, quill], playerText: 'Is your child sick with the fever?' })[0]!.id).toBe('brenna');
    const quietQuill = { ...quill, urgency: 2, lastLed: -1 };
    expect(chooseSpeakers({ ...input, beat: 6, polls: [{ ...brenna, interests: [] }, quietQuill] })[0]!.id).toBe('quill');
  });
});

describe('a party beat', () => {
  it('runs player, then lead, then supporter, then the DM', async () => {
    const state = fresh();
    const model = new FakeModel({
      'poll:brenna': [{ intent: 'support', urgency: 2 }],
      'poll:quill': [{ intent: 'lead', urgency: 4 }],
      'companion:quill': [{ say: 'Evening, friends. Lovely bridge.', act: 'Quill steps forward with a grin.', thought: 'Do not look at Corrin.', mood: 'tense', trust: {} }],
      'companion:brenna': [{ say: '', act: 'Brenna keeps a hand on the wagon.', thought: 'Quill is nervous.', mood: 'focused', trust: {} }],
    });
    await playerActs(state, scene, model, 'I ask what they want.');
    const kinds = state.transcript.slice(1).map((e) => (e.kind === 'companion' ? `${e.id}:${e.role}` : e.kind));
    expect(kinds).toEqual(['player', 'quill:lead', 'brenna:support', 'dm']);
    expect(state.companions.quill!.lastLed).toBe(1);
    expect(model.seen('companion', 'brenna')[0]).toContain('Quill has the spotlight');
    // Brenna sees what Quill said and did, but not what Quill thought.
    expect(model.seen('companion', 'brenna')[0]).toContain('Lovely bridge');
    expect(model.seen('companion', 'brenna')[0]).not.toContain('Do not look at Corrin');
    // The DM hears both companions but no private thoughts.
    const dm = model.seen('dm')[0]!;
    expect(dm).toContain('Lovely bridge');
    expect(dm).not.toContain('Do not look at Corrin');
    expect(dm).not.toContain('Quill is nervous');
  });

  it('tells the DM and the companions everyone\'s pronouns', async () => {
    const state = fresh();
    const model = new FakeModel({ 'poll:quill': [{ intent: 'lead', urgency: 4 }] });
    await playerActs(state, scene, model, 'I wait.');
    expect(model.seen('dm')[0]).toContain('Quill (companion, id quill, pronouns they/them)');
    expect(model.seen('dm')[0]).toContain('Brenna Ashford (companion, id brenna, pronouns she/her)');
    const quillTurn = model.seen('companion', 'quill')[0]!;
    expect(quillTurn).toContain('your pronouns (they/them, e.g. "Quill shifts their weight"');
    expect(quillTurn).toContain('pronouns she/her');
  });

  it('sends a they/them companion\'s "he" or "his" back once, then lets the second try stand', async () => {
    const state = fresh();
    const model = new FakeModel({
      'poll:quill': [{ intent: 'lead', urgency: 4 }],
      'companion:quill': [
        { say: 'Hey, Big Man.', act: 'Quill shifts his weight.', thought: '' },
        { say: 'Hey, Big Man.', act: 'Quill shifts their weight.', thought: '' },
      ],
    });
    await playerActs(state, scene, model, 'I wait.');
    expect(state.transcript.find((e) => e.kind === 'companion' && e.id === 'quill')).toMatchObject({ act: 'Quill shifts their weight.' });
    expect(model.seen('companion', 'quill')[1]).toContain('must use they/them');

    const stubborn = fresh();
    const again = new FakeModel({
      'poll:quill': [{ intent: 'lead', urgency: 4 }],
      'companion:quill': [{ say: 'Hey.', act: 'Quill hands Steven his sword.', thought: '' }, { say: 'Hey.', act: 'Quill hands Steven his sword.', thought: '' }],
    });
    await playerActs(stubborn, scene, again, 'I wait.');
    expect(stubborn.transcript.find((e) => e.kind === 'companion' && e.id === 'quill')).toMatchObject({ act: 'Quill hands Steven his sword.' });
  });

  it('never shows a companion the DM\'s secrets, even once unlocked', async () => {
    const state = fresh();
    const model = new FakeModel({ helper: [{ met: ['sick-child', 'corrin-knows-quill', 'ford'] }], 'poll:brenna': [{ intent: 'support', urgency: 3 }] });
    await playerActs(state, scene, model, 'Why do you need it?');
    await playerActs(state, scene, model, 'Go on.');
    expect(state.unlockedSecrets).toContain('sick-child');
    const companionCalls = [...model.seen('poll'), ...model.seen('companion')];
    expect(companionCalls.length).toBeGreaterThan(0);
    for (const text of companionCalls) for (const secret of scene.secrets) expect(text).not.toContain(secret.text);
  });

  it('keeps Quill\'s secret out of everyone else\'s view', async () => {
    const state = fresh();
    const model = new FakeModel({ 'poll:brenna': [{ intent: 'lead', urgency: 3 }] });
    await playerActs(state, scene, model, 'Hello.');
    expect(model.seen('poll', 'quill')[0]).toContain('Corrin was left behind');
    for (const text of [...model.seen('poll', 'brenna'), ...model.seen('companion', 'brenna'), ...model.seen('dm'), ...model.seen('helper')]) {
      expect(text).not.toContain('Corrin was left behind');
    }
  });

  it('leaves narration out of a companion\'s memory when they could not perceive it', async () => {
    const state = fresh();
    const model = new FakeModel({ dm: [narrate('You whisper to Vess, too low for anyone else to hear.', { type: 'none' }, { hiddenFrom: ['quill', 'nobody'] })] });
    await playerActs(state, scene, model, 'I whisper an offer to Vess.');
    const entry = state.transcript.at(-1)!;
    expect(entry).toMatchObject({ kind: 'dm', hiddenFrom: ['quill'] });
    expect(perceptionFor('quill', state.transcript, scene)).not.toContain('too low for anyone');
    expect(perceptionFor('brenna', state.transcript, scene)).toContain('too low for anyone');
  });

  it('lets every companion judge the PC\'s choice, moving trust a point and logging why', async () => {
    const state = fresh();
    const model = new FakeModel({
      'poll:brenna': [{ intent: 'pass', urgency: 1, approve: -1, because: 'he threatened a hungry man' }],
      'poll:quill': [{ intent: 'pass', urgency: 1, approve: 5, because: 'bold move' }],
    });
    await playerActs(state, scene, model, 'I tell Gorr I will gut him if he moves.');
    expect(state.companions.brenna!.trust.steven).toBe(5);
    expect(state.companions.quill!.trust.steven).toBe(7);
    expect(state.companions.brenna!.approvals).toEqual([{ chapter: 0, beat: 1, delta: -1, why: 'he threatened a hungry man' }]);
    expect(state.transcript.filter((e) => e.kind === 'approval').map((e) => e.kind === 'approval' && `${e.id}${e.delta}`)).toEqual(['brenna-1', 'quill1']);
    // Nobody in the story hears an approval.
    await playerActs(state, scene, model, 'Well?');
    for (const text of [...model.seen('dm'), ...model.seen('poll'), ...model.seen('companion')]) expect(text).not.toContain('hungry man');
  });

  it('ignores approvals without a reason, and holding back is not judged', async () => {
    const state = fresh();
    const model = new FakeModel({
      'poll:brenna': [{ intent: 'pass', urgency: 1, approve: 1, because: '' }, { intent: 'lead', urgency: 5, approve: -1, because: 'coward' }],
    });
    await playerActs(state, scene, model, 'I wave.');
    await playerActs(state, scene, model, '', { handOff: true });
    expect(state.companions.brenna!.trust.steven).toBe(6);
    expect(state.transcript.some((e) => e.kind === 'approval')).toBe(false);
  });

  it('lets a companion who cannot answer stay quiet without breaking the beat', async () => {
    const state = fresh();
    const model = new FakeModel({ 'poll:quill': [{ intent: 'lead', urgency: 5 }], 'companion:quill': ['nonsense', '{"also": "nonsense"}'] });
    await playerActs(state, scene, model, 'Well?');
    expect(state.transcript.filter((e) => e.kind === 'companion')).toEqual([]);
    expect(state.transcript.at(-1)?.kind).toBe('dm');
  });

  it('rolls a check with the companion\'s own sheet when the DM asks for one', async () => {
    const state = fresh();
    const model = new FakeModel({
      dm: [narrate('Brenna studies the bandit leader.', { type: 'check', who: 'brenna', check: 'insight', dc: 12, reason: 'read Vess' }), narrate('She sees fear.')],
    });
    await playerActs(state, scene, model, 'Brenna, what do you make of her?');
    const check = state.transcript.find((e) => e.kind === 'check');
    expect(check).toMatchObject({ who: 'brenna', whoName: 'Brenna Ashford', modifier: 5 });
  });

  it('gives the lead to a companion when the player holds back', async () => {
    const state = fresh();
    // Nobody asks to lead; the opening's talk of fever would favour Brenna, so Quill needs real urgency to win it.
    const model = new FakeModel({ 'poll:quill': [{ intent: 'support', urgency: 5 }] });
    await playerActs(state, scene, model, '', { handOff: true });
    expect(state.transcript[1]).toMatchObject({ kind: 'player', handOff: true });
    expect(state.transcript[2]).toMatchObject({ kind: 'companion', id: 'quill', role: 'lead' });
  });
});

describe('party combat', () => {
  const startFight = async (seed = 42, replies: Partial<Record<string, Reply[]>> = {}) => {
    const state = fresh(seed);
    const model = new FakeModel({ dm: [narrate('Steel flashes.', { type: 'combat', enemies: [] })], ...replies });
    await playerActs(state, scene, model, 'I attack Corrin.');
    return { state, model };
  };

  /** Companions pick the first listed attack, like a sensible default. */
  const pickAttack = (text: string) => {
    const lines = text.split('YOUR OPTIONS RIGHT NOW:\n')[1]!.split('\n');
    const attack = lines.find((l) => l.includes('→'));
    return { choices: [Number((attack ?? lines[0]!).split(':')[0])], say: 'For the wagon!', thought: 'Keep moving.' };
  };

  it('puts all five enemies and the whole party in the fight, and waits for the player', async () => {
    const { state } = await startFight();
    const { enc, waitingOn } = replayCombat(state, scene);
    expect(enc.combatants.map((c) => c.id).sort()).toEqual(['brenna', 'corrin', 'gorr', 'quill', 'sef', 'steven', 'tam', 'vess']);
    expect(waitingOn).toBe('steven');
  });

  it('records companions\' moves so the fight replays exactly', async () => {
    const pick = Array.from({ length: 40 }, () => pickAttack);
    const { state, model } = await startFight(7, { combat: pick });
    for (let i = 0; i < 3 && state.mode === 'combat'; i++) await playerCombatAction(state, scene, model, { kind: 'endTurn' });
    const actors = new Set(state.combat?.actions.map((a) => a.actorId) ?? []);
    if (state.mode === 'combat') {
      expect(actors).toEqual(new Set(['steven', 'brenna', 'quill']));
      expect(replayCombat(state, scene).enc.events).toEqual(replayCombat(state, scene).enc.events);
    }
    expect(state.transcript.some((e) => e.kind === 'companion' && e.role === 'combat' && e.say === 'For the wagon!')).toBe(true);
  });

  it('falls back to a sensible move when a companion picks nothing usable', async () => {
    const { state, model } = await startFight(3, { combat: Array.from({ length: 40 }, () => '{"choices": [99]}') });
    await playerCombatAction(state, scene, model, { kind: 'endTurn' });
    const companionMoves = (state.combat?.actions ?? []).filter((a) => a.actorId !== 'steven' && a.action.kind !== 'endTurn');
    if (state.mode === 'combat') expect(companionMoves.length).toBeGreaterThan(0);
  });

  it('fights to an ending and carries HP and spell slots back out', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const { state, model } = await startFight(seed, { combat: Array.from({ length: 200 }, () => pickAttack) });
      for (let i = 0; i < 60 && state.mode === 'combat'; i++) {
        const { enc } = replayCombat(state, scene);
        const attack = legalActions(enc).find((o) => o.action.kind === 'attack');
        await playerCombatAction(state, scene, model, attack ? attack.action : { kind: 'endTurn' });
      }
      expect(state.mode, `seed ${seed}`).not.toBe('combat');
      for (const id of ['steven', 'brenna', 'quill']) {
        const m = state.party[id]!;
        if (!m.dead) expect(m.hp).toBeGreaterThanOrEqual(1);
      }
      expect(state.party.brenna!.slots).toBeDefined();
      expect(viewGame(state, scene).party.map((p) => p.character.id)).toEqual(['steven', 'brenna', 'quill']);
    }
  });

  it('narrates the round once the player is up again, covering the companions\' turns', async () => {
    const { state, model } = await startFight(11, { combat: Array.from({ length: 40 }, () => pickAttack) });
    const before = model.seen('dm').length;
    await playerCombatAction(state, scene, model, { kind: 'endTurn' });
    if (state.mode !== 'combat') return;
    expect(model.seen('dm').length).toBe(before + 1);
    expect(model.seen('dm').at(-1)).toContain('For the wagon!');
    expect(state.transcript.at(-1)?.kind).toBe('dm');
  });
});

describe('saves', () => {
  it('upgrades a solo save from Phase 2', () => {
    const old = {
      version: 1, id: 'x', sceneId: 'greyford', seed: 5, mode: 'combat', unlockedSecrets: [], removedEnemies: [], checksRolled: 1,
      transcript: [{ kind: 'player', text: 'hi' }, { kind: 'check', label: 'Insight', dc: 10, rolls: [3], modifier: 1, total: 4, success: false, reason: 'x' }],
      pc: { hp: 20, secondWind: 0, actionSurge: 1 },
      combat: { seed: 9, enemyIds: ['vess'], actions: [{ kind: 'endTurn' }], narratedEvents: 3 },
    };
    const s = migrateState(old);
    expect(s).toMatchObject({ version: 5, campaignId: 'greyford-solo', chapter: 0, sceneId: 'greyford-solo', beat: 1, party: { steven: { hp: 20 } }, companions: {}, roster: [], history: [] });
    expect(s.combat?.actions).toEqual([{ actorId: 'steven', action: { kind: 'endTurn' } }]);
    expect(s.transcript[1]).toMatchObject({ who: 'steven', whoName: 'Steven' });
  });

  it('upgrades a party save from Phase 3 with empty memories', () => {
    const v2 = { ...fresh(), version: 2, companions: { brenna: { mood: 'calm', trust: { steven: 7 }, lastLed: 2 }, quill: { mood: 'jumpy', trust: { steven: 4 }, lastLed: -1 } } } as Record<string, unknown>;
    delete v2.campaignId;
    delete v2.roster;
    delete v2.history;
    delete v2.chapter;
    const s = migrateState(v2);
    expect(s).toMatchObject({ version: 5, campaignId: 'road', chapter: 0, roster: ['brenna', 'quill'], history: [] });
    expect(s.companions.brenna).toMatchObject({ mood: 'calm', trust: { steven: 7 }, lastLed: 2, memories: [], beliefs: [], approvals: [] });
  });
});
