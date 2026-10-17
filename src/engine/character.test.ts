import { describe, expect, it } from 'vitest';
import { buildCharacter, buildMonster } from './character';
import { abilityCheck, passivePerception, skillModifier } from './checks';
import { BRENNA, ILSA, QUILL, STEVEN } from './data/pregens';
import { scriptedRng } from './rng';

describe('character sheets', () => {
  it('builds the playtest fighter', () => {
    const steven = buildCharacter(STEVEN);
    expect(steven.maxHp).toBe(28);
    expect(steven.ac).toBe(17); // chain mail 16 + Defense style
    expect(steven.attacks[0]).toMatchObject({ name: 'Longsword', toHit: 5, damage: '1d8+3' });
    expect(steven.critRange).toBe(19);
    expect(steven.resources).toEqual({ secondWind: 1, actionSurge: 1 });
  });

  it('builds the cleric with spell slots', () => {
    const brenna = buildCharacter(BRENNA);
    expect(brenna.maxHp).toBe(24);
    expect(brenna.ac).toBe(18);
    expect(brenna.spellcasting).toMatchObject({ saveDc: 13, attackBonus: 5, slots: [0, 4, 2] });
    expect(brenna.features).toContain('discipleOfLife');
  });

  it('builds the rogue with expertise and Sneak Attack', () => {
    const quill = buildCharacter(QUILL);
    expect(quill.maxHp).toBe(21);
    expect(quill.ac).toBe(14);
    expect(quill.sneakAttackDice).toBe(2);
    expect(skillModifier(quill, 'stealth')).toBe(7); // +3 Dex, +4 doubled proficiency
    expect(skillModifier(quill, 'deception')).toBe(4);
    expect(quill.attacks[0]).toMatchObject({ toHit: 5, damage: '1d6+3', sneakAttackEligible: true });
  });

  it('builds the wizard unarmored', () => {
    const ilsa = buildCharacter(ILSA);
    expect(ilsa.maxHp).toBe(20); // 6+2, then 4+2 twice
    expect(ilsa.ac).toBe(12);
    expect(ilsa.spellcasting?.saveDc).toBe(13);
  });

  it('rejects levels outside 1 to 5', () => {
    expect(() => buildCharacter({ ...STEVEN, level: 6 })).toThrow();
    expect(() => buildCharacter({ ...STEVEN, level: 0 })).toThrow();
  });

  it('grows to level 5: proficiency +3, more hit points, new features and 3rd-level slots', () => {
    const steven = buildCharacter({ ...STEVEN, level: 5 });
    expect(steven.proficiencyBonus).toBe(3);
    expect(steven.maxHp).toBe(44); // 12 + 4 x 8
    expect(steven.features).toContain('extraAttack');
    expect(buildCharacter({ ...QUILL, level: 5 })).toMatchObject({ sneakAttackDice: 3 });
    expect(buildCharacter({ ...QUILL, level: 5 }).features).toContain('uncannyDodge');
    expect(buildCharacter({ ...ILSA, level: 5 }).spellcasting?.slots).toEqual([0, 4, 3, 2]);
    expect(buildCharacter({ ...BRENNA, level: 4 }).spellcasting?.slots).toEqual([0, 4, 3]);
  });

  it('runs checks against a DC', () => {
    const steven = buildCharacter(STEVEN);
    expect(abilityCheck(steven, 'athletics', 14, scriptedRng([9])).success).toBe(true); // 9 + 5
    expect(abilityCheck(steven, 'athletics', 14, scriptedRng([8])).success).toBe(false);
    expect(abilityCheck(steven, 'int', 10, scriptedRng([10])).total).toBe(10);
  });

  it('gives monsters passive Perception', () => {
    expect(passivePerception(buildMonster('wolf', 'w'))).toBe(13);
    expect(passivePerception(buildMonster('bandit', 'b'))).toBe(10);
  });
});
