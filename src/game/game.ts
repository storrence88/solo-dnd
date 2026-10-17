import {
  abilityCheck,
  applyAction,
  buildCharacter,
  buildMonster,
  describeEvent,
  Encounter,
  legalActions,
  seededRng,
  takeTurn,
  type AbilityScores,
  type CombatAction,
  type Combatant,
  type LegalAction,
} from '../engine';
import { campaignTitle, hasNextChapter, hooksFor, nextScene } from './campaign';
import { attitudeWord, slug, type CampaignOutline } from './outline';
import { levelled } from './progression';
import { companionDef, type CompanionDef } from './companions';
import { nudgeTrust, parseCombatTurn, parsePoll, parseTurn } from './companionReply';
import { parseDmReply, type DmReply, type DmReplyRules } from './dmReply';
import { ModelError, parseJsonObject, type ChatMessage, type ModelClient } from './model';
import {
  buildCompanionCombatMessages,
  buildCompanionTurnMessages,
  buildDmMessages,
  buildGatekeeperMessages,
  buildPollMessages,
} from './prompts';
import type { Scene } from './scene';
import { chooseSpeakers, type Poll } from './spotlight';
import { freshCompanionState, type CombatResult, type CompanionState, type Entry, type GameState, type MemberState, type Quest } from './state';

/**
 * A new game starting at `scene`, the first scene of campaign `campaignId`. A generated campaign
 * passes its outline, and its first scene is kept in the save.
 */
export function newGame(scene: Scene, id: string, seed: number, campaignId = scene.id, outline?: CampaignOutline): GameState {
  const hooks = outline ? structuredClone(outline.hooks) : hooksFor(campaignId);
  const party: Record<string, MemberState> = {};
  const companions: Record<string, CompanionState> = {};
  for (const spec of [scene.pc, ...scene.companions.map((c) => companionDef(c).spec)]) {
    const c = buildCharacter(spec);
    party[c.id] = { hp: c.hp, secondWind: c.resources.secondWind, actionSurge: c.resources.actionSurge, slots: c.spellcasting?.slots };
  }
  for (const cid of scene.companions) {
    const def = companionDef(cid);
    // Companions' starting trust in the PC is written for Steven; a custom PC inherits it.
    const trust = Object.fromEntries(Object.entries(def.startTrust).map(([who, n]) => [who === 'steven' ? scene.pc.id : who, n]));
    companions[cid] = freshCompanionState(hooks[cid]?.mood ?? def.startMood, trust);
  }
  const state: GameState = {
    version: 5,
    id,
    campaignId,
    chapter: 0,
    sceneId: scene.id,
    seed,
    mode: 'explore',
    transcript: [{ kind: 'dm', text: scene.opening, prompt: 'What do you do?' }],
    history: [],
    roster: [...scene.companions],
    unlockedSecrets: [],
    removedEnemies: [],
    checksRolled: 0,
    beat: 0,
    party,
    companions,
    hooks,
    act: 0,
    actChapters: 0,
    quests: [],
    factions: [],
    level: scene.pc.level,
    boosts: {},
  };
  if (outline) {
    state.outline = outline;
    state.scene = scene;
    state.quests = [{ id: slug(outline.firstQuest.title, 'quest-1'), title: outline.firstQuest.title, goal: outline.firstQuest.goal, status: 'active', notes: [] }];
    state.factions = outline.factions.map((f) => ({ id: f.id, name: f.name, description: f.description, attitude: f.attitude, met: false, reasons: [] }));
  }
  return state;
}

/** Every party member, player character first, with current HP, resources and spell slots applied. */
export function partyMembers(state: GameState, scene: Scene, { includeDead = false } = {}): Combatant[] {
  const specs = [scene.pc, ...state.roster.map((c) => companionDef(c).spec)].map((spec) => levelled(state, spec));
  return specs
    .filter((spec) => includeDead || !state.party[spec.id]?.dead)
    .map((spec) => {
      const c = buildCharacter(spec);
      const m = state.party[spec.id];
      if (m) {
        c.hp = m.hp;
        c.resources = { secondWind: m.secondWind, actionSurge: m.actionSurge };
        if (c.spellcasting && m.slots) c.spellcasting.slots = [...m.slots];
        if (m.dead) c.status = 'dead';
      }
      return c;
    });
}

