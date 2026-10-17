// Class features from the System Reference Document 5.1 (CC-BY-4.0), trimmed to 5e-lite levels 1 to 5. See NOTICE.md.
import type { Ability } from '../abilities';
import type { Feature } from '../types';

export interface ClassDef {
  name: string;
  hitDie: number;
  saves: Ability[];
  spellcastingAbility?: Ability;
  /** Features gained at each level (cumulative). */
  features: Record<number, Feature[]>;
  /** Spell slots by character level: slots[level] = [_, 1st, 2nd, 3rd]. */
  slots?: Record<number, number[]>;
  sneakAttackDice?: Record<number, number>;
}

const FULL_CASTER_SLOTS: Record<number, number[]> = {
  1: [0, 2],
  2: [0, 3],
  3: [0, 4, 2],
  4: [0, 4, 3],
  5: [0, 4, 3, 2],
};

export const CLASSES = {
  fighter: {
    name: 'Fighter',
    hitDie: 10,
    saves: ['str', 'con'],
    features: { 1: ['secondWind'], 2: ['actionSurge'], 3: ['improvedCritical'], 5: ['extraAttack'] },
  },
  cleric: {
    name: 'Cleric (Life)',
    hitDie: 8,
    saves: ['wis', 'cha'],
    spellcastingAbility: 'wis',
    features: { 1: ['discipleOfLife'] },
    slots: FULL_CASTER_SLOTS,
  },
  rogue: {
    name: 'Rogue',
    hitDie: 8,
    saves: ['dex', 'int'],
    features: { 1: ['sneakAttack'], 2: ['cunningAction'], 5: ['uncannyDodge'] },
    sneakAttackDice: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 },
  },
  wizard: {
    name: 'Wizard',
    hitDie: 6,
    saves: ['int', 'wis'],
    spellcastingAbility: 'int',
    features: {},
    slots: FULL_CASTER_SLOTS,
  },
} as const satisfies Record<string, ClassDef>;
export type ClassId = keyof typeof CLASSES;

export const MAX_LEVEL = 5;
