import type { Scene } from './scene';
import { SCENES } from './scenes';
import type { GameState } from './state';

/** A hand-written run of scenes, played in order with a night at camp between each. */
export interface Campaign {
  id: string;
  title: string;
  /** Scene ids, in order. */
  scenes: string[];
}

export const ROAD: Campaign = { id: 'road', title: 'The Road to Hollin\'s Rest', scenes: ['greyford', 'hollins-rest'] };
export const SOLO: Campaign = { id: 'greyford-solo', title: 'Greyford Bridge (solo)', scenes: ['greyford-solo'] };

export const CAMPAIGNS: Record<string, Campaign> = { [ROAD.id]: ROAD, [SOLO.id]: SOLO };

/** The scene that follows the current one in the campaign, if any. */
export function nextScene(state: GameState): Scene | undefined {
  const id = CAMPAIGNS[state.campaignId]?.scenes[state.chapter + 1];
  return id ? SCENES[id] : undefined;
}
