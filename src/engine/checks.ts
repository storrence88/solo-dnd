import { abilityModifier, SKILL_ABILITY, type Ability, type Skill } from './abilities';
import { rollD20, type D20Result, type RollMode } from './dice';
import type { Rng } from './rng';
import type { Combatant } from './types';

export function skillModifier(actor: Combatant, skill: Skill): number {
  const base = abilityModifier(actor.abilities[SKILL_ABILITY[skill]]);
  if (actor.expertise.includes(skill)) return base + actor.proficiencyBonus * 2;
  if (actor.skillProficiencies.includes(skill)) return base + actor.proficiencyBonus;
  return base;
}

export function saveModifier(actor: Combatant, ability: Ability): number {
  const base = abilityModifier(actor.abilities[ability]);
  return actor.saveProficiencies.includes(ability) ? base + actor.proficiencyBonus : base;
}

/** 10 + Perception modifier, used when nobody is actively searching. */
export function passivePerception(actor: Combatant): number {
  return 10 + skillModifier(actor, 'perception');
}

export interface CheckResult extends D20Result {
  dc: number;
  success: boolean;
}

export function abilityCheck(actor: Combatant, check: Skill | Ability, dc: number, rng: Rng, mode: RollMode = 'normal'): CheckResult {
  const modifier = check in SKILL_ABILITY ? skillModifier(actor, check as Skill) : abilityModifier(actor.abilities[check as Ability]);
  const roll = rollD20(rng, modifier, mode);
  return { ...roll, dc, success: roll.total >= dc };
}

export function savingThrow(actor: Combatant, ability: Ability, dc: number, rng: Rng, mode: RollMode = 'normal'): CheckResult {
  const roll = rollD20(rng, saveModifier(actor, ability), mode);
  return { ...roll, dc, success: roll.total >= dc };
}
