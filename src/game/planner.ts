import { buildCharacter, MONSTERS, pregens, type CharacterSpec, type MonsterId } from '../engine';
import { BESTIARY, ENCOUNTER_BUDGET, encounterBudget, MAX_ENEMIES, monsterCost } from './bestiary';
import { GENERATED } from './campaign';
import { companionDef } from './companions';
import { askWithRetry, newGame } from './game';
import { ModelError, parseJsonObject, type ChatMessage, type ModelClient } from './model';
import { attitudeWord, parseOutline, slug, uniqueIds, type CampaignOutline } from './outline';
import { describePc, transcriptForModel } from './prompts';
import type { Scene, SceneEnemy } from './scene';
import type { GameState, Quest, QuestStatus } from './state';

/** Who travels with the player in a generated campaign. A companion generator may come later. */
const COMPANION_IDS = ['brenna', 'quill'];

/** The player character of a generated game: whoever the current scene was written for. */
const pcOf = (state: GameState): CharacterSpec => state.scene?.pc ?? pregens.STEVEN;

/** Who the player is playing, for the outline: their build, pronouns and the background they wrote. */
export interface PlayerCharacter {
  spec: CharacterSpec;
  pronouns?: string;
  background?: string;
}

/** After this many chapters in one act, the next scene is pushed to the act's climax. */
const CLIMAX_AFTER = 3;
/** An act that still hasn't resolved after this many chapters moves on regardless. */
const MAX_ACT_CHAPTERS = 5;

const PLANNER_ROLE = `You plan campaigns for a solo tabletop game using simplified D&D 5e (2014) rules. One human plays the player character (PC); AI companions travel with them; an AI Dungeon Master narrates each scene from a plan you write. The party is level 3: threats are local and personal (gangs, cults, beasts in the hills, scheming nobles, a haunted ruin), not the end of the world.`;

// ---- Outline ---------------------------------------------------------------------

export function buildOutlineMessages(premise: string, tone: string, pc: PlayerCharacter = { spec: pregens.STEVEN }): ChatMessage[] {
  const companions = COMPANION_IDS.map(companionDef);
  return [
    {
      role: 'system',
      content:
        `${PLANNER_ROLE}\n\nDesign a new campaign from the player's premise and tone. It has three acts, and each act should take 2 or 3 scenes.\n` +
        '- Original names and places; no famous published settings.\n' +
        '- Factions (2 to 4) want conflicting things, so siding with one costs something with another. "attitude" is how each feels about the party at the start, from -2 (hostile) to 2 (allied); most start at 0.\n' +
        '- The threat is the villain or central danger, which the party learns about over time.\n' +
        '- Acts: "goal" is what the party is working toward, as they would say it; "plan" is what is really happening and how the act could reach its climax.\n' +
        '- Secrets are hidden truths that change how things look when found.\n' +
        '- Endings (2 to 4) are shaped by the party\'s choices: who they side with, who lives, what they give up.\n' +
        '- For each companion, "hook" says in 2 or 3 sentences, to them ("You ..."), why they are on this journey and what personal stake could pull them against the PC. "mood" is how they feel as it starts. For a companion who could betray the party, "betrayal" is what that would look like in this story.\n' +
        '- A companion\'s secret is theirs to tell. You may bring in things that touch it (someone from their past), but never make it part of the plot\'s secrets.\n' +
        '- "pcHook" says why the PC is on this road. "firstQuest" is what the party sets out to do in the first scene.\n\n' +
        'Reply with JSON only:\n' +
        '{"title": "...", "premise": "2 or 3 sentences the player reads", "tone": "...", "region": {"name": "...", "description": "..."}, ' +
        '"places": [{"name": "...", "description": "..."}], "factions": [{"id": "short-id", "name": "...", "description": "what anyone could learn", "goal": "what they really want", "attitude": 0}], ' +
        '"threat": {"name": "...", "description": "...", "goal": "..."}, "acts": [{"title": "...", "goal": "...", "plan": "..."}], "secrets": ["..."], "endings": ["..."], ' +
        `"pcHook": "...", "companions": {${COMPANION_IDS.map((id) => `"${id}": {"hook": "...", "mood": "..."${companionDef(id).betrayal ? ', "betrayal": "..."' : ''}}`).join(', ')}}, "firstQuest": {"title": "...", "goal": "..."}}`,
    },
    {
      role: 'user',
      content:
        `PREMISE: ${premise || 'Surprise me: invent something fresh.'}\nTONE: ${tone}\n\n` +
        `THE PC: ${describePc(buildCharacter(pc.spec), pc.pronouns)}\n` +
        (pc.background ? `THE PLAYER'S BACKGROUND FOR THEM (weave it into the PC's hook): ${pc.background}\n` : '') +
        '\n' +
        `THE COMPANIONS:\n${companions.map((c) => `[${c.id}] (pronouns ${c.pronouns})\n${c.persona}`).join('\n\n')}`,
    },
  ];
}

