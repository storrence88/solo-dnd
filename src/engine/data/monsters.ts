// Monster stat blocks from the System Reference Document 5.1 (CC-BY-4.0), trimmed to 5e-lite. See NOTICE.md.
// "Vess" is an original NPC for the Greyford Bridge scene.
import type { AbilityScores, Skill } from '../abilities';
import type { Attack } from '../types';

export interface MonsterDef {
  name: string;
  ac: number;
  hp: number;
  abilities: AbilityScores;
  proficiencyBonus: number;
  skillProficiencies?: Skill[];
  attacks: Attack[];
  multiattack?: string[];
}

const scimitar = (toHit: number, damage: string): Attack => ({
  id: 'scimitar', name: 'Scimitar', kind: 'melee', toHit, damage, damageType: 'slashing', sneakAttackEligible: true,
});

export const MONSTERS = {
  bandit: {
    name: 'Bandit',
    ac: 12,
    hp: 11,
    abilities: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    attacks: [
      scimitar(3, '1d6+1'),
      { id: 'lightCrossbow', name: 'Light crossbow', kind: 'ranged', toHit: 3, damage: '1d8+1', damageType: 'piercing', sneakAttackEligible: true },
    ],
  },
  banditCaptain: {
    name: 'Bandit Captain',
    ac: 15,
    hp: 65,
    abilities: { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 },
    proficiencyBonus: 2,
    skillProficiencies: ['athletics', 'deception'],
    attacks: [
      scimitar(5, '1d6+3'),
      { id: 'dagger', name: 'Dagger', kind: 'melee', toHit: 5, damage: '1d4+3', damageType: 'piercing', sneakAttackEligible: true },
    ],
    multiattack: ['scimitar', 'scimitar', 'dagger'],
  },
  goblin: {
    name: 'Goblin',
    ac: 15,
    hp: 7,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    proficiencyBonus: 2,
    skillProficiencies: ['stealth'],
    attacks: [
      scimitar(4, '1d6+2'),
      { id: 'shortbow', name: 'Shortbow', kind: 'ranged', toHit: 4, damage: '1d6+2', damageType: 'piercing', sneakAttackEligible: true },
    ],
  },
  thug: {
    name: 'Thug',
    ac: 11,
    hp: 32,
    abilities: { str: 15, dex: 11, con: 14, int: 10, wis: 10, cha: 11 },
    proficiencyBonus: 2,
    skillProficiencies: ['intimidation'],
    attacks: [{ id: 'mace', name: 'Mace', kind: 'melee', toHit: 4, damage: '1d6+2', damageType: 'bludgeoning', sneakAttackEligible: false }],
    multiattack: ['mace', 'mace'],
  },
  wolf: {
    name: 'Wolf',
    ac: 13,
    hp: 11,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    proficiencyBonus: 2,
    skillProficiencies: ['perception', 'stealth'],
    attacks: [{ id: 'bite', name: 'Bite', kind: 'melee', toHit: 4, damage: '2d4+2', damageType: 'piercing', sneakAttackEligible: false }],
  },
  vess: {
    name: 'Vess',
    ac: 14,
    hp: 27,
    abilities: { str: 14, dex: 14, con: 12, int: 11, wis: 12, cha: 13 },
    proficiencyBonus: 2,
    skillProficiencies: ['intimidation', 'perception'],
    attacks: [{ id: 'longsword', name: 'Longsword', kind: 'melee', toHit: 4, damage: '1d8+2', damageType: 'slashing', sneakAttackEligible: false }],
    multiattack: ['longsword', 'longsword'],
  },
} as const satisfies Record<string, MonsterDef>;
export type MonsterId = keyof typeof MONSTERS;
