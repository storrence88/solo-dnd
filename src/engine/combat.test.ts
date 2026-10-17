import { describe, expect, it } from 'vitest';
import { buildCharacter, buildMonster } from './character';
import { Encounter, RulesError } from './combat';
import { BRENNA, ILSA, QUILL, STEVEN } from './data/pregens';
import { scriptedRng, type Rng } from './rng';
import type { Combatant, GameEvent } from './types';

/** Rng whose results can be pushed between steps, so each test scripts exactly the dice it needs. */
function queueRng(): Rng & { push: (...n: number[]) => void } {
  const queue: number[] = [];
  return {
    push: (...n) => queue.push(...n),
    roll: (sides) => scriptedRng([queue.shift() ?? Number.NaN]).roll(sides),
  };
}

/** Starts a fight. By default the first combatant listed goes first (initiative rolls 20, then 1s). */
function fight(combatants: Combatant[], initiative: number[] = [20, ...combatants.slice(1).map(() => 1)]) {
  const rng = queueRng();
  rng.push(...initiative);
  const enc = new Encounter(combatants, rng);
  enc.start();
  return { enc, rng };
}

const last = <T extends GameEvent['type']>(enc: Encounter, type: T) =>
  [...enc.events].reverse().find((e) => e.type === type) as Extract<GameEvent, { type: T }>;

