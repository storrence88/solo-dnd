import { describe, expect, it } from 'vitest';
import { runToEnd } from './autopilot';
import { SCENARIOS } from './scenarios';

describe('scripted fights with no AI', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} always finishes and keeps the numbers legal`, () => {
      const wins = { party: 0, enemy: 0 };
      for (let seed = 1; seed <= 100; seed++) {
        const enc = scenario.build(seed);
        const winner = runToEnd(enc);
        expect(winner, `seed ${seed}`).not.toBeNull();
        wins[winner as 'party' | 'enemy'] += 1;
        for (const c of enc.combatants) {
          expect(c.hp).toBeGreaterThanOrEqual(0);
          expect(c.hp).toBeLessThanOrEqual(c.maxHp);
          for (const s of c.spellcasting?.slots ?? []) expect(s).toBeGreaterThanOrEqual(0);
          if (c.kind === 'monster' && c.hp === 0) expect(c.status).toBe('dead');
        }
      }
      // The scene should be winnable but not a walkover.
      expect(wins.party).toBeGreaterThan(0);
    });

    it(`${scenario.name} is identical for the same seed`, () => {
      const a = scenario.build(7);
      const b = scenario.build(7);
      runToEnd(a);
      runToEnd(b);
      expect(a.events).toEqual(b.events);
    });
  }
});