export function currentPc(state: GameState, scene: Scene): Combatant {
  return partyMembers(state, scene, { includeDead: true })[0]!;
}

/** Companions still with the party and alive. */
export const livingCompanions = (state: GameState) => state.roster.filter((id) => !state.party[id]?.dead);

/**
 * One exploration beat. The player acts first; the gatekeeper unlocks any secrets whose trigger was
 * met; the companions react in spotlight order; then the DM resolves it all. If the DM asks for a
 * check, the engine rolls it and the DM narrates the result.
 */
export async function playerActs(
  state: GameState,
  scene: Scene,
  model: ModelClient,
  text: string,
  { handOff = false } = {},
): Promise<void> {
  if (state.mode !== 'explore') throw new ModelError(state.mode === 'combat' ? 'Choose a combat action instead' : 'The scene is over');
  const said = handOff ? `(${scene.pc.name} holds back and lets the party take the lead.)` : text.trim();
  if (!said) return;
  state.beat += 1;
  state.transcript.push(handOff ? { kind: 'player', text: said, handOff: true } : { kind: 'player', text: said });
  await unlockSecrets(state, scene, model);
  await companionsReact(state, scene, model, said, handOff);

  const reply = await askDm(state, scene, model, 'Respond to what the party just did (the PC first, then any companions).', { allowCheck: true, allowCombat: true });
  await applyDmReply(state, scene, model, reply);
}

async function companionsReact(state: GameState, scene: Scene, model: ModelClient, playerText: string, handOff: boolean): Promise<void> {
  const ids = livingCompanions(state);
  if (ids.length === 0) return;
  const party = partyMembers(state, scene);
  const me = (id: string) => party.find((c) => c.id === id)!;

  const replies = await Promise.all(
    ids.map(async (id) => {
      try {
        return parsePoll(await model.complete({ role: 'helper', messages: buildPollMessages(state, scene, companionDef(id), me(id), party), json: true }));
      } catch (e) {
        if (isFatal(e)) throw e;
        return parsePoll('');
      }
    }),
  );
  // Everyone judges the PC's choice, whether or not they speak. Holding back is not a choice to judge.
  if (!handOff) ids.forEach((id, i) => recordApproval(state, scene, id, replies[i]!.approve, replies[i]!.because));
  const polls: Poll[] = ids.map((id, i) => ({
    id, name: me(id).name, intent: replies[i]!.intent, urgency: replies[i]!.urgency, interests: companionDef(id).interests, lastLed: state.companions[id]!.lastLed,
  }));
  const lastDm = [...state.transcript].reverse().find((e) => e.kind === 'dm');
  const speakers = chooseSpeakers({ polls, playerText, recentText: lastDm?.kind === 'dm' ? lastDm.text : '', beat: state.beat, handOff });

  let leadName: string | undefined;
  for (const { id, role } of speakers) {
    const def = companionDef(id);
    const messages = buildCompanionTurnMessages(state, scene, def, me(id), party, role, role === 'support' ? leadName : undefined);
    const turn = await askWithRetry(model, 'companion', messages, (t, last) => parseTurn(t, { pronouns: last ? undefined : def.pronouns }));
    if (!turn) continue; // a companion who can't answer just stays quiet this beat
    state.transcript.push({ kind: 'companion', id, name: me(id).name, say: turn.say, act: turn.act, thought: turn.thought, role });
    const cs = state.companions[id]!;
    if (turn.mood) cs.mood = turn.mood;
    if (role === 'lead') {
      cs.lastLed = state.beat;
      leadName = me(id).name;
    }
  }
}

/**
 * A companion's reaction to the PC's choice: trust in the PC moves one point and the reason is
 * logged, since leaving or betraying the party later needs a chain of real causes.
 */
export function recordApproval(state: GameState, scene: Scene, id: string, delta: -1 | 0 | 1, why: string): void {
  if (!delta) return;
  const cs = state.companions[id]!;
  const pcId = scene.pc.id;
  cs.trust[pcId] = nudgeTrust(cs.trust[pcId] ?? 5, (cs.trust[pcId] ?? 5) + delta);
  cs.approvals.push({ chapter: state.chapter, beat: state.beat, delta, why });
  state.transcript.push({ kind: 'approval', id, name: companionDef(id).spec.name, delta, why });
}

