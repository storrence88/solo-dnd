import { abilityModifier, proficiencyBonus, type AbilityScores, type Skill } from './abilities';
import { ARMOR, WEAPONS, type ArmorId, type WeaponId } from './data/equipment';
import { CLASSES, MAX_LEVEL, type ClassId } from './data/classes';
import { MONSTERS, type MonsterId } from './data/monsters';
import { getSpell } from './data/spells';
import type { Attack, Combatant, Feature, Side, Spellcasting } from './types';

export type FightingStyle = 'defense' | 'dueling';

export interface CharacterSpec {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  abilities: AbilityScores;
  skills: Skill[];
  expertise?: Skill[];
  armor?: ArmorId;
  shield?: boolean;
  weapons: WeaponId[];
  spells?: string[];
  /** Fighters only. */
  fightingStyle?: FightingStyle;
  side?: Side;
}

/** Hit points: max hit die at level 1, then the rounded-up average per level, each plus Con modifier. */
export function hitPointsFor(hitDie: number, level: number, con: number): number {
  const conMod = abilityModifier(con);
  const perLevel = hitDie / 2 + 1 + conMod;
  return Math.max(1, hitDie + conMod + perLevel * (level - 1));
}

export function armorClassFor(dex: number, armor?: ArmorId, shield = false, fightingStyle?: FightingStyle): number {
  const dexMod = abilityModifier(dex);
  let ac = 10 + dexMod;
  if (armor) {
    const { base, maxDex } = ARMOR[armor];
    ac = base + (maxDex === null ? dexMod : Math.min(dexMod, maxDex));
  }
  if (shield) ac += 2;
  if (armor && fightingStyle === 'defense') ac += 1;
  return ac;
}

function weaponAttack(id: WeaponId, abilities: AbilityScores, prof: number, spec: CharacterSpec): Attack {
  const weapon = WEAPONS[id];
  const str = abilityModifier(abilities.str);
  const dex = abilityModifier(abilities.dex);
  const finesse = 'finesse' in weapon && weapon.finesse;
  const twoHanded = 'twoHanded' in weapon && weapon.twoHanded;
  const mod = weapon.kind === 'ranged' ? dex : finesse ? Math.max(str, dex) : str;
  const dueling = spec.fightingStyle === 'dueling' && weapon.kind === 'melee' && !twoHanded ? 2 : 0;
  const bonus = mod + dueling;
  return {
    id,
    name: weapon.name,
    kind: weapon.kind,
    toHit: mod + prof,
    damage: bonus === 0 ? weapon.damage : `${weapon.damage}${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}`,
    damageType: weapon.damageType,
    sneakAttackEligible: Boolean(finesse) || weapon.kind === 'ranged',
  };
}

export function buildCharacter(spec: CharacterSpec): Combatant {
  if (spec.level < 1 || spec.level > MAX_LEVEL) throw new Error(`Level must be 1 to ${MAX_LEVEL}, got ${spec.level}`);
  const cls = CLASSES[spec.classId];
  const prof = proficiencyBonus(spec.level);
  const features: Feature[] = [];
  for (let lvl = 1; lvl <= spec.level; lvl++) features.push(...((cls.features as Record<number, Feature[]>)[lvl] ?? []));

  let spellcasting: Spellcasting | undefined;
  if ('spellcastingAbility' in cls && 'slots' in cls) {
    const mod = abilityModifier(spec.abilities[cls.spellcastingAbility]);
    for (const spellId of spec.spells ?? []) getSpell(spellId);
    const slots = [...(cls.slots[spec.level] ?? [0])];
    spellcasting = {
      ability: cls.spellcastingAbility,
      saveDc: 8 + prof + mod,
      attackBonus: prof + mod,
      spells: [...(spec.spells ?? [])],
      slots,
      maxSlots: [...slots],
    };
  }

  const maxHp = hitPointsFor(cls.hitDie, spec.level, spec.abilities.con);
  return {
    id: spec.id,
    name: spec.name,
    side: spec.side ?? 'party',
    kind: 'pc',
    level: spec.level,
    classId: spec.classId,
    abilities: { ...spec.abilities },
    proficiencyBonus: prof,
    saveProficiencies: [...cls.saves],
    skillProficiencies: [...spec.skills],
    expertise: [...(spec.expertise ?? [])],
    maxHp,
    hp: maxHp,
    ac: armorClassFor(spec.abilities.dex, spec.armor, spec.shield, spec.fightingStyle),
    attacks: spec.weapons.map((w) => weaponAttack(w, spec.abilities, prof, spec)),
    spellcasting,
    features,
    critRange: features.includes('improvedCritical') ? 19 : 20,
    sneakAttackDice: 'sneakAttackDice' in cls ? ((cls.sneakAttackDice as Record<number, number>)[spec.level] ?? 0) : 0,
    resources: {
      secondWind: features.includes('secondWind') ? 1 : 0,
      actionSurge: features.includes('actionSurge') ? 1 : 0,
    },
    conditions: [],
    status: 'ok',
    deathSaves: { successes: 0, failures: 0 },
  };
}

export function buildMonster(monsterId: MonsterId, id: string, name?: string): Combatant {
  const m = MONSTERS[monsterId];
  return {
    id,
    name: name ?? m.name,
    side: 'enemy',
    kind: 'monster',
    abilities: { ...m.abilities },
    proficiencyBonus: m.proficiencyBonus,
    saveProficiencies: [],
    skillProficiencies: 'skillProficiencies' in m ? [...m.skillProficiencies] : [],
    expertise: [],
    maxHp: m.hp,
    hp: m.hp,
    ac: m.ac,
    attacks: m.attacks.map((a) => ({ ...a })),
    multiattack: 'multiattack' in m ? [...m.multiattack] : undefined,
    features: [],
    critRange: 20,
    sneakAttackDice: 0,
    resources: { secondWind: 0, actionSurge: 0 },
    conditions: [],
    status: 'ok',
    deathSaves: { successes: 0, failures: 0 },
  };
}
