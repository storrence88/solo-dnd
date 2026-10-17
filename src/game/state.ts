import type { CombatAction } from '../engine';

/** One line of the story so far. The transcript is append-only and is the save file's heart. */
export type Entry =
  | { kind: 'player'; text: string }
  | { kind: 'dm'; text: string; prompt: string }
  | { kind: 'check'; label: string; dc: number; rolls: number[]; modifier: number; total: number; success: boolean; reason: string }
  | { kind: 'combatStart'; enemyIds: string[] }
  | { kind: 'combatLog'; lines: string[] }
  | { kind: 'combatEnd'; result: CombatResult }
  | { kind: 'sceneEnd'; outcome: string };

export type CombatResult = 'victory' | 'enemiesFled' | 'defeat';

export interface CombatState {
  seed: number;
  enemyIds: string[];
  /** Every action the player took, in order. Replaying them from the seed rebuilds the fight exactly. */
  actions: CombatAction[];
  /** How many engine events the DM has already narrated. */
  narratedEvents: number;
}

export interface PcState {
  hp: number;
  secondWind: number;
  actionSurge: number;
}

export interface GameState {
  version: 1;
  id: string;
  sceneId: string;
  seed: number;
  mode: 'explore' | 'combat' | 'over';
  transcript: Entry[];
  /** Secrets the gatekeeper has unlocked for the DM. */
  unlockedSecrets: string[];
  /** Enemies removed from play (dead, fled, or talked out of the fight). */
  removedEnemies: string[];
  checksRolled: number;
  pc: PcState;
  combat?: CombatState;
}