/** Rate limits and bad keys stop the turn; anything else a companion gets wrong just costs them their line. */
export function isFatal(e: unknown): boolean {
  return /rate limiting|\((401|403)\)/.test((e as Error).message);
}

/** `last` tells the parser this is the final try, so it can let a minor slip through rather than lose the reply. */
export async function askWithRetry<T>(model: ModelClient, role: 'dm' | 'companion' | 'helper', messages: ChatMessage[], parse: (text: string, last: boolean) => T): Promise<T | null> {
  const msgs = [...messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await model.complete({ role, messages: msgs, json: true });
    } catch (e) {
      if (isFatal(e)) throw e;
      continue;
    }
    try {
      return parse(text, attempt === 1);
    } catch (e) {
      msgs.push({ role: 'assistant', content: text }, { role: 'user', content: `That reply broke a rule: ${(e as Error).message}. Reply again with corrected JSON only.` });
    }
  }
  return null;
}

async function applyDmReply(state: GameState, scene: Scene, model: ModelClient, reply: DmReply): Promise<void> {
  state.transcript.push(dmEntry(reply));
  const action = reply.action;
  if (action.type === 'check') {
    const actor = partyMembers(state, scene).find((c) => c.id === action.who) ?? currentPc(state, scene);
    const result = abilityCheck(actor, action.check, action.dc, seededRng(state.seed * 7919 + state.checksRolled));
    state.checksRolled += 1;
    state.transcript.push({
      kind: 'check', who: actor.id, whoName: actor.name, label: checkLabel(action.check), dc: action.dc, rolls: result.rolls,
      modifier: result.modifier, total: result.total, success: result.success, reason: action.reason,
    });
    const followUp = await askDm(
      state, scene, model,
      `The rules engine has resolved the CHECK above. A SUCCESS means ${actor.name} gets what they were attempting; a FAILURE means they do not. Narrate what happens because of that result. Do not ask for another check now.`,
      { allowCheck: false, allowCombat: true },
    );
    await applyDmReply(state, scene, model, followUp);
  } else if (action.type === 'combat') {
    startCombat(state, action.enemies);
    await advanceCombat(state, scene, model);
  } else if (action.type === 'endScene') {
    state.transcript.push({ kind: 'sceneEnd', outcome: action.outcome });
    state.mode = 'over';
  }
}

export function dmEntry(reply: DmReply): Entry {
  return reply.hiddenFrom.length
    ? { kind: 'dm', text: reply.narration, prompt: reply.prompt, hiddenFrom: reply.hiddenFrom }
    : { kind: 'dm', text: reply.narration, prompt: reply.prompt };
}

async function unlockSecrets(state: GameState, scene: Scene, model: ModelClient): Promise<void> {
  const messages = buildGatekeeperMessages(state, scene);
  if (!messages) return;
  try {
    const raw = parseJsonObject(await model.complete({ role: 'helper', messages, json: true })) as { met?: unknown };
    const met = Array.isArray(raw.met) ? raw.met.map(String) : [];
    for (const id of met) {
      if (scene.secrets.some((s) => s.id === id) && !state.unlockedSecrets.includes(id)) state.unlockedSecrets.push(id);
    }
  } catch (e) {
    // A failed gatekeeper call only means no secret unlocks this beat; the story goes on.
    if (isFatal(e)) throw e;
  }
}

/** Asks the DM, checks the reply against the rules, and gives the model one retry with the error if it breaks them. */
export async function askDm(
  state: GameState,
  scene: Scene,
  model: ModelClient,
  instruction: string,
  allow: Pick<DmReplyRules, 'allowCheck' | 'allowCombat'>,
): Promise<DmReply> {
  const rules: DmReplyRules = {
    ...allow,
    enemyIds: scene.enemies.map((e) => e.id).filter((id) => !state.removedEnemies.includes(id)),
    unlockedSecrets: state.unlockedSecrets,
    pcId: scene.pc.id,
    companionIds: livingCompanions(state),
  };
  if (rules.enemyIds.length === 0) rules.allowCombat = false;
  const messages: ChatMessage[] = buildDmMessages(state, scene, partyMembers(state, scene, { includeDead: true }), instruction);
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await model.complete({ role: 'dm', messages, json: true });
    } catch (e) {
      // A rate limit or a bad key won't fix itself on an instant retry; anything else (e.g. JSON mode rejecting the reply) gets one more try.
      if (isFatal(e)) throw e;
      lastError = (e as Error).message;
      continue;
    }
    try {
      return parseDmReply(text, rules);
    } catch (e) {
      lastError = (e as Error).message;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That reply broke a rule: ${lastError}. Reply again with corrected JSON only.` });
    }
  }
  throw new ModelError(`The DM's reply could not be used: ${lastError}`);
}

