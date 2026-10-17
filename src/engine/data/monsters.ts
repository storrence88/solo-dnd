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
  skeleton: {
    name: 'Skeleton',
    ac: 13,
    hp: 13,
    abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    proficiencyBonus: 2,
    attacks: [
      { id: 'shortsword', name: 'Shortsword', kind: 'melee', toHit: 4, damage: '1d6+2', damageType: 'piercing', sneakAttackEligible: true },
      { id: 'shortbow', name: 'Shortbow', kind: 'ranged', toHit: 4, damage: '1d6+2', damageType: 'piercing', sneakAttackEligible: true },
    ],
  },
  zombie: {
    name: 'Zombie',
    ac: 8,
    hp: 22,
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    proficiencyBonus: 2,
    attacks: [{ id: 'slam', name: 'Slam', kind: 'melee', toHit: 3, damage: '1d6+1', damageType: 'bludgeoning', sneakAttackEligible: false }],
  },
  cultist: {
    name: 'Cultist',
    ac: 12,
    hp: 9,
    abilities: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    skillProficiencies: ['deception', 'religion'],
    attacks: [scimitar(3, '1d6+1')],
  },
  guard: {
    name: 'Guard',
    ac: 16,
    hp: 11,
    abilities: { str: 13, dex: 12, con: 12, int: 10, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    skillProficiencies: ['perception'],
    attacks: [{ id: 'spear', name: 'Spear', kind: 'melee', toHit: 3, damage: '1d6+1', damageType: 'piercing', sneakAttackEligible: false }],
  },
  orc: {
    name: 'Orc',
    ac: 13,
    hp: 15,
    abilities: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    skillProficiencies: ['intimidation'],
    attacks: [
      { id: 'greataxe', name: 'Greataxe', kind: 'melee', toHit: 5, damage: '1d12+3', damageType: 'slashing', sneakAttackEligible: false },
      { id: 'javelin', name: 'Javelin', kind: 'ranged', toHit: 5, damage: '1d6+3', damageType: 'piercing', sneakAttackEligible: false },
    ],
  },
  hobgoblin: {
    name: 'Hobgoblin',
    ac: 18,
    hp: 11,
    abilities: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 },
    proficiencyBonus: 2,
    attacks: [
      { id: 'longsword', name: 'Longsword', kind: 'melee', toHit: 3, damage: '1d8+1', damageType: 'slashing', sneakAttackEligible: false },
      { id: 'longbow', name: 'Longbow', kind: 'ranged', toHit: 3, damage: '1d8+1', damageType: 'piercing', sneakAttackEligible: true },
    ],
  },
  giantSpider: {
    name: 'Giant Spider',
    ac: 14,
    hp: 26,
    abilities: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    proficiencyBonus: 2,
    skillProficiencies: ['stealth'],
    attacks: [{ id: 'bite', name: 'Bite', kind: 'melee', toHit: 5, damage: '1d8+3', damageType: 'piercing', sneakAttackEligible: false }],
  },
  direWolf: {
    name: 'Dire Wolf',
    ac: 14,
    hp: 37,
    abilities: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
    proficiencyBonus: 2,
    skillProficiencies: ['perception', 'stealth'],
    attacks: [{ id: 'bite', name: 'Bite', kind: 'melee', toHit: 5, damage: '2d6+3', damageType: 'piercing', sneakAttackEligible: false }],
  },
  bugbear: {
    name: 'Bugbear',
    ac: 16,
    hp: 27,
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    proficiencyBonus: 2,
    skillProficiencies: ['stealth', 'survival'],
    attacks: [
      { id: 'morningstar', name: 'Morningstar', kind: 'melee', toHit: 4, damage: '2d8+2', damageType: 'piercing', sneakAttackEligible: false },
      { id: 'javelin', name: 'Javelin', kind: 'ranged', toHit: 4, damage: '1d6+2', damageType: 'piercing', sneakAttackEligible: false },
    ],
  },
  ogre: {
    name: 'Ogre',
    ac: 11,
    hp: 59,
    abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    proficiencyBonus: 2,
    attacks: [
      { id: 'greatclub', name: 'Greatclub', kind: 'melee', toHit: 6, damage: '2d8+4', damageType: 'bludgeoning', sneakAttackEligible: false },
      { id: 'javelin', name: 'Javelin', kind: 'ranged', toHit: 6, damage: '2d6+4', damageType: 'piercing', sneakAttackEligible: false },
    ],
  },
  veteran: {
    name: 'Veteran',
    ac: 17,
    hp: 58,
    abilities: { str: 16, dex: 13, con: 14, int: 10, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    skillProficiencies: ['athletics', 'perception'],
    attacks: [
      { id: 'longsword', name: 'Longsword', kind: 'melee', toHit: 5, damage: '1d8+3', damageType: 'slashing', sneakAttackEligible: false },
      { id: 'heavyCrossbow', name: 'Heavy crossbow', kind: 'ranged', toHit: 3, damage: '1d10+1', damageType: 'piercing', sneakAttackEligible: true },
    ],
    multiattack: ['longsword', 'longsword'],
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
