import type { Ability, AbilityScores, Skill } from './abilities';

export type Side = 'party' | 'enemy';
export type DamageType = 'slashing' | 'piercing' | 'bludgeoning' | 'fire' | 'force' | 'radiant';

export interface Attack {
  id: string;
  name: string;
  kind: 'melee' | 'ranged';
  toHit: number;
  /** Dice expression including the ability modifier, e.g. "1d8+3". */
  damage: string;
  damageType: DamageType;
  /** Finesse or ranged weapons qualify for Sneak Attack. */
  sneakAttackEligible: boolean;
}

export type Feature =
  | 'secondWind'
  | 'actionSurge'
  | 'improvedCritical'
  | 'sneakAttack'
  | 'cunningAction'
  | 'discipleOfLife';

export interface Spellcasting {
  ability: Ability;
  saveDc: number;
  attackBonus: number;
  spells: string[];
  /** slots[n] = remaining slots of level n. Index 0 is unused. */
  slots: number[];
  maxSlots: number[];
}

/**
 * Conditions in 5e-lite. Each one says when it ends:
 * - dodging: attacks against have disadvantage, ends at the start of the owner's next turn
 * - hidden: the owner's next attack has advantage, ends after that attack
 * - markedByGuidingBolt: the next attack against has advantage, ends after that attack
 */
export type ConditionType = 'dodging' | 'hidden' | 'markedByGuidingBolt';

export type Status = 'ok' | 'unconscious' | 'stable' | 'dead';

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  kind: 'pc' | 'monster';
  /** Character level for PCs; omitted for monsters. */
  level?: number;
  classId?: string;
  abilities: AbilityScores;
  proficiencyBonus: number;
  saveProficiencies: Ability[];
  skillProficiencies: Skill[];
  expertise: Skill[];
  maxHp: number;
  hp: number;
  ac: number;
  attacks: Attack[];
  /** Monsters only: attack ids made with one Multiattack action. */
  multiattack?: string[];
  spellcasting?: Spellcasting;
  features: Feature[];
  /** A natural roll at or above this is a critical hit (20 normally, 19 for a Champion). */
  critRange: number;
  sneakAttackDice: number;
  resources: { secondWind: number; actionSurge: number };
  conditions: ConditionType[];
  status: Status;
  deathSaves: { successes: number; failures: number };
}

/** Everything the engine reports. The log is append-only; the UI and (later) the AI narrator read it. */
export type GameEvent =
  | { type: 'initiative'; order: { id: string; roll: number; total: number }[] }
  | { type: 'roundStart'; round: number }
  | { type: 'turnStart'; actorId: string; round: number }
  | { type: 'attack'; attackerId: string; targetId: string; attackName: string; rolls: number[]; mode: string; total: number; targetAc: number; hit: boolean; critical: boolean }
  | { type: 'damage'; targetId: string; sourceId: string; amount: number; damageType: DamageType; rolls: number[]; expr: string; hpAfter: number; note?: string }
  | { type: 'heal'; targetId: string; sourceId: string; amount: number; hpAfter: number }
  | { type: 'save'; actorId: string; ability: Ability; dc: number; rolls: number[]; total: number; success: boolean }
  | { type: 'check'; actorId: string; label: string; dc: number; rolls: number[]; total: number; success: boolean }
  | { type: 'spell'; casterId: string; spellId: string; spellName: string; slotLevel: number; targetIds: string[] }
  | { type: 'feature'; actorId: string; feature: string; detail?: string }
  | { type: 'condition'; targetId: string; condition: ConditionType; added: boolean }
  | { type: 'status'; targetId: string; status: Status; reason: string }
  | { type: 'deathSave'; actorId: string; roll: number; successes: number; failures: number }
  | { type: 'combatEnd'; winner: Side; round: number };