// ---- Combat --------------------------------------------------------------------

function startCombat(state: GameState, enemyIds: string[]): void {
  state.mode = 'combat';
  state.combat = { seed: state.seed * 104729 + state.transcript.length, enemyIds, actions: [], narratedEvents: 0 };
  state.transcript.push({ kind: 'combatStart', enemyIds });
}

export interface CombatSnapshot {
  enc: Encounter;
  result: CombatResult | null;
  /** Whose decision the fight is waiting on: the player character's id or a companion's. */
  waitingOn: string | null;
}

/**
 * Rebuilds the fight from its seed and the party's recorded actions. Enemies act through the
 * autopilot. Stops when a party member is up with no recorded action left, or the fight ends.
 */
export function replayCombat(state: GameState, scene: Scene): CombatSnapshot {
  const combat = state.combat;
  if (!combat) throw new Error('No combat in progress');
  const party = partyMembers(state, scene);
  const enemies = scene.enemies.filter((e) => combat.enemyIds.includes(e.id)).map((e) => buildMonster(e.monster, e.id, e.name));
  const startingEnemyHp = enemies.reduce((sum, e) => sum + e.maxHp, 0);
  const enc = new Encounter([...party, ...enemies], seededRng(combat.seed));
  enc.start();

  const morale = () => {
    const left = enc.combatants.filter((c) => c.side === 'enemy').reduce((sum, c) => sum + c.hp, 0);
    return left > 0 && left < startingEnemyHp * scene.moraleBreak;
  };
  let next = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    if (enc.isOver()) return { enc, result: enc.winner === 'party' ? 'victory' : 'defeat', waitingOn: null };
    if (morale()) return { enc, result: 'enemiesFled', waitingOn: null };
    const actor = enc.current();
    if (actor.side === 'party') {
      const recorded = combat.actions[next];
      if (!recorded) return { enc, result: null, waitingOn: actor.id };
      if (recorded.actorId !== actor.id) throw new Error(`Combat replay out of step: expected ${actor.id}, found ${recorded.actorId}`);
      next += 1;
      applyAction(enc, recorded.action);
    } else {
      takeTurn(enc);
    }
  }
  throw new Error('Combat replay did not settle');
}

/** Applies the player's combat action. When the turn passes on, companions and enemies act until it is the player's turn again. */
export async function playerCombatAction(state: GameState, scene: Scene, model: ModelClient, action: CombatAction): Promise<void> {
  if (state.mode !== 'combat' || !state.combat) throw new ModelError('There is no fight right now');
  const before = replayCombat(state, scene);
  if (before.waitingOn !== scene.pc.id) throw new ModelError('It is not your turn');
  const legal = legalActions(before.enc).some((l) => JSON.stringify(l.action) === JSON.stringify(action));
  if (!legal) throw new ModelError('That action is not allowed right now');
  state.combat.actions.push({ actorId: scene.pc.id, action });
  const after = replayCombat(state, scene);
  // Mid-turn actions just show the dice; the round is narrated once the turn comes back around.
  if (action.kind !== 'endTurn' && !after.result) return;
  await advanceCombat(state, scene, model, { narrate: true });
}

/**
 * Runs the fight forward: each companion picks its moves when its turn comes, enemies act on
 * autopilot, until the player is up again or the fight ends. Then the DM narrates.
 */
