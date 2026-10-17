import { describe, expect, it } from 'vitest';
import { buildCharacter, pregens } from '../engine';
import { breakCamp, makeCamp } from './camp';
import { currentScene } from './campaign';
import { playerActs, viewGame } from './game';
import { newCampaign } from './planner';
import { buildPc, checkBoosts, chooseBoosts, levelled } from './progression';
import type { GameState } from './state';
import { FakeModel, narrate } from './testing/fakeModel';

const mira = { spec: buildPc('Mira Vale', 'wizard'), pronouns: 'she/her', background: 'A disgraced scholar of the old sea-saints.' };

async function finishScene(state: GameState, actDone: boolean): Promise<void> {
  await playerActs(state, currentScene(state)!, new FakeModel({ dm: [narrate('Done.', { type: 'endScene', outcome: 'It is done.' })] }), 'We finish it.');
  await makeCamp(state, currentScene(state)!, new FakeModel({ ledger: [{ summary: 'It was done.', quests: [], factions: [], actDone }] }));
}

describe('the character creator', () => {
  it('builds a ready level 3 character for every class', () => {
    for (const classId of ['fighter', 'cleric', 'rogue', 'wizard']) {
      const c = buildCharacter(buildPc('Ash', classId));
      expect(c).toMatchObject({ id: 'ash', name: 'Ash', level: 3, classId });
      expect(Object.values(c.abilities).sort((a, b) => b - a)).toEqual([15, 14, 13, 12, 10, 8]);
    }
    expect(buildPc('Quill', 'rogue').id).toBe('pc-quill');
    expect(() => buildPc('Ash', 'bard')).toThrow(/Pick a class/);
    expect(() => buildPc('  ', 'rogue')).toThrow(/name/);
  });

  it('plays a generated campaign as the player\'s own character', async () => {
    const model = new FakeModel();
    const state = await newCampaign(model, { premise: 'salt', tone: 'grim', pc: mira }, 'g', 3);
    expect(model.seen('outline')[0]).toContain('Mira Vale (id mira-vale, pronouns she/her), wizard 3');
    expect(model.seen('outline')[0]).toContain('A disgraced scholar of the old sea-saints.');
    expect(currentScene(state)?.pc.id).toBe('mira-vale');
    expect(state.companions.quill!.trust).toEqual({ 'mira-vale': 6, brenna: 7 });
    await playerActs(state, currentScene(state)!, model, 'I look around.');
    expect(model.seen('dm')[0]).toContain('PARTY: Mira Vale (the PC, id mira-vale, pronouns she/her)');
  });
});

describe('levelling up', () => {
  it('raises the party a level at the end of each act, with ability increases at level 4', async () => {
    const state = await newCampaign(new FakeModel(), { premise: 'salt', tone: 'grim', pc: mira }, 'g', 3);
    await finishScene(state, true);
    expect(state.level).toBe(4);
    expect(state.transcript.find((e) => e.kind === 'journal')).toMatchObject({ lines: expect.arrayContaining(['Level up! The party reaches level 4.']) });
    expect(state.boosts).toEqual({ brenna: { wis: 2 }, quill: { dex: 2 } });
    const view = viewGame(state, currentScene(state)!);
    expect(view.levelUp).toEqual({ level: 4, abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } });
    expect(view.party.find((m) => m.character.id === 'brenna')?.character.maxHp).toBe(31); // full after the long rest

    expect(() => chooseBoosts(state, mira.spec, { int: 3 })).toThrow();
    expect(() => chooseBoosts(state, mira.spec, { int: 1 })).toThrow(/exactly 2/);
    chooseBoosts(state, mira.spec, { int: 1, con: 1 });
    expect(levelled(state, mira.spec).abilities).toMatchObject({ int: 16, con: 14 });
    const mage = viewGame(state, currentScene(state)!).party[0]!.character;
    expect(mage.hp).toBe(mage.maxHp); // the extra Constitution's hit points arrive at once
    expect(state.levelUp).toBeUndefined();
  });

  it('gives the class default if the player breaks camp without choosing', async () => {
    const state = await newCampaign(new FakeModel(), { premise: 'salt', tone: 'grim', pc: mira }, 'g', 3);
    await finishScene(state, true);
    await breakCamp(state, currentScene(state)!, new FakeModel());
    expect(state.boosts['mira-vale']).toEqual({ int: 2 });
    expect(state.levelUp).toBeUndefined();
  });

  it('reaches level 5 after act 2, with Fireball and a bigger fight budget', async () => {
    const model = new FakeModel();
    const state = await newCampaign(model, { premise: 'salt', tone: 'grim', pc: mira }, 'g', 3);
    await finishScene(state, true);
    await breakCamp(state, currentScene(state)!, new FakeModel());
    await finishScene(state, true);
    expect(state.level).toBe(5);
    expect(state.levelUp).toBeUndefined(); // no ability increase at 5
    const mage = viewGame(state, currentScene(state)!).party[0]!.character;
    expect(mage.level).toBe(5);
    expect(mage.spellcasting?.spells).toContain('fireball');
    expect(mage.spellcasting?.slots).toEqual([0, 4, 3, 2]);
    const morning = new FakeModel();
    await breakCamp(state, currentScene(state)!, morning);
    expect(morning.seen('plan')[0]).toContain('at most 22');
    expect(morning.seen('plan')[0]).toContain('THE PARTY NOW (level 5)');
  });

  it('checks ability increases', () => {
    const abilities = pregens.STEVEN.abilities;
    expect(checkBoosts({ str: 2 }, abilities)).toEqual({ str: 2 });
    expect(checkBoosts({ str: 1, con: 1 }, abilities)).toEqual({ str: 1, con: 1 });
    expect(() => checkBoosts({ luck: 2 }, abilities)).toThrow(/Unknown ability/);
    expect(() => checkBoosts({ str: 2 }, { ...abilities, str: 19 })).toThrow(/above 20/);
  });
});