export async function generateOutline(model: ModelClient, premise: string, tone: string, pc?: PlayerCharacter): Promise<CampaignOutline> {
  const outline = await askWithRetry(model, 'dm', buildOutlineMessages(premise, tone, pc), (t) => parseOutline(t, COMPANION_IDS));
  if (!outline) throw new ModelError('The DM could not plan a campaign this time. Try again.');
  return outline;
}

// ---- Scenes ----------------------------------------------------------------------

function outlineText(o: CampaignOutline): string {
  return [
    `TITLE: ${o.title}\nPREMISE: ${o.premise}\nTONE: ${o.tone}`,
    `REGION: ${o.region.name}. ${o.region.description}`,
    o.places.length ? `PLACES:\n${o.places.map((p) => `- ${p.name}: ${p.description}`).join('\n')}` : '',
    `THREAT: ${o.threat.name}. ${o.threat.description} Wants: ${o.threat.goal}`,
    `ACTS:\n${o.acts.map((a, i) => `${i + 1}. ${a.title}. Goal: ${a.goal} Plan: ${a.plan}`).join('\n')}`,
    o.secrets.length ? `SECRETS:\n${o.secrets.map((s) => `- ${s}`).join('\n')}` : '',
    `POSSIBLE ENDINGS:\n${o.endings.map((e) => `- ${e}`).join('\n')}`,
    o.pcHook ? `WHY THE PC IS HERE: ${o.pcHook}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function questsText(quests: Quest[]): string {
  return quests.length ? quests.map((q) => `- [${q.id}] ${q.title} (${q.status}): ${q.goal}${q.notes.length ? ` Notes: ${q.notes.join(' ')}` : ''}`).join('\n') : '(none)';
}

export function buildScenePlanMessages(state: GameState): ChatMessage[] {
  const o = state.outline!;
  const act = o.acts[state.act]!;
  const climax = state.actChapters >= CLIMAX_AFTER;
  const budget = encounterBudget(state.level);
  const party = [`${pcOf(state).name} (${pcOf(state).classId})`, ...state.roster.filter((id) => !state.party[id]?.dead).map((id) => companionDef(id).spec.name)];
  const departed = Object.keys(state.companions).filter((id) => !state.roster.includes(id));
  const dead = Object.keys(state.companions).filter((id) => state.party[id]?.dead);
  return [
    {
      role: 'system',
      content:
        `${PLANNER_ROLE}\n\nWrite the plan for the next scene of a campaign that is under way. A scene is one place and one situation with a clear problem, playable in 10 to 30 player turns.\n` +
        '- It is the morning after the last scene. Carry on from where that left off and stay true to everything in EARLIER CHAPTERS: the dead stay dead, promises and grudges carry over, and people the party met can return (same names).\n' +
        `- Move the current act toward its goal.${climax ? ' This scene is the act\'s climax: the act\'s goal must be won or lost here.' : ''}\n` +
        '- "opening" is read to the player: second person, present tense, 60 to 120 words, setting the scene and ending on the situation, with no question. "situation" is the facts the DM always knows. "location" describes the place and anything useful in it.\n' +
        '- 2 to 5 "npcs", each with what they want and how they talk.\n' +
        '- 1 to 3 "secrets", each a hidden fact with a "trigger": what the party must do to learn it, in plain words. Draw on the campaign\'s secrets when the story is ready for them.\n' +
        `- "enemies" are who would fight if it comes to blows, and may be empty: not every scene is a fight, and people can often be talked down. Give each a stat block from MONSTERS and a name ("Marla the Fence" can use bandit). Their total cost must be at most ${budget}, with at most ${MAX_ENEMIES} enemies.\n` +
        '- 2 to 4 "endings": the ways this scene can finish, good and bad.\n' +
        `MONSTERS (id, challenge, cost, fits):\n${BESTIARY.map((b) => `- ${b.id} (CR ${b.cr}, cost ${monsterCost(b.id)}): ${b.note}`).join('\n')}\n\n` +
        'Reply with JSON only: {"title": "...", "location": "...", "opening": "...", "situation": "...", "npcs": [{"id": "short-id", "name": "...", "description": "what anyone can see", "goal": "...", "voice": "..."}], ' +
        '"secrets": [{"id": "short-id", "text": "...", "trigger": "..."}], "enemies": [{"id": "short-id", "monster": "<monster id>", "name": "..."}], "endings": ["..."]}',
    },
    {
      role: 'user',
      content:
        `CAMPAIGN PLAN:\n${outlineText(o)}\n\n` +
        `CURRENT ACT: ${state.act + 1} of ${o.acts.length}, "${act.title}". This will be chapter ${state.actChapters + 1} of this act and chapter ${state.chapter + 1} overall.\n\n` +
        `EARLIER CHAPTERS:\n${state.history.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join('\n') || '(none)'}\n\n` +
        `QUESTS:\n${questsText(state.quests)}\n\n` +
        `FACTIONS:\n${state.factions.map((f) => `- ${f.name} (${attitudeWord(f.attitude)} toward the party): ${f.description}`).join('\n') || '(none)'}\n\n` +
        `THE PARTY NOW (level ${state.level}): ${party.join(', ')}.` +
        (departed.length ? ` No longer with them: ${departed.map((id) => companionDef(id).spec.name).join(', ')}.` : '') +
        (dead.length ? ` Dead: ${dead.map((id) => companionDef(id).spec.name).join(', ')}.` : ''),
    },
  ];
}

/** Checks a planned scene and turns it into one the game can run. Enemies outside the bestiary or the budget are dropped. */
export function parseScenePlan(raw: string, id: string, pc: CharacterSpec, companions: string[], budgetLimit = ENCOUNTER_BUDGET): Scene {
  const o = parseJsonObject(raw) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const title = text(o.title, 80);
  const opening = text(o.opening, 1200);
  if (!title || !opening) throw new ModelError('"title" and "opening" are required');
  const npcs = uniqueIds(
    list(o.npcs)
      .map((n, i) => ({ id: slug(n.id ?? n.name, `npc-${i + 1}`), name: text(n.name, 80), description: text(n.description, 400), goal: text(n.goal, 300), voice: text(n.voice, 200) }))
      .filter((n) => n.name),
  ).slice(0, 6);
  const secrets = uniqueIds(
    list(o.secrets)
      .map((s, i) => ({ id: slug(s.id, `secret-${i + 1}`), text: text(s.text, 600), trigger: text(s.trigger, 400) }))
      .filter((s) => s.text && s.trigger),
  ).slice(0, 4);
  const endings = list(o.endings).map((e) => text(e as unknown, 300)).filter(Boolean).slice(0, 5);
  if (endings.length === 0) throw new ModelError('"endings" must list how the scene can end');

  const reserved = new Set([pc.id, ...companions]);
  let budget = budgetLimit;
  const enemies: SceneEnemy[] = [];
  for (const [i, e] of list(o.enemies).entries()) {
    const monster = String(e.monster ?? '') as MonsterId;
    if (!BESTIARY.some((b) => b.id === monster) || enemies.length >= MAX_ENEMIES || monsterCost(monster) > budget) continue;
    budget -= monsterCost(monster);
    let eid = slug(e.id ?? e.name, `enemy-${i + 1}`);
    if (reserved.has(eid)) eid = `enemy-${eid}`;
    enemies.push({ id: eid, monster, name: text(e.name, 60) || MONSTERS[monster].name });
  }

  return {
    id,
    title,
    opening,
    situation: text(o.situation, 1200),
    location: text(o.location, 800),
    npcs,
    secrets,
    enemies: uniqueIds(enemies),
    moraleBreak: 0.5,
    endings,
    pc,
    companions,
  };
}

/** The planner writes the scene for the chapter that is about to start. */
export async function planScene(state: GameState, model: ModelClient): Promise<Scene> {
  const companions = state.roster.filter((id) => !state.party[id]?.dead);
  const scene = await askWithRetry(model, 'dm', buildScenePlanMessages(state), (t) => parseScenePlan(t, `chapter-${state.chapter + 1}`, pcOf(state), companions, encounterBudget(state.level)));
  if (!scene) throw new ModelError('The DM could not plan the next scene. Try again.');
  return scene;
}

/** A brand-new generated campaign: the outline, then its first scene. Without a character, the player is Steven. */
export async function newCampaign(model: ModelClient, opts: { premise: string; tone: string; pc?: PlayerCharacter }, id: string, seed: number): Promise<GameState> {
  const pc = opts.pc ?? { spec: pregens.STEVEN };
  const outline = await generateOutline(model, opts.premise.trim().slice(0, 500), opts.tone, pc);
  const draft = newGame({ id: 'planning', title: outline.title, opening: '', situation: '', location: '', npcs: [], secrets: [], enemies: [], moraleBreak: 0.5, endings: [], pc: pc.spec, companions: COMPANION_IDS }, id, seed, GENERATED, outline);
  if (pc.pronouns) draft.pcPronouns = pc.pronouns;
  const scene = await planScene(draft, model);
  const state = newGame(scene, id, seed, GENERATED, outline);
  if (pc.pronouns) state.pcPronouns = pc.pronouns;
  state.transcript.unshift({ kind: 'chapter', title: scene.title });
  return state;
}

// ---- Scene end: the ledger ---------------------------------------------------------

export interface LedgerReply {
  summary: string;
  quests: { id: string; title: string; goal: string; status: QuestStatus; note: string }[];
  factions: { id: string; change: -1 | 0 | 1; why: string }[];
  actDone: boolean;
}

export function buildLedgerMessages(state: GameState, scene: Scene): ChatMessage[] {
  const o = state.outline!;
  const act = o.acts[state.act]!;
  return [
    {
      role: 'system',
      content:
        'You keep the record for a tabletop campaign. From the scene below, write:\n' +
        '- "summary": the scene as plain facts in 3 to 6 sentences: what the party did, who they helped or hurt, what they gained or lost, promises made, who died, and what is left unresolved. No style, no speculation.\n' +
        '- "quests": changes only. For an existing quest, its id with the new status ("active", "done" or "failed") and a one-line note on what happened. Add a new quest (a new short id, a title and a goal) only if the party clearly took one on.\n' +
        '- "factions": each faction the party dealt with in this scene, directly or by reputation, with "change" -1, 0 or 1 in how it feels about the party and why. 0 means they met but nothing changed.\n' +
        '- "actDone": true only if the current act\'s goal was clearly achieved, or clearly lost for good, in this scene.\n' +
        'Reply with JSON only: {"summary": "...", "quests": [{"id": "...", "title": "...", "goal": "...", "status": "active", "note": "..."}], "factions": [{"id": "...", "change": 0, "why": "..."}], "actDone": false}',
    },
    {
      role: 'user',
      content:
        `CURRENT ACT: ${act.title}. Goal: ${act.goal}\n\n` +
        `QUESTS:\n${questsText(state.quests)}\n\n` +
        `FACTIONS:\n${state.factions.map((f) => `- [${f.id}] ${f.name}: ${f.description}`).join('\n') || '(none)'}\n\n` +
        `SCENE: ${scene.title}\n${transcriptForModel(state.transcript.filter((e) => e.kind !== 'combatLog'), scene, 80)}`,
    },
  ];
}

export function parseLedger(raw: string): LedgerReply {
  const o = parseJsonObject(raw) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const summary = text(o.summary, 1500);
  if (!summary) throw new ModelError('"summary" is required');
  const status = (v: unknown): QuestStatus => (v === 'done' || v === 'failed' ? v : 'active');
  return {
    summary,
    quests: list(o.quests)
      .map((q) => ({ id: text(q.id, 40), title: text(q.title, 80), goal: text(q.goal, 300), status: status(q.status), note: text(q.note, 300) }))
      .filter((q) => q.id || q.title),
    factions: list(o.factions)
      .map((f) => ({ id: text(f.id, 40), change: Math.max(-1, Math.min(1, Math.round(Number(f.change) || 0))) as -1 | 0 | 1, why: text(f.why, 200) }))
      .filter((f) => f.id),
    actDone: o.actDone === true,
  };
}

/** Applies the ledger to quests, factions and the act. Returns the journal lines the player sees. */
export function applyLedger(state: GameState, ledger: LedgerReply): string[] {
  const lines: string[] = [];
  for (const u of ledger.quests) {
    const quest = state.quests.find((q) => q.id === u.id || (!!u.title && q.title.toLowerCase() === u.title.toLowerCase()));
    if (quest) {
      if (u.note) quest.notes.push(u.note);
      if (u.status !== quest.status) {
        quest.status = u.status;
        lines.push(`Quest ${u.status === 'done' ? 'complete' : u.status === 'failed' ? 'failed' : 'reopened'}: ${quest.title}`);
      } else if (u.note) {
        lines.push(`Quest updated: ${quest.title}`);
      }
    } else if (u.title && u.status === 'active') {
      const id = slug(u.id || u.title, `quest-${state.quests.length + 1}`);
      state.quests.push({ id: state.quests.some((q) => q.id === id) ? `${id}-${state.quests.length + 1}` : id, title: u.title, goal: u.goal, status: 'active', notes: u.note ? [u.note] : [] });
      lines.push(`New quest: ${u.title}`);
    }
  }
  for (const u of ledger.factions) {
    const f = state.factions.find((x) => x.id === u.id);
    if (!f) continue;
    const before = attitudeWord(f.attitude);
    f.attitude = Math.max(-2, Math.min(2, f.attitude + u.change));
    if (u.why && u.change) f.reasons.push(u.why);
    if (!f.met) lines.push(`You have dealt with ${f.name}: ${attitudeWord(f.attitude)}`);
    else if (attitudeWord(f.attitude) !== before) lines.push(`${f.name} now seem ${attitudeWord(f.attitude)} toward you`);
    f.met = true;
  }
  return lines;
}

/** Moves to the next act if this one is done (or has run too long). Returns true when the last act just ended. */
export function advanceAct(state: GameState, actDone: boolean, lines: string[]): boolean {
  const o = state.outline!;
  state.actChapters += 1;
  if (!actDone && state.actChapters < MAX_ACT_CHAPTERS) return false;
  if (state.act + 1 >= o.acts.length) return true;
  state.act += 1;
  state.actChapters = 0;
  lines.push(`Act ${state.act + 1} begins: ${o.acts[state.act]!.title}`);
  return false;
}

// ---- Recap -----------------------------------------------------------------------

export function buildRecapMessages(state: GameState, scene: Scene, title: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You write the "previously on…" for a player coming back to their tabletop game. 60 to 120 words, second person ("you"), past tense, vivid but using only the facts below. End with where things stand right now.\n' +
        'Reply with JSON only: {"recap": "..."}',
    },
    {
      role: 'user',
      content:
        `CAMPAIGN: ${title}${state.outline ? `. ${state.outline.premise}` : ''}\n\n` +
        (state.history.length ? `EARLIER CHAPTERS:\n${state.history.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join('\n')}\n\n` : '') +
        `CURRENT CHAPTER: ${scene.title}\n${transcriptForModel(state.transcript.filter((e) => e.kind !== 'combatLog'), scene, 20)}`,
    },
  ];
}

export async function writeRecap(state: GameState, scene: Scene, title: string, model: ModelClient): Promise<void> {
  if (state.recap && state.recap.chapter === state.chapter && state.recap.beat === state.beat) return;
  const recap = await askWithRetry(model, 'helper', buildRecapMessages(state, scene, title), (t) => {
    const text = (parseJsonObject(t) as { recap?: unknown }).recap;
    if (typeof text !== 'string' || !text.trim()) throw new ModelError('"recap" is required');
    return text.trim().slice(0, 1500);
  });
  if (!recap) throw new ModelError('The DM could not write a recap right now.');
  state.recap = { text: recap, chapter: state.chapter, beat: state.beat };
}
