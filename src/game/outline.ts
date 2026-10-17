import { COMPANIONS } from './companions';
import { ModelError, parseJsonObject } from './model';

/** Why a companion is on this journey, and what leaving or betraying the party would mean here. */
export interface CompanionHook {
  hook: string;
  /** How they feel as the story starts. */
  mood?: string;
  /** Overrides the companion's general betrayal with one that fits this story. */
  betrayal?: string;
}

export interface OutlineFaction {
  id: string;
  name: string;
  /** What anyone could learn about them. */
  description: string;
  /** What they are really after. Planner only. */
  goal: string;
  /** -2 hostile to 2 allied, toward the party at the start. */
  attitude: number;
}

export interface OutlineAct {
  title: string;
  /** What the party is working toward in this act, as they would put it. */
  goal: string;
  /** What is really going on and how the act could climax. Planner only. */
  plan: string;
}

/**
 * A generated campaign's plan. The player sees the title, premise and region; the planner sees all
 * of it; the narrating DM sees only the public parts plus whatever each scene unlocks.
 */
export interface CampaignOutline {
  title: string;
  premise: string;
  tone: string;
  region: { name: string; description: string };
  places: { name: string; description: string }[];
  factions: OutlineFaction[];
  /** The villain or central threat. Planner only. */
  threat: { name: string; description: string; goal: string };
  acts: OutlineAct[];
  /** Hidden truths the story can reveal. Planner only; scenes turn them into triggered secrets. */
  secrets: string[];
  endings: string[];
  /** Why the player character is on this road. */
  pcHook: string;
  hooks: Record<string, CompanionHook>;
  firstQuest: { title: string; goal: string };
}

export const TONES = ['heroic', 'grim', 'mystery', 'light-hearted'] as const;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];

/** A short lowercase id from a name or a model-supplied id: "The Salt Guild" -> "salt-guild". */
export function slug(v: unknown, fallback: string): string {
  const s = text(v, 60).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return s || fallback;
}

/** Ids made unique by suffixing duplicates. */
export function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let id = item.id;
    for (let n = 2; seen.has(id); n++) id = `${item.id}-${n}`;
    seen.add(id);
    return { ...item, id };
  });
}

/** Checks the planner's outline and fills the gaps a campaign can't run without. */
export function parseOutline(raw: string, companionIds: string[]): CampaignOutline {
  const o = parseJsonObject(raw) as Record<string, unknown>;
  const title = text(o.title, 80);
  const premise = text(o.premise, 600);
  if (!title || !premise) throw new ModelError('"title" and "premise" are required');
  const acts = list(o.acts)
    .map((a) => ({ title: text(a.title, 80), goal: text(a.goal, 300), plan: text(a.plan, 1200) }))
    .filter((a) => a.title && a.goal);
  if (acts.length !== 3) throw new ModelError('"acts" must have exactly 3 acts, each with a title and a goal');
  const region = (o.region ?? {}) as Record<string, unknown>;
  const threat = (o.threat ?? {}) as Record<string, unknown>;
  const first = (o.firstQuest ?? {}) as Record<string, unknown>;
  if (!text(first.title, 80)) throw new ModelError('"firstQuest" needs a title and a goal');
  const rawHooks = (o.companions ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const hooks: Record<string, CompanionHook> = {};
  for (const id of companionIds) {
    const h = rawHooks[id];
    const hook = text(h?.hook, 600);
    if (!hook) throw new ModelError(`"companions.${id}.hook" is required`);
    hooks[id] = { hook, ...(text(h?.mood, 60) ? { mood: text(h?.mood, 60) } : {}) };
    const betrayal = text(h?.betrayal, 400);
    if (betrayal && COMPANIONS[id]?.betrayal) hooks[id]!.betrayal = betrayal;
  }
  return {
    title,
    premise,
    tone: text(o.tone, 60) || 'heroic',
    region: { name: text(region.name, 80) || title, description: text(region.description, 600) },
    places: list(o.places).map((p) => ({ name: text(p.name, 80), description: text(p.description, 300) })).filter((p) => p.name).slice(0, 8),
    factions: uniqueIds(
      list(o.factions)
        .map((f, i) => ({
          id: slug(f.id ?? f.name, `faction-${i + 1}`),
          name: text(f.name, 80),
          description: text(f.description, 400),
          goal: text(f.goal, 400),
          attitude: Math.max(-2, Math.min(2, Math.round(Number(f.attitude) || 0))),
        }))
        .filter((f) => f.name),
    ).slice(0, 5),
    threat: { name: text(threat.name, 80), description: text(threat.description, 600), goal: text(threat.goal, 400) },
    acts,
    secrets: list(o.secrets).map((s) => text(s as unknown, 400)).filter(Boolean).slice(0, 8),
    endings: list(o.endings).map((s) => text(s as unknown, 300)).filter(Boolean).slice(0, 5),
    pcHook: text(o.pcHook, 600),
    hooks,
    firstQuest: { title: text(first.title, 80), goal: text(first.goal, 300) },
  };
}

/** Attitude as the journal shows it. */
export function attitudeWord(n: number): string {
  return n <= -2 ? 'hostile' : n === -1 ? 'wary' : n === 0 ? 'neutral' : n === 1 ? 'friendly' : 'allied';
}