async function advanceCombat(state: GameState, scene: Scene, model: ModelClient, { narrate = false } = {}): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const snap = replayCombat(state, scene);
    if (snap.result) {
      flushCombatLog(state, snap.enc);
      endCombat(state, snap);
      const instruction =
        snap.result === 'defeat'
          ? 'The whole party was knocked unconscious. The enemies do not kill them: narrate what the enemies do with the wagon and how the party comes to, battered, each with 1 HP. Usually this ends the scene.'
          : snap.result === 'enemiesFled'
            ? 'The enemies\' nerve broke: the survivors yield or flee. Narrate the end of the fight from the COMBAT lines since your last narration, then hand the turn back.'
            : 'The enemies are down. Narrate the end of the fight from the COMBAT lines since your last narration and the aftermath, then hand the turn back.';
      const reply = await askDm(state, scene, model, instruction, { allowCheck: false, allowCombat: false });
      await applyDmReply(state, scene, model, reply);
      return;
    }
    if (snap.waitingOn === scene.pc.id) {
      if (narrate) {
        flushCombatLog(state, snap.enc);
        const reply = await askDm(
          state, scene, model,
          'Narrate the fight since your last narration (the COMBAT lines and what the party shouted) as vivid action in 60 to 120 words, faithful to every hit, miss and number. Then hand the turn back to the PC.',
          { allowCheck: false, allowCombat: false },
        );
        state.transcript.push(dmEntry(reply));
      }
      return;
    }
    if (snap.waitingOn) {
      flushCombatLog(state, snap.enc);
      await companionCombatTurn(state, scene, model, snap, companionDef(snap.waitingOn));
      narrate = true;
    }
  }
  throw new Error('Combat did not come back to the player');
}

/** Moves engine events nobody has seen yet into the transcript, so the story stays in order around companions' lines. */
function flushCombatLog(state: GameState, enc: Encounter): void {
  const combat = state.combat!;
  const nameOf = (id: string) => enc.get(id).name;
  const lines = enc.events.slice(combat.narratedEvents).map((e) => describeEvent(e, nameOf)).filter((l) => !l.endsWith("'s turn"));
  combat.narratedEvents = enc.events.length;
  if (lines.length) state.transcript.push({ kind: 'combatLog', lines });
}

async function companionCombatTurn(state: GameState, scene: Scene, model: ModelClient, snap: CombatSnapshot, def: CompanionDef): Promise<void> {
  const { enc } = snap;
  const me = enc.get(def.id);
  const party = enc.combatants.filter((c) => c.side === 'party');
  const foes = enc.combatants.filter((c) => c.side === 'enemy' && c.status !== 'dead');
  const options = legalActions(enc);
  const messages = buildCompanionCombatMessages(state, scene, def, me, party, foes, enc.round, options);
  const reply = await askWithRetry(model, 'companion', messages, (t) => parseCombatTurn(t, options.length));

  let acted = false;
  const record = (action: CombatAction) => {
    applyAction(enc, action);
    state.combat!.actions.push({ actorId: def.id, action });
    acted = true;
  };
  if (reply && (reply.say || reply.thought)) {
    state.transcript.push({ kind: 'companion', id: def.id, name: me.name, say: reply.say, act: '', thought: reply.thought, role: 'combat' });
  }
  for (const i of reply?.choices ?? []) {
    const action = options[i]!.action;
    if (enc.isOver() || action.kind === 'endTurn') break;
    // Earlier choices can use up the action, so each pick is checked against the rules again.
    if (legalActions(enc).some((l) => JSON.stringify(l.action) === JSON.stringify(action))) record(action);
  }
  // A companion who picked nothing usable still does something sensible.
  if (!acted && !enc.isOver()) {
    const fallback = fallbackAction(legalActions(enc));
    if (fallback) record(fallback);
  }
  if (!enc.isOver()) record({ kind: 'endTurn' });
}

function fallbackAction(options: LegalAction[]): CombatAction | undefined {
  return (options.find((o) => o.action.kind === 'attack') ?? options.find((o) => o.action.kind === 'dodge'))?.action;
}

function endCombat(state: GameState, snap: CombatSnapshot): void {
  for (const c of snap.enc.combatants) {
    if (c.side === 'party') {
      const dead = c.status === 'dead';
      state.party[c.id] = {
        hp: dead ? 0 : snap.result === 'defeat' ? 1 : Math.max(1, c.hp),
        secondWind: c.resources.secondWind,
        actionSurge: c.resources.actionSurge,
        slots: c.spellcasting?.slots,
        ...(dead ? { dead: true } : {}),
      };
    } else if (c.status === 'dead' || snap.result === 'enemiesFled') {
      if (!state.removedEnemies.includes(c.id)) state.removedEnemies.push(c.id);
    }
  }
  state.transcript.push({ kind: 'combatEnd', result: snap.result! });
  state.mode = 'explore';
  delete state.combat;
}

// ---- What the player sees --------------------------------------------------

