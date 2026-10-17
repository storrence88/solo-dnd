import { describe, expect, it } from 'vitest';
import { parseDice, resolveMode, rollD20, rollDice } from './dice';
import { scriptedRng, seededRng } from './rng';

describe('dice', () => {
  it('parses dice expressions', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, bonus: 0 });
    expect(parseDice('1d8 - 1')).toEqual({ count: 1, sides: 8, bonus: -1 });
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, bonus: 5 });
    expect(() => parseDice('banana')).toThrow();
  });

  it('adds dice and bonus', () => {
    const r = rollDice('2d6+3', scriptedRng([4, 5]));
    expect(r.total).toBe(12);
    expect(r.rolls).toEqual([4, 5]);
  });

  it('doubles dice but not the bonus on a critical', () => {
    const r = rollDice('1d8+3', scriptedRng([8, 2]), { critical: true });
    expect(r.rolls).toEqual([8, 2]);
    expect(r.total).toBe(13);
    expect(r.expr).toBe('2d8+3');
  });

  it('never goes below zero', () => {
    expect(rollDice('1d4-3', scriptedRng([1])).total).toBe(0);
  });

  it('takes the higher d20 with advantage and the lower with disadvantage', () => {
    expect(rollD20(scriptedRng([5, 17]), 2, 'advantage')).toMatchObject({ natural: 17, total: 19 });
    expect(rollD20(scriptedRng([5, 17]), 2, 'disadvantage')).toMatchObject({ natural: 5, total: 7 });
    expect(resolveMode(true, true)).toBe('normal');
  });

  it('is reproducible from a seed and stays in range', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = Array.from({ length: 200 }, () => a.roll(20));
    const seqB = Array.from({ length: 200 }, () => b.roll(20));
    expect(seqA).toEqual(seqB);
    expect(Math.min(...seqA)).toBe(1);
    expect(Math.max(...seqA)).toBe(20);
  });
});
