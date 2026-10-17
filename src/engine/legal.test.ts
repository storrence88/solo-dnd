import { describe, expect, it } from 'vitest';
import { buildCharacter, buildMonster } from './character';
import { Encounter } from './combat';
import { BRENNA, STEVEN } from './data/pregens';
import { applyAction, legalActions } from './legal';
import { scriptedRng } from './rng';

describe('legal actions', () => {
  it('lists attacks against living foes and removes spent options', () => {
    const enc = new Encounter([buildCharacter(STEVEN), buildMonster('bandit', 'a'), buildMonster('bandit', 'b')], scriptedRng([20, 1, 1, 2]));
    enc.start();
    const labels = legalActions(enc).map((a) => a.label);
    expect(labels).toContain('Longsword → Bandit');
    expect(labels.filter((l) => l.startsWith('Longsword'))).toHaveLength(2);
    expect(labels).not.toContain('Second Wind'); // already at full HP
    expect(labels).not.toContain('Action Surge'); // action not used yet
    applyAction(enc, { kind: 'attack', attackId: 'longsword', targetId: 'a' }); // rolls 2: miss
    const after = legalActions(enc).map((a) => a.label);
    expect(after).toContain('Action Surge');
    expect(after.some((l) => l.startsWith('Longsword'))).toBe(false);
  });

  it('offers healing only to hurt allies', () => {
    const steven = { ...buildCharacter(STEVEN), hp: 10 };
    const enc = new Encounter([buildCharacter(BRENNA), steven, buildMonster('bandit', 'b')], scriptedRng([20, 1, 1]));
    enc.start();
    const labels = legalActions(enc).map((a) => a.label);
    expect(labels).toContain('Healing Word → Steven');
    expect(labels).not.toContain('Healing Word → Brenna Ashford');
    expect(labels).toContain('Sacred Flame → Bandit');
  });
});
