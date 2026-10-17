import type { Entry } from '../game/state';

/** How long a die tumbles before it lands, in seconds. Playback waits a little longer than this. */
export const TUMBLE = 0.9;

/** A d20 roll worth showing on the table: an attack, a save, a check or a death save. */
export interface Roll {
  /** The d20s rolled; two with advantage or disadvantage. */
  dice: number[];
  /** The die that counts, when we know which one it is. */
  kept?: number;
  /** One short line for under the die, e.g. "Quill vs Gorr: 17 vs AC 13, hit". */
  caption: string;
  outcome: 'good' | 'bad' | 'neutral';
}

const ATTACK = /^(.+?) attacks (.+?) with .+?: d20 (?:\[([\d, ]+)\] (advantage|disadvantage)|(\d+)) [+-] \d+ = (-?\d+) vs AC (\d+), (CRITICAL HIT|hit|miss)$/;
const SAVE_OR_CHECK = /^(.+?): ([\d, ]+) → (-?\d+) vs DC (\d+), (success|failure)$/;
const DEATH_SAVE = /^(.+?) death save: (\d+) /;
const DAMAGE = /^(.+?) takes (\d+) .*; HP (-?\d+)$/;
const HEAL = /^(.+?) regains (\d+) HP; HP (\d+)$/;
const ROUND = /^Round (\d+)$/;

const numbers = (s: string) => s.split(',').map((n) => Number(n.trim()));

/** The d20 roll in a combat log line, if it has one. */
export function rollInLine(line: string): Roll | null {
  let m = ATTACK.exec(line);
  if (m) {
    const dice = m[3] ? numbers(m[3]) : [Number(m[5])];
    const kept = m[4] === 'advantage' ? Math.max(...dice) : m[4] === 'disadvantage' ? Math.min(...dice) : dice[0];
    const verdict = m[8] === 'CRITICAL HIT' ? 'critical hit!' : m[8]!;
    return { dice, kept, caption: `${first(m[1]!)} vs ${first(m[2]!)}: ${m[6]} vs AC ${m[7]}, ${verdict}`, outcome: m[8] === 'miss' ? 'bad' : 'good' };
  }
  m = SAVE_OR_CHECK.exec(line);
  if (m) {
    const dice = numbers(m[2]!);
    return { dice, kept: dice.length === 1 ? dice[0] : undefined, caption: `${m[1]}: ${m[3]} vs DC ${m[4]}, ${m[5]}`, outcome: m[5] === 'success' ? 'good' : 'bad' };
  }
  m = DEATH_SAVE.exec(line);
  if (m) {
    const roll = Number(m[2]);
    return { dice: [roll], kept: roll, caption: `${first(m[1]!)}'s death save: ${roll}`, outcome: roll >= 10 ? 'good' : 'bad' };
  }
  return null;
}

/** The roll behind an out-of-combat ability or skill check. */
export function rollOfCheck(e: Extract<Entry, { kind: 'check' }>, pcId: string): Roll {
  const who = e.who === pcId ? '' : `${first(e.whoName)}: `;
  return {
    dice: e.rolls,
    kept: e.total - e.modifier,
    caption: `${who}${e.label} ${e.total} vs DC ${e.dc}, ${e.success ? 'success' : 'failure'}`,
    outcome: e.success ? 'good' : 'bad',
  };
}

const first = (name: string) => name.split(' ')[0]!;

/** Where playback has got to: entries before `i` are shown, and the first `line` lines of a combat log at `i`. */
export interface Cursor {
  i: number;
  line: number;
}

/** One step of playback: an entry, or one line of a combat log. */
export interface Unit {
  roll: Roll | null;
  /** Seconds to wait after showing it, so it can be read before the next one. */
  hold: number;
}

export function unitAt(entries: Entry[], c: Cursor, pcId: string): Unit {
  const e = entries[c.i]!;
  switch (e.kind) {
    case 'combatLog': {
      const line = e.lines[c.line] ?? '';
      const roll = rollInLine(line);
      return { roll, hold: roll ? 0.5 : ROUND.test(line) ? 0.4 : 0.7 };
    }
    case 'check':
      return { roll: rollOfCheck(e, pcId), hold: 0.8 };
    case 'player':
      return { roll: null, hold: 0.2 };
    case 'companion':
      return { roll: null, hold: e.say || e.act ? 0.9 : 0 };
    default:
      return { roll: null, hold: 0.5 };
  }
}

export function atEnd(entries: Entry[], c: Cursor): boolean {
  return c.i >= entries.length;
}

/** The cursor after showing the unit at `c`. */
export function nextCursor(entries: Entry[], c: Cursor): Cursor {
  const e = entries[c.i];
  if (e?.kind === 'combatLog' && c.line + 1 < e.lines.length) return { i: c.i, line: c.line + 1 };
  return { i: c.i + 1, line: 0 };
}

export function endCursor(entries: Entry[]): Cursor {
  return { i: entries.length, line: 0 };
}

/** Keeps a cursor inside the entries it points into, e.g. after a failed turn takes its live lines away. */
export function clampCursor(entries: Entry[], c: Cursor): Cursor {
  if (c.i > entries.length) return endCursor(entries);
  const e = entries[c.i];
  if (!e || e.kind !== 'combatLog' || c.line >= e.lines.length) return c.line ? { i: c.i, line: 0 } : c;
  return c;
}

/**
 * What the party and enemy cards should show while a turn plays out: hit points and the round as
 * they stood just before the first line not yet shown. Names with no changes still to come keep the
 * view's own numbers. `known` is what each card showed when the last turn finished.
 */
export function pendingState(entries: Entry[], c: Cursor, maxHp: Map<string, number>, known: Map<string, number>): { hp: Map<string, number>; round?: number } {
  const hp = new Map<string, number>();
  let round: number | undefined;
  for (let i = c.i; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.kind !== 'combatLog') continue;
    for (let j = i === c.i ? c.line : 0; j < e.lines.length; j++) {
      const line = e.lines[j]!;
      const r = ROUND.exec(line);
      if (r && round === undefined) round = Number(r[1]) - 1;
      const d = DAMAGE.exec(line);
      const h = d ? null : HEAL.exec(line);
      const m = d ?? h;
      if (!m || hp.has(m[1]!)) continue;
      const name = m[1]!;
      const amount = Number(m[2]);
      const after = Number(m[3]);
      const max = maxHp.get(name) ?? Infinity;
      // At 0 or full the change was clamped, so the amount alone can't say where they started.
      const clamped = d ? after <= 0 : after >= max;
      const before = clamped && known.has(name) ? known.get(name)! : d ? after + amount : after - amount;
      hp.set(name, Math.max(0, Math.min(max, before)));
    }
  }
  return { hp, round };
}
