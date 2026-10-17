// Spell rules from the System Reference Document 5.1 (CC-BY-4.0), trimmed to 5e-lite. See NOTICE.md.
import type { Ability } from '../abilities';
import type { DamageType } from '../types';

export type SpellEffect =
  /** A spell attack roll against one target. */
  | { kind: 'attack'; range: 'melee' | 'ranged'; damage: string; damageType: DamageType; marksTarget?: boolean }
  /** Each target makes a saving throw; `halfOnSave` halves damage on a success, otherwise a success takes none. */
  | { kind: 'save'; save: Ability; damage: string; damageType: DamageType; halfOnSave: boolean; maxTargets: number }
  /** Darts that always hit, split among targets. Upcasting adds darts. */
  | { kind: 'darts'; darts: number; damage: string; damageType: DamageType }
  /** Several spell attacks, split among targets. Upcasting adds rays. */
  | { kind: 'rays'; rays: number; damage: string; damageType: DamageType }
  /** Restores hit points: dice plus the caster's spellcasting modifier. */
  | { kind: 'heal'; dice: string; range: 'touch' | 'ranged' };

export interface SpellDef {
  name: string;
  level: number;
  castingTime: 'action' | 'bonus';
  effect: SpellEffect;
  /** Extra dice per slot level above the spell's own (e.g. "1d6"), or extra darts/rays (a number). */
  upcast?: string | number;
}

export const SPELLS = {
  fireBolt: { name: 'Fire Bolt', level: 0, castingTime: 'action', effect: { kind: 'attack', range: 'ranged', damage: '1d10', damageType: 'fire' } },
  sacredFlame: { name: 'Sacred Flame', level: 0, castingTime: 'action', effect: { kind: 'save', save: 'dex', damage: '1d8', damageType: 'radiant', halfOnSave: false, maxTargets: 1 } },
  burningHands: { name: 'Burning Hands', level: 1, castingTime: 'action', upcast: '1d6', effect: { kind: 'save', save: 'dex', damage: '3d6', damageType: 'fire', halfOnSave: true, maxTargets: 3 } },
  cureWounds: { name: 'Cure Wounds', level: 1, castingTime: 'action', upcast: '1d8', effect: { kind: 'heal', dice: '1d8', range: 'touch' } },
  guidingBolt: { name: 'Guiding Bolt', level: 1, castingTime: 'action', upcast: '1d6', effect: { kind: 'attack', range: 'ranged', damage: '4d6', damageType: 'radiant', marksTarget: true } },
  healingWord: { name: 'Healing Word', level: 1, castingTime: 'bonus', upcast: '1d4', effect: { kind: 'heal', dice: '1d4', range: 'ranged' } },
  magicMissile: { name: 'Magic Missile', level: 1, castingTime: 'action', upcast: 1, effect: { kind: 'darts', darts: 3, damage: '1d4+1', damageType: 'force' } },
  scorchingRay: { name: 'Scorching Ray', level: 2, castingTime: 'action', upcast: 1, effect: { kind: 'rays', rays: 3, damage: '2d6', damageType: 'fire' } },
} as const satisfies Record<string, SpellDef>;
export type SpellId = keyof typeof SPELLS;

export function getSpell(id: string): SpellDef {
  const spell = (SPELLS as Record<string, SpellDef>)[id];
  if (!spell) throw new Error(`Unknown spell: ${id}`);
  return spell;
}
