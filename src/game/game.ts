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
  type CombatAction,
  type Combatant,
  type LegalAction,
} from '../engine';
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
import type { CombatResult, CompanionState, Entry, GameState, MemberState } from './state';

export function newGame(scene: Scene, id: string, seed: number): GameState {
  const party: Record<string, MemberState> = {};
  const companions: Record<string, CompanionState> = {};
  for (const spec of [scene.pc, ...scene.companions.map((c) => companionDef(c).spec)]) {
    const c = buildCharacter(spec);
    party[c.id] = { hp: c.hp, secondWind: c.resources.secondWind, actionSurge: c.resources.actionSurge, slots: c.spellcasting?.slots };
  }
  for (const cid of scene.companions) {
    const def = companionDef(cid);
    companions[cid] = { mood: def.startMood, trust: { ...def.startTrust }, lastLed: -1 };
  }
  return {
    version: 2,
    id,
    sceneId: scene.id,
    seed,
    mode: 'explore',
    transcript: [{ kind: 'dm', text: scene.opening, prompt: 'What do you do?' }],
    unlockedSecrets: [],
    removedEnemies: [],
    checksRolled: 0,
    beat: 0,
    party,
    companions,
  };
}

/** Every party member, player character first, with current HP, resources and spell slots applied. */
export function partyMembers(state: GameState, scene: Scene, { includeDead = false } = {}): Combatant[] {
  const specs = [scene.pc, ...scene.companions.map((c) => companionDef(c).spec)];
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

const livingCompanions = (state: GameState, scene: Scene) => scene.companions.filter((id) => !state.party[id]?.dead);

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
  const ids = livingCompanions(state, scene);
  if (ids.length === 0) return;
  const party = partyMembers(state, scene);
  const me = (id: string) => party.find((c) => c.id === id)!;

  const polls: Poll[] = await Promise.all(
    ids.map(async (id) => {
      const def = companionDef(id);
      let reply = { intent: 'support' as const as Poll['intent'], urgency: 2 };
      try {
        reply = parsePoll(await model.complete({ role: 'helper', messages: buildPollMessages(state, scene, def, me(id), party), json: true }));
      } catch (e) {
        if (isFatal(e)) throw e;
      }
      return { id, name: me(id).name, intent: reply.intent, urgency: reply.urgency, interests: def.interests, lastLed: state.companions[id]!.lastLed };
    }),
  );
  const lastDm = [...state.transcript].reverse().find((e) => e.kind === 'dm');
  const speakers = chooseSpeakers({ polls, playerText, recentText: lastDm?.kind === 'dm' ? lastDm.text : '', beat: state.beat, handOff });

  let leadName: string | undefined;
  for (const { id, role } of speakers) {
    const def = companionDef(id);
    const others = party.filter((c) => c.id !== id).map((c) => c.id);
    const messages = buildCompanionTurnMessages(state, scene, def, me(id), party, role, role === 'support' ? leadName : undefined);
    const turn = await askWithRetry(model, 'companion', messages, (t) => parseTurn(t, others));
    if (!turn) continue; // a companion who can't answer just stays quiet this beat
    state.transcript.push({ kind: 'companion', id, name: me(id).name, say: turn.say, act: turn.act, thought: turn.thought, role });
    const cs = state.companions[id]!;
    if (turn.mood) cs.mood = turn.mood;
    for (const [other, value] of Object.entries(turn.trust)) cs.trust[other] = nudgeTrust(cs.trust[other] ?? 5, value);
    if (role === 'lead') {
      cs.lastLed = state.beat;
      leadName = me(id).name;
    }
  }
}

/** Rate limits and bad keys stop the turn; anything else a companion gets wrong just costs them their line. */
function isFatal(e: unknown): boolean {
  return /rate limiting|\((401|403)\)/.test((e as Error).message);
}

async function askWithRetry<T>(model: ModelClient, role: 'companion', messages: ChatMessage[], parse: (text: string) => T): Promise<T | null> {
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
      return parse(text);
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

function dmEntry(reply: DmReply): Entry {
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
async function askDm(
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
    companionIds: livingCompanions(state, scene),
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
  companion?: { mood: string; trust: Record<string, number> };
}

export interface GameView {
  id: string;
  title: string;
  mode: GameState['mode'];
  transcript: Entry[];
  pcId: string;
  party: PartyMemberView[];
  combat?: {
    combatants: Combatant[];
    round: number;
    yourTurn: boolean;
    actions: LegalAction[];
    log: string[];
  };
}

/** Everything the browser may show. DM secrets never leave the server. */
export function viewGame(state: GameState, scene: Scene): GameView {
  const members = partyMembers(state, scene, { includeDead: true });
  const view: GameView = {
    id: state.id,
    title: scene.title,
    mode: state.mode,
    transcript: state.transcript,
    pcId: scene.pc.id,
    party: members.map((c) => ({ character: c, companion: state.companions[c.id] && { mood: state.companions[c.id]!.mood, trust: state.companions[c.id]!.trust } })),
  };
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
