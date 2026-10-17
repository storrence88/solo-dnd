import { parseJsonObject, ModelError } from './model';
import type { Intent } from './spotlight';

export interface PollReply {
  intent: Intent;
  urgency: number;
  /** What they made of the PC's choice: -1, 0 or 1, with a reason when it isn't 0. */
  approve: -1 | 0 | 1;
  because: string;
}

/** -1, 0 or 1 from whatever the model sent; an approval without a reason doesn't count. */
function readApproval(raw: Record<string, unknown>): { approve: -1 | 0 | 1; because: string } {
  const n = Math.round(Number(raw.approve) || 0);
  const because = clip(raw.because, 160);
  const approve = !because ? 0 : n > 0 ? 1 : n < 0 ? -1 : 0;
  return { approve, because: approve ? because : '' };
}

/** A poll that can't be read counts as a quiet "support 2" with no opinion: the companion may still react. */
export function parsePoll(text: string): PollReply {
  try {
    const raw = parseJsonObject(text) as Record<string, unknown>;
    const intent = raw.intent === 'lead' || raw.intent === 'pass' ? raw.intent : 'support';
    const urgency = Math.max(1, Math.min(5, Math.round(Number(raw.urgency) || 2)));
    return { intent, urgency, ...readApproval(raw) };
  } catch {
    return { intent: 'support', urgency: 2, approve: 0, because: '' };
  }
}

export interface TurnReply {
  say: string;
  act: string;
  thought: string;
  mood?: string;
}

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Pronouns that never refer to a they/them companion. Other people's "his" may still slip through the check, which is why it only asks once. */
const WRONG_FOR_THEY = /\b(he|him|his|himself|she|her|hers|herself)\b/i;

/**
 * Any spoken or acted line: a beat, fireside banter, or a word at camp. `spoken` insists on words.
 * With `pronouns`, an "act" that calls a they/them companion "he" or "she" is sent back once.
 */
export function parseTurn(text: string, { spoken = false, pronouns }: { spoken?: boolean; pronouns?: string } = {}): TurnReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const say = clip(raw.say, 600);
  const act = clip(raw.act, 400);
  const thought = clip(raw.thought, 300);
  if (spoken && !say) throw new ModelError('"say" must not be empty');
  if (!say && !act && !thought) throw new ModelError('Reply with at least "say", "act" or "thought"');
  if (pronouns === 'they/them' && WRONG_FOR_THEY.test(act)) {
    throw new ModelError(`"act" must use they/them for you (for example "shifts their weight", "they duck"); if a he or she in it means someone else, use that person's name instead`);
  }
  const mood = clip(raw.mood, 60) || undefined;
  return { say, act, thought, mood };
}

export interface CampTalkReply extends TurnReply {
  approve: -1 | 0 | 1;
  because: string;
}

export function parseCampTalk(text: string, pronouns?: string): CampTalkReply {
  return { ...parseTurn(text, { spoken: true, pronouns }), ...readApproval(parseJsonObject(text) as Record<string, unknown>) };
}

function readMemories(raw: unknown, max: number): { text: string; importance: number }[] {
  return (Array.isArray(raw) ? raw : [])
    .map((m) => ({ text: clip((m as Record<string, unknown>)?.text, 240), importance: Math.max(1, Math.min(5, Math.round(Number((m as Record<string, unknown>)?.importance) || 2))) }))
    .filter((m) => m.text)
    .slice(0, max);
}

export interface ReflectionReply {
  memories: { text: string; importance: number }[];
  beliefs: string[];
  feeling: string;
  mood?: string;
  intention: string;
  trust: Record<string, number>;
}

export function parseReflection(text: string, others: string[]): ReflectionReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const memories = readMemories(raw.memories, 5);
  if (memories.length === 0) throw new ModelError('"memories" must list at least one memory with "text"');
  const beliefs = (Array.isArray(raw.beliefs) ? raw.beliefs : []).map((b) => clip(b, 160)).filter(Boolean).slice(0, 6);
  const trust: Record<string, number> = {};
  const rawTrust = (raw.trust ?? {}) as Record<string, unknown>;
  for (const id of others) {
    const n = Number(rawTrust[id]);
    if (Number.isFinite(n)) trust[id] = n;
  }
  return { memories, beliefs, feeling: clip(raw.feeling, 120), mood: clip(raw.mood, 60) || undefined, intention: clip(raw.intention, 200), trust };
}

/** Memories from the night's talk; none is a fine answer. */
export function parseCampMemories(text: string): { text: string; importance: number }[] {
  return readMemories((parseJsonObject(text) as Record<string, unknown>).memories, 2);
}

export interface DepartureReply {
  decision: 'stay' | 'leave' | 'betray';
  note: string;
}

export function parseDeparture(text: string, canBetray: boolean): DepartureReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const decision = raw.decision === 'leave' || (raw.decision === 'betray' && canBetray) ? raw.decision : 'stay';
  const note = clip(raw.note, 500);
  if (decision !== 'stay' && !note) throw new ModelError('Leaving needs a "note"');
  return { decision, note };
}

export interface CombatTurnReply {
  choices: number[];
  say: string;
  thought: string;
}

export function parseCombatTurn(text: string, optionCount: number): CombatTurnReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const choices = (Array.isArray(raw.choices) ? raw.choices : [raw.choices])
    .map((c) => Number(c))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < optionCount)
    .slice(0, 3);
  if (choices.length === 0) throw new ModelError(`"choices" must list option numbers from 0 to ${optionCount - 1}`);
  return { choices, say: clip(raw.say, 200), thought: clip(raw.thought, 300) };
}

/** Trust moves at most one point per beat and stays within 0 to 10. */
export function nudgeTrust(current: number, proposed: number): number {
  const step = Math.max(-1, Math.min(1, Math.round(proposed) - current));
  return Math.max(0, Math.min(10, current + step));
}