export interface PartyMemberView {
  character: Combatant;
  companion?: { mood: string; trust: Record<string, number>; feeling: string; beliefs: string[]; memories: string[]; intention: string };
}

export interface ChapterView {
  title: string;
  outcome: string;
  summary: string;
  transcript: Entry[];
}

export interface GameView {
  id: string;
  title: string;
  campaignTitle: string;
  mode: GameState['mode'];
  /** Earlier scenes, oldest first. */
  chapters: ChapterView[];
  transcript: Entry[];
  pcId: string;
  party: PartyMemberView[];
  /** Once this scene is over: whether another chapter follows, and its title when it is already known. */
  hasNext: boolean;
  nextTitle?: string;
  /** A generated campaign's journal: what the player may know of the plan, quests and factions. */
  journal?: JournalView;
  /** "Previously on…", when one has been written for where the story stands now. */
  recap?: string;
  level: number;
  /** A level-up waiting for the player to raise their abilities, with the scores they have now. */
  levelUp?: { level: number; abilities: AbilityScores };
  camp?: { approacher?: string; companions: string[] };
  combat?: {
    combatants: Combatant[];
    round: number;
    yourTurn: boolean;
    actions: LegalAction[];
    log: string[];
  };
}

export interface JournalView {
  premise: string;
  region: { name: string; description: string };
  act: { n: number; total: number; title: string; goal: string };
  quests: Quest[];
  /** Only factions the party has dealt with. */
  factions: { id: string; name: string; description: string; attitude: string }[];
}

/** Everything the browser may show. DM secrets never leave the server. */
export function viewGame(state: GameState, scene: Scene): GameView {
  const members = partyMembers(state, scene, { includeDead: true });
  const inner = (id: string): PartyMemberView['companion'] => {
    const cs = state.companions[id];
    return cs && { mood: cs.mood, trust: cs.trust, feeling: cs.feeling, beliefs: cs.beliefs, memories: cs.memories.map((m) => m.text), intention: cs.intention };
  };
  const view: GameView = {
    id: state.id,
    title: scene.title,
    campaignTitle: campaignTitle(state),
    mode: state.mode,
    hasNext: hasNextChapter(state),
    level: state.level,
    chapters: state.history.map((c) => ({ title: c.title, outcome: c.outcome, summary: c.summary, transcript: c.transcript })),
    transcript: state.transcript,
    pcId: scene.pc.id,
    party: members.map((c) => ({ character: c, companion: inner(c.id) })),
  };
  const next = state.mode === 'over' || state.mode === 'camp' ? nextScene(state) : undefined;
  if (next) view.nextTitle = next.title;
  const o = state.outline;
  if (o) {
    const act = o.acts[Math.min(state.act, o.acts.length - 1)]!;
    view.journal = {
      premise: o.premise,
      region: o.region,
      act: { n: Math.min(state.act, o.acts.length - 1) + 1, total: o.acts.length, title: act.title, goal: act.goal },
      quests: state.quests,
      factions: state.factions.filter((f) => f.met).map((f) => ({ id: f.id, name: f.name, description: f.description, attitude: attitudeWord(f.attitude) })),
    };
  }
  if (state.recap && state.recap.chapter === state.chapter && state.recap.beat === state.beat) view.recap = state.recap.text;
  if (state.levelUp) view.levelUp = { level: state.levelUp.level, abilities: levelled(state, scene.pc).abilities };
  if (state.mode === 'camp') view.camp = { approacher: state.camp?.approacher, companions: livingCompanions(state) };
  if (state.mode === 'combat' && state.combat) {
    const { enc, waitingOn } = replayCombat(state, scene);
    const nameOf = (id: string) => enc.get(id).name;
    const yourTurn = waitingOn === scene.pc.id;
    view.party = view.party.map((m) => ({ ...m, character: enc.combatants.find((c) => c.id === m.character.id) ?? m.character }));
    view.combat = {
      combatants: enc.combatants,
      round: enc.round,
      yourTurn,
      actions: yourTurn ? legalActions(enc) : [],
      log: enc.events.slice(state.combat.narratedEvents).map((e) => describeEvent(e, nameOf)).filter((l) => !l.endsWith("'s turn")),
    };
  }
  return view;
}

function checkLabel(check: string): string {
  const spaced = check.replace(/([A-Z])/g, ' $1');
  return check.length === 3 ? check.toUpperCase() : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
