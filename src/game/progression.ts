import { ABILITIES, buildCharacter, type Ability, type AbilityScores, type CharacterSpec, type ClassId } from '../engine';
import { ModelError } from './model';
import { slug } from './outline';
import type { GameState } from './state';

/** Generated campaigns start here and level up as acts end; hand-written ones stay at their scenes' level. */
export const START_LEVEL = 3;
export const MAX_PARTY_LEVEL = 5;

/** The ability each class raises first when it levels up on its own. */
const PRIMARY: Record<ClassId, Ability> = { fighter: 'str', cleric: 'wis', rogue: 'dex', wizard: 'int' };

/** Spells a class learns on reaching a level, for characters whose spec doesn't list them yet. */
const LEARNED: Partial<Record<ClassId, Record<number, string[]>>> = { wizard: { 5: ['fireball'] } };

export type Boosts = Partial<AbilityScores>;

/** A character as they are now: the party's level, their ability increases, and any spells that level teaches. */
export function levelled(state: GameState, spec: CharacterSpec): CharacterSpec {
  const level = Math.max(spec.level, state.level ?? spec.level);
  const boosts = state.boosts?.[spec.id] ?? {};
  const abilities = { ...spec.abilities };
  for (const a of ABILITIES) abilities[a] = Math.min(20, abilities[a] + (boosts[a] ?? 0));
  const learned = Object.entries(LEARNED[spec.classId] ?? {})
    .filter(([lvl]) => Number(lvl) <= level)
    .flatMap(([, spells]) => spells);
  const spells = spec.spells ? [...new Set([...spec.spells, ...learned])] : undefined;
  return { ...spec, level, abilities, ...(spells ? { spells } : {}) };
}

/** Checks an ability score increase: +2 to one ability or +1 to two, never above 20. */
export function checkBoosts(raw: unknown, current: AbilityScores): Boosts {
  const boosts: Boosts = {};
  let total = 0;
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!(ABILITIES as readonly string[]).includes(k)) throw new ModelError(`Unknown ability "${k}"`);
    const n = Number(v);
    if (n !== 1 && n !== 2) throw new ModelError('Raise an ability by 1 or 2');
    if (current[k as Ability] + n > 20) throw new ModelError('Abilities cannot go above 20');
    boosts[k as Ability] = n;
    total += n;
  }
  if (total !== 2) throw new ModelError('Spend exactly 2 points: +2 to one ability or +1 to two');
  return boosts;
}

/** What a character picks for themselves: their class's main ability, or Constitution once that is maxed. */
export function defaultBoosts(spec: CharacterSpec): Boosts {
  const main = PRIMARY[spec.classId];
  if (spec.abilities[main] <= 18) return { [main]: 2 };
  if (spec.abilities[main] === 19) return { [main]: 1, con: 1 };
  return { con: 2 };
}

function addBoosts(state: GameState, id: string, boosts: Boosts): void {
  const mine = (state.boosts[id] ??= {});
  for (const [k, v] of Object.entries(boosts)) mine[k as Ability] = (mine[k as Ability] ?? 0) + (v ?? 0);
}

/** Levels that bring an ability score increase. */
const ASI_LEVELS = [4];

/**
 * The party reaches the next level. At an ability score increase, companions raise their own and the
 * player chooses theirs before breaking camp (or gets their class's default). Returns the journal line.
 */
export function levelUp(state: GameState, companions: CharacterSpec[]): string | null {
  if (state.level >= MAX_PARTY_LEVEL) return null;
  state.level += 1;
  if (ASI_LEVELS.includes(state.level)) {
    for (const spec of companions) addBoosts(state, spec.id, defaultBoosts(levelled(state, spec)));
    state.levelUp = { level: state.level };
  }
  return `Level up! The party reaches level ${state.level}.`;
}

/** The player's ability increase for a pending level-up. */
export function chooseBoosts(state: GameState, pc: CharacterSpec, raw: unknown): void {
  if (!state.levelUp) throw new ModelError('There is no level-up to choose for');
  boostPc(state, pc, checkBoosts(raw, levelled(state, pc).abilities));
}

/** Breaking camp without choosing takes the class default. */
export function settleLevelUp(state: GameState, pc: CharacterSpec): void {
  if (!state.levelUp) return;
  boostPc(state, pc, defaultBoosts(levelled(state, pc)));
}

/** The level-up is chosen after the long rest, so hit points a Constitution increase adds are gained at once. */
function boostPc(state: GameState, pc: CharacterSpec, boosts: Boosts): void {
  const before = buildCharacter(levelled(state, pc)).maxHp;
  addBoosts(state, pc.id, boosts);
  const gained = buildCharacter(levelled(state, pc)).maxHp - before;
  const m = state.party[pc.id];
  if (m && !m.dead) m.hp += gained;
  delete state.levelUp;
}

// ---- Character creator -----------------------------------------------------------

/** A ready-made build per class: the standard array (15, 14, 13, 12, 10, 8) placed for the class, with fitting gear and spells. */
const BUILDS: Record<ClassId, Omit<CharacterSpec, 'id' | 'name' | 'level'>> = {
  fighter: {
    classId: 'fighter',
    abilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ['athletics', 'perception'],
    armor: 'chainMail',
    shield: true,
    weapons: ['longsword', 'lightCrossbow'],
    fightingStyle: 'dueling',
  },
  cleric: {
    classId: 'cleric',
    abilities: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    skills: ['insight', 'medicine'],
    armor: 'scaleMail',
    shield: true,
    weapons: ['mace'],
    spells: ['sacredFlame', 'cureWounds', 'healingWord', 'guidingBolt'],
  },
  rogue: {
    classId: 'rogue',
    abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 },
    skills: ['stealth', 'sleightOfHand', 'perception', 'deception'],
    expertise: ['stealth', 'perception'],
    armor: 'leather',
    weapons: ['rapier', 'shortbow'],
  },
  wizard: {
    classId: 'wizard',
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    skills: ['arcana', 'investigation'],
    weapons: ['quarterstaff'],
    spells: ['fireBolt', 'magicMissile', 'burningHands', 'scorchingRay'],
  },
};

export const CLASS_IDS = Object.keys(BUILDS) as ClassId[];

/** Ids the PC's must not take: the companions and anything the game reserves. */
const RESERVED = new Set(['brenna', 'quill', 'pc']);

/** A new player character from a name and a class, built for level 3. */
export function buildPc(rawName: string, classId: string): CharacterSpec {
  const name = rawName.trim().slice(0, 40);
  if (!name) throw new ModelError('Your character needs a name');
  if (!CLASS_IDS.includes(classId as ClassId)) throw new ModelError('Pick a class: fighter, cleric, rogue or wizard');
  const id = slug(name, 'pc');
  return { ...structuredClone(BUILDS[classId as ClassId]), id: RESERVED.has(id) ? `pc-${id}` : id, name, level: START_LEVEL };
}
