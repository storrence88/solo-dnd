import { describe, expect, it } from 'vitest';
import type { Entry } from '../game/state';
import { atEnd, clampCursor, endCursor, nextCursor, pendingState, rollInLine, unitAt } from './playback';

describe('rolls in the combat log', () => {
  it('reads attacks, saves, checks and death saves', () => {
    expect(rollInLine('Steven attacks Gorr with Longsword: d20 14 + 5 = 19 vs AC 13, hit')).toEqual({ dice: [14], kept: 14, caption: 'Steven vs Gorr: 19 vs AC 13, hit', outcome: 'good' });
    expect(rollInLine('Quill Fenn attacks Bandit 2 with Shortbow: d20 [3, 17] advantage + 6 = 23 vs AC 12, CRITICAL HIT')).toMatchObject({ dice: [3, 17], kept: 17, caption: 'Quill vs Bandit: 23 vs AC 12, critical hit!' });
    expect(rollInLine('Gorr attacks Brenna Ashford with Club: d20 [15, 4] disadvantage - 1 = 3 vs AC 18, miss')).toMatchObject({ kept: 4, outcome: 'bad' });
    expect(rollInLine('Gorr DEX save: 8 → 9 vs DC 13, failure')).toMatchObject({ dice: [8], caption: 'Gorr DEX save: 9 vs DC 13, failure', outcome: 'bad' });
    expect(rollInLine('Steven death save: 12 (successes 1, failures 0)')).toMatchObject({ dice: [12], outcome: 'good' });
    expect(rollInLine('Gorr takes 9 slashing (1d8+3: 6); HP 3')).toBeNull();
    expect(rollInLine('Round 2')).toBeNull();
  });
});

describe('playback', () => {
  const entries: Entry[] = [
    { kind: 'player', text: 'I attack.' },
    { kind: 'combatLog', lines: ['Round 2', 'Steven attacks Gorr with Longsword: d20 14 + 5 = 19 vs AC 13, hit', 'Gorr takes 9 slashing (1d8+3: 6); HP 3', 'Gorr attacks Steven with Club: d20 12 + 2 = 14 vs AC 18, miss', 'Brenna Ashford casts Cure Wounds at Steven', 'Steven regains 6 HP; HP 26'] },
  ];

  it('steps through entries, then each combat line, waiting on rolls', () => {
    let c = { i: 0, line: 0 };
    c = nextCursor(entries, c);
    expect(c).toEqual({ i: 1, line: 0 });
    c = nextCursor(entries, c);
    expect(unitAt(entries, c, 'steven').roll?.caption).toBe('Steven vs Gorr: 19 vs AC 13, hit');
    // The last fight log stays open after its last line: the next turn can add to it.
    expect(nextCursor(entries, { i: 1, line: 5 })).toEqual({ i: 1, line: 6 });
    expect(atEnd(entries, { i: 1, line: 6 })).toBe(true);
    const grown: Entry[] = [entries[0]!, { kind: 'combatLog', lines: [...(entries[1] as { lines: string[] }).lines, 'Gorr attacks Steven with Club: d20 15 + 2 = 17 vs AC 18, miss'] }];
    expect(atEnd(grown, { i: 1, line: 6 })).toBe(false);
    expect(unitAt(grown, { i: 1, line: 6 }, 'steven').roll?.caption).toBe('Gorr vs Steven: 17 vs AC 18, miss');
    expect(endCursor(grown)).toEqual({ i: 1, line: 7 });
    expect(clampCursor([...grown, { kind: 'combatEnd', result: 'victory' }], { i: 1, line: 7 })).toEqual({ i: 2, line: 0 });
    expect(clampCursor(entries.slice(0, 1), { i: 1, line: 3 })).toEqual({ i: 1, line: 0 });
  });

  it('holds back hit points and the round until their lines are shown', () => {
    const max = new Map([['Gorr', 12], ['Steven', 28]]);
    const known = new Map([['Gorr', 12], ['Steven', 20]]);
    expect(pendingState(entries, { i: 1, line: 0 }, max, known)).toEqual({ hp: new Map([['Gorr', 12], ['Steven', 20]]), round: 1 });
    expect(pendingState(entries, { i: 1, line: 3 }, max, known)).toEqual({ hp: new Map([['Steven', 20]]), round: undefined });
    expect(pendingState(entries, { i: 2, line: 0 }, max, known).hp.size).toBe(0);
  });
});
