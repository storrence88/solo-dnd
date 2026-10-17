import type { Rng } from './rng';

/** A parsed dice expression such as "2d6+3": `count` dice with `sides` sides, plus `bonus`. */
export interface DiceExpr {
  count: number;
  sides: number;
  bonus: number;
}

export interface DiceResult {
  expr: string;
  rolls: number[];
  bonus: number;
  total: number;
}

const DICE_PATTERN = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;
const FLAT_PATTERN = /^\s*(-?\d+)\s*$/;

export function parseDice(expr: string): DiceExpr {
  const flat = FLAT_PATTERN.exec(expr);
  if (flat) return { count: 0, sides: 0, bonus: Number(flat[1]) };
  const match = DICE_PATTERN.exec(expr);
  if (!match) throw new Error(`Not a dice expression: "${expr}"`);
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const bonus = match[4] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
  if (count < 1 || sides < 2) throw new Error(`Not a dice expression: "${expr}"`);
  return { count, sides, bonus };
}

export function formatDice({ count, sides, bonus }: DiceExpr): string {
  const dice = count > 0 ? `${count}d${sides}` : '';
  if (bonus === 0) return dice || '0';
  if (!dice) return String(bonus);
  return `${dice}${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}`;
}

/**
 * Rolls a dice expression. On a critical hit the dice are doubled (not the bonus), as in 5e.
 * `extraBonus` adds a flat modifier on top of the expression's own.
 */
export function rollDice(expr: string, rng: Rng, options: { critical?: boolean; extraBonus?: number } = {}): DiceResult {
  const parsed = parseDice(expr);
  const count = options.critical ? parsed.count * 2 : parsed.count;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rng.roll(parsed.sides));
  const bonus = parsed.bonus + (options.extraBonus ?? 0);
  const total = Math.max(0, rolls.reduce((sum, r) => sum + r, 0) + bonus);
  return { expr: formatDice({ ...parsed, count, bonus }), rolls, bonus, total };
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface D20Result {
  /** The die that counts after advantage or disadvantage. */
  natural: number;
  rolls: number[];
  mode: RollMode;
  modifier: number;
  total: number;
}

/** Combines advantage and disadvantage sources: any of each cancel out, as in 5e. */
export function resolveMode(advantage: boolean, disadvantage: boolean): RollMode {
  if (advantage && !disadvantage) return 'advantage';
  if (disadvantage && !advantage) return 'disadvantage';
  return 'normal';
}

export function rollD20(rng: Rng, modifier: number, mode: RollMode = 'normal'): D20Result {
  const first = rng.roll(20);
  const rolls = mode === 'normal' ? [first] : [first, rng.roll(20)];
  const natural = mode === 'advantage' ? Math.max(...rolls) : mode === 'disadvantage' ? Math.min(...rolls) : first;
  return { natural, rolls, mode, modifier, total: natural + modifier };
}
