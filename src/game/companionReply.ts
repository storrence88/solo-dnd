import { parseJsonObject, ModelError } from './model';
import type { Intent } from './spotlight';

export interface PollReply {
  intent: Intent;
  urgency: number;
}

/** A poll that can't be read counts as a quiet "support 2": the companion may still react. */
export function parsePoll(text: string): PollReply {
  try {
    const raw = parseJsonObject(text) as Record<string, unknown>;
    const intent = raw.intent === 'lead' || raw.intent === 'pass' ? raw.intent : 'support';
    const urgency = Math.max(1, Math.min(5, Math.round(Number(raw.urgency) || 2)));
    return { intent, urgency };
  } catch {
    return { intent: 'support', urgency: 2 };
  }
}

export interface TurnReply {
  say: string;
  act: string;
  thought: string;
  mood?: string;
  trust: Record<string, number>;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseTurn(text: string, others: string[]): TurnReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const say = clip(raw.say, 600);
  const act = clip(raw.act, 400);
  const thought = clip(raw.thought, 300);
  if (!say && !act && !thought) throw new ModelError('Reply with at least "say", "act" or "thought"');
  const trust: Record<string, number> = {};
  const rawTrust = (raw.trust ?? {}) as Record<string, unknown>;
  for (const id of others) {
    const n = Number(rawTrust[id]);
    if (Number.isFinite(n)) trust[id] = n;
  }
  const mood = clip(raw.mood, 60) || undefined;
  return { say, act, thought, mood, trust };
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
