/**
 * Who speaks after the player, and in what order. Each companion says how much it wants the
 * moment (lead / support / pass, urgency 1-5); the code then adds what the playtest asked for:
 * the player can hand off by naming someone, moments that touch a companion's interests pull them
 * in, and a companion who hasn't led in a while gets a nudge. One companion leads; the rest react.
 */

export type Intent = 'lead' | 'support' | 'pass';

export interface Poll {
  id: string;
  name: string;
  intent: Intent;
  urgency: number;
  /** Words that make a moment matter to this companion. */
  interests: string[];
  /** The beat they last led (or -1). */
  lastLed: number;
}

export interface SpotlightInput {
  polls: Poll[];
  /** The player's words this beat, and the recent narration they react to. */
  playerText: string;
  recentText: string;
  beat: number;
  /** The player chose "Let the party act": someone must take the lead. */
  handOff: boolean;
}

export interface Speaker {
  id: string;
  role: 'lead' | 'support';
}

const FAIRNESS_GAP = 3;

export function scorePoll(p: Poll, input: SpotlightInput): number {
  const firstName = p.name.split(' ')[0]!.toLowerCase();
  const named = new RegExp(`\\b${firstName}\\b`, 'i').test(input.playerText);
  const text = `${input.playerText} ${input.recentText}`.toLowerCase();
  const interestHits = p.interests.filter((w) => text.includes(w)).length;
  let score = Math.max(1, Math.min(5, p.urgency));
  if (p.intent === 'lead') score += 1;
  if (named) score += 3;
  score += Math.min(2, interestHits);
  if (input.beat - p.lastLed >= FAIRNESS_GAP) score += 1;
  return score;
}

/** Returns speakers in order: at most one lead first, then supporters. Companions who pass and weren't addressed stay quiet. */
export function chooseSpeakers(input: SpotlightInput): Speaker[] {
  const scored = input.polls
    .map((p) => {
      const firstName = p.name.split(' ')[0]!.toLowerCase();
      const named = new RegExp(`\\b${firstName}\\b`, 'i').test(input.playerText);
      const intent: Intent = p.intent === 'pass' && (named || input.handOff) ? 'support' : p.intent;
      return { p, intent, named, score: scorePoll(p, input) };
    })
    .filter((s) => s.intent !== 'pass')
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));

  const leadIdx = scored.findIndex((s) => s.intent === 'lead' || s.named);
  const lead = leadIdx >= 0 ? scored[leadIdx] : input.handOff ? scored[0] : undefined;
  const out: Speaker[] = [];
  if (lead) out.push({ id: lead.p.id, role: 'lead' });
  for (const s of scored) if (s !== lead) out.push({ id: s.p.id, role: 'support' });
  return out;
}
