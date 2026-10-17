import type { AbilityScores, CombatAction } from '../engine';
import { hooksFor } from './campaign';
import type { CampaignOutline, CompanionHook } from './outline';
import type { Scene } from './scene';

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
  | { kind: 'chapter'; title: string }
  /** The journal changed: quests, factions, a new act. Only the player sees these. */
  | { kind: 'journal'; lines: string[] };

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

export type QuestStatus = 'active' | 'done' | 'failed';

export interface Quest {
  id: string;
  title: string;
  goal: string;
  status: QuestStatus;
  /** What happened along the way, one line per scene that touched it. */
  notes: string[];
}

/** How a faction feels about the party: -2 hostile, -1 wary, 0 neutral, 1 friendly, 2 allied. */
export interface FactionStanding {
  id: string;
  name: string;
  description: string;
  attitude: number;
  /** The party has dealt with them; only then do they show in the journal. */
  met: boolean;
  reasons: string[];
}

/** A "previously on" recap, kept until the story moves on. */
export interface Recap {
  text: string;
  chapter: number;
  beat: number;
}

export interface GameState {
  version: 5;
  id: string;
  campaignId: string;
  /** Index of the current scene in the campaign. */
  chapter: number;
  sceneId: string;
  seed: number;
  /** 'over' means the scene ended; 'camp' is the night before the next scene; 'ended' means the whole campaign is done. */
  mode: 'explore' | 'combat' | 'over' | 'camp' | 'ended';
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
  /** Why each companion is on this journey. Hand-written campaigns set them; generated ones write their own. */
  hooks: Record<string, CompanionHook>;
  /** A generated campaign's plan. Hand-written campaigns have none. */
  outline?: CampaignOutline;
  /** The current scene of a generated campaign (hand-written scenes are looked up by `sceneId`). */
  scene?: Scene;
  /** Index of the current act in the outline, and how many chapters it has run so far. */
  act: number;
  actChapters: number;
  quests: Quest[];
  factions: FactionStanding[];
  recap?: Recap;
  /** The party's level. Everyone shares it; their specs say where they started. */
  level: number;
  /** Ability score increases earned so far, by character id. */
  boosts: Record<string, Partial<AbilityScores>>;
  /** A level-up whose ability increase the player hasn't chosen yet. */
  levelUp?: { level: number };
  /** The player character's pronouns, when the player has set them (custom characters). */
  pcPronouns?: string;
}

/** A companion's inner state at the start of a game. */
export function freshCompanionState(mood: string, trust: Record<string, number>): CompanionState {
  return { mood, trust: { ...trust }, lastLed: -1, memories: [], beliefs: [], feeling: '', intention: '', approvals: [] };
}

type V5Only = 'level' | 'boosts' | 'levelUp' | 'pcPronouns';
type V4Only = V5Only | 'hooks' | 'outline' | 'scene' | 'act' | 'actChapters' | 'quests' | 'factions' | 'recap';
type StateV4 = Omit<GameState, 'version' | V5Only> & { version: 4 };
type StateV3 = Omit<GameState, 'version' | V4Only> & { version: 3 };

type StateV2 = Omit<GameState, V4Only | 'version' | 'campaignId' | 'chapter' | 'history' | 'roster' | 'camp' | 'companions'> & {
  version: 2;
  companions: Record<string, { mood: string; trust: Record<string, number>; lastLed: number }>;
};

/**
 * Brings an older save up to the current shape. Version 1 saves were solo games; version 2 had no
 * memory or campaign; version 3 had only hand-written campaigns; version 4 had no levelling.
 */
export function migrateState(raw: unknown): GameState {
  const s = raw as Record<string, unknown>;
  if (s.version === 5) return raw as GameState;
  const v4 = s.version === 4 ? (raw as StateV4) : fromV3(raw);
  return { ...v4, version: 5, level: v4.scene?.pc.level ?? 3, boosts: {} };
}

function fromV3(raw: unknown): StateV4 {
  const s = raw as Record<string, unknown>;
  const v3 = s.version === 3 ? (raw as StateV3) : fromV2(raw);
  return { ...v3, version: 4, hooks: hooksFor(v3.campaignId), act: 0, actChapters: v3.chapter, quests: [], factions: [] };
}

function fromV2(raw: unknown): StateV3 {
  const s = raw as Record<string, unknown>;
  const v2 = s.version === 2 ? (raw as StateV2) : s.version === 1 ? fromV1(raw) : null;
  if (!v2) throw new Error('Unknown save version');
  const companions: Record<string, CompanionState> = {};
  for (const [id, c] of Object.entries(v2.companions)) companions[id] = { ...freshCompanionState(c.mood, c.trust), lastLed: c.lastLed };
  return {
    ...v2,
    version: 3 as const,
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
