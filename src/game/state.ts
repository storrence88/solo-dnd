import type { CombatAction } from '../engine';

/** One line of the story so far. The transcript is append-only and is the save file's heart. */
export type Entry =
  /** `hiddenFrom` lists companions who could not perceive this, e.g. a private talk at camp. */
  | { kind: 'player'; text: string; handOff?: boolean; hiddenFrom?: string[] }
  /** `hiddenFrom` lists companions who could not perceive this (the player always sees it). */
  | { kind: 'dm'; text: string; prompt: string; hiddenFrom?: string[] }
  /** A companion's turn. `thought` is private: other characters never see it. */
  | { kind: 'companion'; id: string; name: string; say: string; act: string; thought: string; role: CompanionRole; hiddenFrom?: string[] }
  /** A companion's reaction to the PC's choice. Only the player sees these; `why` is private. */
  | { kind: 'approval'; id: string; name: string; delta: 1 | -1; why: string }
  | { kind: 'check'; who: string; whoName: string; label: string; dc: number; rolls: number[]; modifier: number; total: number; success: boolean; reason: string }
  | { kind: 'combatStart'; enemyIds: string[] }
  | { kind: 'combatLog'; lines: string[] }
  | { kind: 'combatEnd'; result: CombatResult }
  | { kind: 'sceneEnd'; outcome: string }
  /** Night falls on the party after a scene. */
  | { kind: 'campStart' }
  /** A companion left the party in the night. `text` is what they left behind for the PC. */
  | { kind: 'departure'; id: string; name: string; betrayed: boolean; text: string }
  /** A new scene starts. */
  | { kind: 'chapter'; title: string };

export type CompanionRole = 'lead' | 'support' | 'combat' | 'banter' | 'private';

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

/** Something a companion remembers from an earlier scene, in their own words. */
export interface Memory {
  chapter: number;
  text: string;
  /** 1 (trivia) to 5 (life-changing). */
  importance: number;
}

/** One logged reason a companion's trust in the PC moved. Big moves (leaving, betrayal) need a chain of these. */
export interface Approval {
  chapter: number;
  beat: number;
  delta: 1 | -1;
  why: string;
}

/** A companion's changing inner life. Trust runs 0 to 10 toward each other party member. */
export interface CompanionState {
  mood: string;
  trust: Record<string, number>;
  /** The beat this companion last led, for the spotlight's fairness nudge. */
  lastLed: number;
  memories: Memory[];
  /** Opinions distilled at camp: "Steven keeps his word." Rewritten each night. */
  beliefs: string[];
  /** How they seem to feel about the PC, as the PC could read it. Shown on the party card. */
  feeling: string;
  /** What they privately mean to do next. */
  intention: string;
  approvals: Approval[];
  /** They have already confronted the PC about losing trust: the foreshadowing a departure needs. */
  warned?: boolean;
  /** They have told the PC their secret. */
  confided?: boolean;
}

/** A finished scene (and the camp after it), kept so later scenes stay consistent with it. */
export interface Chapter {
  sceneId: string;
  title: string;
  outcome: string;
  /** The DM's factual summary of what happened. */
  summary: string;
  transcript: Entry[];
}

/** The night between two scenes. */
export interface CampState {
  /** Who came to talk to the PC, and why. */
  approacher?: string;
  reason?: 'confront' | 'confide' | 'talk';
  /** The DM's summary of the scene just ended, kept until the chapter is archived. */
  summary: string;
}

export interface GameState {
  version: 3;
  id: string;
  campaignId: string;
  /** Index of the current scene in the campaign. */
  chapter: number;
  sceneId: string;
  seed: number;
  /** 'over' means the scene ended; 'camp' is the night before the next scene. */
  mode: 'explore' | 'combat' | 'over' | 'camp';
  /** The current scene (and camp) only. Earlier scenes live in `history`. */
  transcript: Entry[];
  history: Chapter[];
  /** Companions still travelling with the PC. */
  roster: string[];
  camp?: CampState;
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

/** A companion's inner state at the start of a game. */
export function freshCompanionState(mood: string, trust: Record<string, number>): CompanionState {
  return { mood, trust: { ...trust }, lastLed: -1, memories: [], beliefs: [], feeling: '', intention: '', approvals: [] };
}

type StateV2 = Omit<GameState, 'version' | 'campaignId' | 'chapter' | 'history' | 'roster' | 'camp' | 'companions'> & {
  version: 2;
  companions: Record<string, { mood: string; trust: Record<string, number>; lastLed: number }>;
};

/** Brings an older save up to the current shape. Version 1 saves were solo games; version 2 had no memory or campaign. */
export function migrateState(raw: unknown): GameState {
  const s = raw as Record<string, unknown>;
  if (s.version === 3) return raw as GameState;
  const v2 = s.version === 2 ? (raw as StateV2) : s.version === 1 ? fromV1(raw) : null;
  if (!v2) throw new Error('Unknown save version');
  const companions: Record<string, CompanionState> = {};
  for (const [id, c] of Object.entries(v2.companions)) companions[id] = { ...freshCompanionState(c.mood, c.trust), lastLed: c.lastLed };
  return {
    ...v2,
    version: 3,
    campaignId: v2.sceneId === 'greyford' ? 'road' : v2.sceneId,
    chapter: 0,
    history: [],
    roster: Object.keys(v2.companions),
    companions,
  };
}

function fromV1(raw: unknown): StateV2 {
  const old = raw as { pc: MemberState; combat?: { seed: number; enemyIds: string[]; actions: CombatAction[]; narratedEvents: number }; transcript: Entry[] } & Record<string, unknown>;
  const pcId = 'steven';
  const transcript = old.transcript.map((e) =>
    e.kind === 'check' ? { ...e, who: (e as { who?: string }).who ?? pcId, whoName: (e as { whoName?: string }).whoName ?? 'Steven' } : e,
  );
  const migrated: StateV2 = {
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
