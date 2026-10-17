import type { CompanionHook } from './outline';
import type { Scene } from './scene';
import { SCENES } from './scenes';
import type { GameState } from './state';

/** A hand-written run of scenes, played in order with a night at camp between each. */
export interface Campaign {
  id: string;
  title: string;
  /** Scene ids, in order. */
  scenes: string[];
  /** Why each companion is on this journey. */
  hooks: Record<string, CompanionHook>;
}

export const ROAD: Campaign = {
  id: 'road',
  title: 'The Road to Hollin\'s Rest',
  scenes: ['greyford', 'hollins-rest'],
  hooks: {
    brenna: {
      hook: 'You are escorting a wagon of fever medicine to Hollin\'s Rest with Steven and Quill. Every hour of delay means someone dies there, and you know it.',
      mood: 'focused, worried about the fever',
    },
    quill: {
      hook: 'You signed on to guard the medicine wagon to Hollin\'s Rest for pay. TEMPTATION: the medicine is worth a lot of coin in the right city. You haven\'t decided anything. It\'s just a thought.',
      mood: 'jumpy; hates this bridge',
      betrayal: 'Slip away in the night with two crates of the medicine to sell in the river cities, leaving a note that half-apologises.',
    },
  },
};
export const SOLO: Campaign = { id: 'greyford-solo', title: 'Greyford Bridge (solo)', scenes: ['greyford-solo'], hooks: {} };

export const CAMPAIGNS: Record<string, Campaign> = { [ROAD.id]: ROAD, [SOLO.id]: SOLO };

/** The campaign id of every generated campaign; its plan lives in the save. */
export const GENERATED = 'generated';

export function hooksFor(campaignId: string): Record<string, CompanionHook> {
  return structuredClone(CAMPAIGNS[campaignId]?.hooks ?? {});
}

export function campaignTitle(state: GameState): string {
  return state.outline?.title ?? CAMPAIGNS[state.campaignId]?.title ?? state.campaignId;
}

/** The scene being played: generated ones live in the save, hand-written ones are looked up. */
export function currentScene(state: GameState): Scene | undefined {
  return state.scene ?? SCENES[state.sceneId];
}

/** The hand-written scene that follows the current one, if any. Generated campaigns plan theirs each morning. */
export function nextScene(state: GameState): Scene | undefined {
  const id = CAMPAIGNS[state.campaignId]?.scenes[state.chapter + 1];
  return id ? SCENES[id] : undefined;
}

/** Whether another chapter follows this one. */
export function hasNextChapter(state: GameState): boolean {
  return state.outline ? state.mode !== 'ended' : !!nextScene(state);
}