describe('combat', () => {
  it('orders initiative by total', () => {
    const rng = queueRng();
    rng.push(5, 15);
    const enc = new Encounter([buildCharacter(STEVEN), buildMonster('bandit', 'b')], rng);
    enc.start();
    expect(enc.initiativeOrder).toEqual(['b', 'steven']);
    expect(enc.current().id).toBe('b');
  });

  it('hits when the total meets AC and rolls damage', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildMonster('bandit', 'b')]);
    rng.push(7, 6); // 7 + 5 = 12 vs AC 12; 1d8+3 = 9
    enc.attack('steven', 'b', 'longsword');
    expect(last(enc, 'attack')).toMatchObject({ hit: true, critical: false, total: 12 });
    expect(enc.get('b').hp).toBe(2);
  });

  it('misses on a natural 1 and crits on 19 for a Champion', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildMonster('banditCaptain', 'cap')]);
    rng.push(1);
    enc.attack('steven', 'cap', 'longsword');
    expect(last(enc, 'attack').hit).toBe(false);
    enc.actionSurge('steven');
    rng.push(19, 4, 4); // crit: 2d8+3
    enc.attack('steven', 'cap', 'longsword');
    expect(last(enc, 'attack').critical).toBe(true);
    expect(last(enc, 'damage').amount).toBe(11);
  });

  it('allows one action per turn unless Action Surge is used', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildMonster('banditCaptain', 'cap')]);
    rng.push(2);
    enc.attack('steven', 'cap', 'longsword');
    expect(() => enc.attack('steven', 'cap', 'longsword')).toThrow(RulesError);
    expect(() => enc.attack('cap', 'steven', 'scimitar')).toThrow(/not Bandit Captain's turn/);
  });

  it('kills monsters at 0 HP and ends the fight', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildMonster('bandit', 'b')]);
    rng.push(15, 8);
    enc.attack('steven', 'b', 'longsword');
    expect(enc.get('b').status).toBe('dead');
    expect(enc.winner).toBe('party');
    expect(() => enc.endTurn()).toThrow(/over/);
  });

  it('drops a PC to unconscious, rolls death saves, and revives them with healing', () => {
    const quill = { ...buildCharacter(QUILL), hp: 3 };
    const { enc, rng } = fight([buildMonster('bandit', 'b'), quill, buildCharacter(BRENNA)]);
    rng.push(15, 4); // 1d6+1 = 5
    enc.attack('b', 'quill', 'scimitar');
    expect(enc.get('quill').status).toBe('unconscious');
    rng.push(12); // Quill's turn: death save success
    enc.endTurn();
    expect(enc.get('quill').deathSaves.successes).toBe(1);
    expect(enc.current().id).toBe('brenna');
    rng.push(3); // Healing Word: 1d4 + 3 Wis + 3 Disciple of Life
    enc.cast('brenna', 'healingWord', ['quill']);
    expect(enc.get('quill')).toMatchObject({ status: 'ok', hp: 9 });
    expect(enc.get('brenna').spellcasting?.slots[1]).toBe(3);
  });

  it('kills a PC outright on massive damage', () => {
    const ilsa = { ...buildCharacter(ILSA), hp: 1, maxHp: 5 };
    const { enc, rng } = fight([buildMonster('banditCaptain', 'cap'), ilsa, buildCharacter(STEVEN)]);
    rng.push(20, 6, 6); // crit scimitar: 2d6+3 = 15, leaving 14 over, at least her max HP
    rng.push(2, 2); // the other two attacks move on to Steven and miss
    enc.multiattack('cap', ['ilsa', 'steven']);
    expect(enc.get('ilsa').status).toBe('dead');
    expect(enc.events.filter((e) => e.type === 'attack' && e.targetId === 'steven')).toHaveLength(2);
  });

  it('counts hits on a downed PC as failed death saves', () => {
    const quill = { ...buildCharacter(QUILL), hp: 0, status: 'unconscious' as const };
    const { enc, rng } = fight([buildMonster('bandit', 'b'), quill, buildCharacter(STEVEN)]);
    rng.push(15, 3); // attacks against the unconscious have advantage: two d20s, 15 + 3 hits
    rng.push(3, 3); // melee hit on a downed target is a critical: 2d6+1
    enc.attack('b', 'quill', 'scimitar');
    expect(last(enc, 'attack').critical).toBe(true);
    expect(enc.get('quill').deathSaves.failures).toBe(2);
  });

  it('adds Sneak Attack when an ally is in melee with the target', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildCharacter(QUILL), buildMonster('banditCaptain', 'cap')], [20, 15, 1]);
    rng.push(15, 1);
    enc.attack('steven', 'cap', 'longsword');
    enc.endTurn();
    rng.push(15, 2, 3, 4); // hit; 1d6+3 then 2d6 sneak
    enc.attack('quill', 'cap', 'shortsword');
    expect(last(enc, 'damage')).toMatchObject({ amount: 12, note: 'Sneak Attack' });
  });

  it('gives no Sneak Attack without advantage or an ally nearby', () => {
    const { enc, rng } = fight([buildCharacter(QUILL), buildMonster('banditCaptain', 'cap')]);
    rng.push(15, 2);
    enc.attack('quill', 'cap', 'shortsword');
    expect(last(enc, 'damage').note).toBeUndefined();
  });

  it('hides with Cunning Action for advantage', () => {
    const { enc, rng } = fight([buildCharacter(QUILL), buildMonster('banditCaptain', 'cap')]);
    rng.push(10); // stealth 10 + 7 = 17 vs passive 10
    expect(enc.hide('quill')).toBe(true);
    expect(enc.get('quill').conditions).toContain('hidden');
    rng.push(3, 18, 1, 1, 1); // advantage takes 18; sneak attack applies
    enc.attack('quill', 'cap', 'shortsword');
    expect(last(enc, 'attack').mode).toBe('advantage');
    expect(last(enc, 'damage').note).toBe('Sneak Attack');
    expect(enc.get('quill').conditions).not.toContain('hidden');
  });

  it('gives disadvantage against a dodging target until its next turn', () => {
    const { enc, rng } = fight([buildCharacter(STEVEN), buildMonster('banditCaptain', 'cap')]);
    enc.dodge('steven');
    enc.endTurn();
    rng.push(18, 4, 2, 17, 3, 19); // three attacks, each takes the lower die
    enc.multiattack('cap', ['steven']);
    const attacks = enc.events.filter((e) => e.type === 'attack');
    expect(attacks).toHaveLength(3);
    for (const a of attacks) expect(a).toMatchObject({ mode: 'disadvantage', hit: false });
    expect(enc.get('steven').hp).toBe(28);
  });

  it('enforces spell slots and the bonus-action spell rule', () => {
    const brenna = buildCharacter(BRENNA);
    brenna.spellcasting!.slots = [0, 2, 0];
    const { enc, rng } = fight([brenna, buildCharacter(STEVEN), buildMonster('banditCaptain', 'cap')]);
    rng.push(4);
    enc.cast('brenna', 'healingWord', ['steven']);
    expect(() => enc.cast('brenna', 'guidingBolt', ['cap'])).toThrow(/only a cantrip/);
    rng.push(4, 1); // Sacred Flame is a cantrip: damage 1d8 = 4, then the save rolls 1 and fails
    enc.cast('brenna', 'sacredFlame', ['cap']);
    expect(enc.get('cap').hp).toBe(61);
    enc.endTurn();
  });

  it('runs out of slots', () => {
    const ilsa = buildCharacter(ILSA);
    ilsa.spellcasting!.slots = [0, 0, 0];
    const { enc } = fight([ilsa, buildMonster('bandit', 'b')]);
    expect(() => enc.cast('ilsa', 'magicMissile', ['b'])).toThrow(/no level 1 slots/);
  });

  it('upcasts and splits Magic Missile darts', () => {
    const { enc, rng } = fight([buildCharacter(ILSA), buildMonster('banditCaptain', 'a'), buildMonster('banditCaptain', 'c')]);
    rng.push(1, 1, 1, 1); // four darts at 1d4+1 = 2 each
    enc.cast('ilsa', 'magicMissile', ['a', 'c'], 2);
    expect(enc.get('a').hp).toBe(61);
    expect(enc.get('c').hp).toBe(61);
    expect(enc.get('ilsa').spellcasting?.slots).toEqual([0, 4, 1]);
  });

  it('halves Burning Hands on a save', () => {
    const { enc, rng } = fight([buildCharacter(ILSA), buildMonster('banditCaptain', 'a'), buildMonster('banditCaptain', 'c')]);
    rng.push(6, 6, 6); // 3d6 = 18
    rng.push(20, 1); // a saves (half), c fails
    enc.cast('ilsa', 'burningHands', ['a', 'c']);
    expect(enc.get('a').hp).toBe(56);
    expect(enc.get('c').hp).toBe(47);
  });

  it('heals with Second Wind as a bonus action', () => {
    const steven = { ...buildCharacter(STEVEN), hp: 5 };
    const { enc, rng } = fight([steven, buildMonster('bandit', 'b')]);
    rng.push(4); // 1d10 + 3
    enc.secondWind('steven');
    expect(enc.get('steven').hp).toBe(12);
    expect(() => enc.secondWind('steven')).toThrow(RulesError);
  });
});
