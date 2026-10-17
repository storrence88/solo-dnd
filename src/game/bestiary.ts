import type { MonsterId } from '../engine';

/** Stat blocks a generated scene may use, with a rough challenge rating and when they fit. */
export const BESTIARY: { id: MonsterId; cr: string; note: string }[] = [
  { id: 'cultist', cr: '1/8', note: 'zealot of a dark cause' },
  { id: 'guard', cr: '1/8', note: 'town watch, soldier, sentry' },
  { id: 'bandit', cr: '1/8', note: 'outlaw, smuggler, hired blade' },
  { id: 'goblin', cr: '1/4', note: 'sneaky raider, archer' },
  { id: 'skeleton', cr: '1/4', note: 'risen bones' },
  { id: 'zombie', cr: '1/4', note: 'slow, tough corpse' },
  { id: 'wolf', cr: '1/4', note: 'wild or trained hunter' },
  { id: 'orc', cr: '1/2', note: 'brutal raider with a greataxe' },
  { id: 'hobgoblin', cr: '1/2', note: 'disciplined armoured soldier' },
  { id: 'thug', cr: '1/2', note: 'enforcer, bruiser, bodyguard' },
  { id: 'giantSpider', cr: '1', note: 'lurking horse-sized spider' },
  { id: 'direWolf', cr: '1', note: 'huge pack leader' },
  { id: 'bugbear', cr: '1', note: 'big ambusher' },
  { id: 'banditCaptain', cr: '2', note: 'leader of outlaws or mercenaries; a boss' },
  { id: 'ogre', cr: '2', note: 'huge brute; a boss' },
  { id: 'veteran', cr: '3', note: 'seasoned warrior or knight; a tough boss' },
];

/** Encounter cost by challenge rating, so a generated fight can't outclass a level 3 party of three. */
const COST: Record<string, number> = { '1/8': 1, '1/4': 1, '1/2': 2, '1': 3, '2': 5, '3': 7 };
export const ENCOUNTER_BUDGET = 12;
export const MAX_ENEMIES = 6;

export const monsterCost = (id: MonsterId) => COST[BESTIARY.find((b) => b.id === id)?.cr ?? '3'] ?? 7;
