import type { CharacterSpec, MonsterId } from '../engine';

export interface SceneNpc {
  id: string;
  name: string;
  /** What anyone can see. */
  description: string;
  /** What they want; shapes how the DM plays them. */
  goal: string;
  voice: string;
}

/**
 * A secret stays out of the DM's prompt until its trigger is met. A separate "gatekeeper" call sees
 * only the trigger, never the secret, and decides when it unlocks.
 */
export interface SceneSecret {
  id: string;
  /** The hidden fact, shown to the DM only once unlocked. */
  text: string;
  /** When the DM may learn it, in plain words. */
  trigger: string;
}

export interface SceneEnemy {
  id: string;
  monster: MonsterId;
  name: string;
}

export interface Scene {
  id: string;
  title: string;
  /** Read to the player at the start (the DM may rephrase it). */
  opening: string;
  /** Public situation the DM always knows. */
  situation: string;
  location: string;
  npcs: SceneNpc[];
  secrets: SceneSecret[];
  /** Who fights if it comes to blows. The DM cannot add others. */
  enemies: SceneEnemy[];
  /** Enemies give up once their total HP drops below this fraction. */
  moraleBreak: number;
  /** How the scene can end, so the DM knows when to wrap up. */
  endings: string[];
  pc: CharacterSpec;
}
