import { buildCharacter, buildMonster } from './character';
import { Encounter } from './combat';
import { BRENNA, ILSA, QUILL, STEVEN } from './data/pregens';
import { seededRng } from './rng';

export interface Scenario {
  id: string;
  name: string;
  build: (seed: number) => Encounter;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'greyford',
    name: 'Greyford Bridge: Steven, Brenna and Quill vs Vess and four bandits',
    build: (seed) =>
      new Encounter(
        [
          buildCharacter(STEVEN),
          buildCharacter(BRENNA),
          buildCharacter(QUILL),
          buildMonster('vess', 'vess'),
          buildMonster('bandit', 'corrin', 'Corrin'),
          buildMonster('bandit', 'gorr', 'Gorr'),
          buildMonster('bandit', 'bandit-3', 'Bandit'),
          buildMonster('bandit', 'bandit-4', 'Bandit'),
        ],
        seededRng(seed),
      ),
  },
  {
    id: 'wolves',
    name: 'Wolf pack: all four classes vs five wolves',
    build: (seed) =>
      new Encounter(
        [
          buildCharacter(STEVEN),
          buildCharacter(BRENNA),
          buildCharacter(QUILL),
          buildCharacter(ILSA),
          ...[1, 2, 3, 4, 5].map((n) => buildMonster('wolf', `wolf-${n}`, `Wolf ${n}`)),
        ],
        seededRng(seed),
      ),
  },
];
