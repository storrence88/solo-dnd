import type { CombatAction } from '../engine';

/** One line of the story so far. The transcript is append-only and is the save file's heart. */
export type Entry =
  | { kind: 'player'; text: string; handOff?: boolean }
  /** `hiddenFrom` lists companions who could not perceive this (the player always sees it). */
  | { kind: 'dm'; text: string; prompt: string; hiddenFrom?: string[] }
  /** A companion's turn. `thought` is private: other characters never see it. */
  | { kind: 'companion'; id: string; name: string; say: string; act: string; thought: string; role: 'lead' | 'support' | 'combat' }
  | { kind: 'check'; who: string; whoName: string; label: string; dc: number; rolls: number[]; modifier: number; total: number; success: boolean; reason: string }
  | { kind: 'combatStart'; enemyIds: string[] }
  | { kind: 'combatLog'; lines: string[] }
  | { kind: 'combatEnd'; result: CombatResult }
  | { kind: 'sceneEnd'; outcome: string };

export type CombatResult = 'victory' | 'enemiesFled' | 'defeat';

export interface RecordedAction {
  actorId: string;
  action: CombatAction;
}

export interface CombatState {
  seed: number;
  enemyIds: string[];
  /** Every action a party member took, in order. Replaying them from the seed rebuilds the fight exactly. */
  actions: RecordedAction[];
  /** How many engine events have already been moved into the transcript. */
  narratedEvents: number;
}

/** What carries over between fights for one party member. */
export interface MemberState {
  hp: number;
  secondWind: number;
  actionSurge: number;
  /** Remaining spell slots by level (index 0 unused), for casters. */
  slots?: number[];
  dead?: boolean;
}

/** A companion's changing inner life. Trust runs 0 to 10 toward each other party member. */
export interface CompanionState {
  mood: string;
  trust: Record<string, number>;
  /** The beat this companion last led, for the spotlight's fairness nudge. */
  lastLed: number;
}

export interface GameState {
  version: 2;
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
  /** Player beats so far. */
  beat: number;
  /** Keyed by character id: the player character and every companion. */
  party: Record<string, MemberState>;
  companions: Record<string, CompanionState>;
  combat?: CombatState;
}

/** Brings an older save up to the current shape. Version 1 saves were solo games. */
export function migrateState(raw: unknown): GameState {
  const s = raw as Record<string, unknown>;
  if (s.version === 2) return raw as GameState;
  if (s.version !== 1) throw new Error('Unknown save version');
  const old = raw as { pc: MemberState; combat?: { seed: number; enemyIds: string[]; actions: CombatAction[]; narratedEvents: number }; transcript: Entry[] } & Record<string, unknown>;
  const pcId = 'steven';
  const transcript = old.transcript.map((e) =>
    e.kind === 'check' ? { ...e, who: (e as { who?: string }).who ?? pcId, whoName: (e as { whoName?: string }).whoName ?? 'Steven' } : e,
  );
  const migrated: GameState = {
    version: 2,
    id: old.id as string,
    sceneId: old.sceneId === 'greyford' ? 'greyford-solo' : (old.sceneId as string),
    seed: old.seed as number,
    mode: old.mode as GameState['mode'],
    transcript,
    unlockedSecrets: old.unlockedSecrets as string[],
    removedEnemies: old.removedEnemies as string[],
    checksRolled: old.checksRolled as number,
    beat: transcript.filter((e) => e.kind === 'player').length,
    party: { [pcId]: { hp: old.pc.hp, secondWind: old.pc.secondWind, actionSurge: old.pc.actionSurge } },
    companions: {},
  };
  if (old.combat) migrated.combat = { ...old.combat, actions: old.combat.actions.map((action) => ({ actorId: pcId, action })) };
  return migrated;
}
