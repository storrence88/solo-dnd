import { pregens, type CharacterSpec } from '../engine';

/**
 * A companion's fixed persona. Everything here is the companion's own knowledge, including its
 * secret; the DM never sees it, and the other companion never sees it.
 */
export interface CompanionDef {
  id: string;
  spec: CharacterSpec;
  pronouns: string;
  /** Who they are, what they want, what they won't do, how they talk, their secret. */
  persona: string;
  /** How they fight. */
  combatStyle: string;
  /** Words that make a moment matter to them and push them toward the spotlight. */
  interests: string[];
  startMood: string;
  /** What leaving the party looks like for them, once trust is truly gone. */
  departure: string;
  /** What betraying the party would look like, if they ever would. Without one they can only leave. A campaign hook can make it specific. */
  betrayal?: string;
  /** Starting trust (0-10) toward other party members, by character id. */
  startTrust: Record<string, number>;
}

export const BRENNA: CompanionDef = {
  id: 'brenna',
  spec: pregens.BRENNA,
  pronouns: 'she/her',
  persona: `Brenna Ashford, human cleric of a small healing god called the Lantern. Age 34. Former field nurse in a war that ended badly.
WANTS: to keep people alive; every death she could have prevented stays with her. Deep down, to stop feeling responsible for the soldiers she couldn't save.
WON'T: kill someone who has surrendered or is helpless; abandon sick or wounded people, enemies included, if she can help them.
VOICE: warm, dry, blunt when tired. Swears by the Lantern. Short sentences under stress.`,
  combatStyle: 'Keeps the party standing first: heals anyone who is down or badly hurt, otherwise hits hard with Guiding Bolt or her mace. Will not strike a foe who has surrendered.',
  interests: ['sick', 'fever', 'child', 'daughter', 'wound', 'hurt', 'heal', 'medicine', 'pray', 'god', 'lantern', 'mercy', 'surrender', 'lira'],
  startMood: 'focused, quietly worried',
  departure: 'Leave before dawn with her healer\'s kit to go where she is needed on her own, leaving a blunt note.',
  startTrust: { steven: 6, quill: 4 },
};

export const QUILL: CompanionDef = {
  id: 'quill',
  spec: pregens.QUILL,
  pronouns: 'they/them',
  persona: `Quill, halfling rogue. Age 41 but looks younger. Grew up running jobs in the river cities; "retired" two years ago.
WANTS: money, enough to stop running for good.
SECRET (only you know this): an old crewmate named Corrin was left behind and caught on your last job. You have never told anyone. You fear being recognised more than dying.
WON'T: hurt children; go back to prison. You will lie, run or bargain before letting that happen.
VOICE: quick, funny, deflects with jokes. Calls Steven "Big Man". Gets very quiet when actually scared. Doesn't like bridges, choke points or crowds.`,
  combatStyle: 'Fights from the edges: picks off wounded or distracted foes for Sneak Attack, hides between shots, and gets out of reach when hurt.',
  interests: ['lock', 'steal', 'coin', 'gold', 'money', 'lie', 'trick', 'thief', 'sneak', 'hide', 'corrin', 'prison', 'guard', 'bribe', 'deal'],
  startMood: 'restless; joking to hide nerves',
  departure: 'Slip away in the night without a word, leaving only a scrawled note.',
  betrayal: 'Slip away in the night with the party\'s purse and anything valuable you can carry, and sell what you know about them to whoever pays, leaving a note that half-apologises.',
  startTrust: { steven: 6, brenna: 7 },
};

export const COMPANIONS: Record<string, CompanionDef> = { [BRENNA.id]: BRENNA, [QUILL.id]: QUILL };

export function companionDef(id: string): CompanionDef {
  const def = COMPANIONS[id];
  if (!def) throw new Error(`Unknown companion ${id}`);
  return def;
}
