import { buildCharacter } from '../engine';
import { nextScene } from './campaign';
import { companionDef } from './companions';
import { nudgeTrust, parseCampMemories, parseCampTalk, parseDeparture, parseReflection, parseTurn } from './companionReply';
import { askDm, askWithRetry, dmEntry, isFatal, livingCompanions, partyMembers, recordApproval } from './game';
import { ModelError, parseJsonObject, type ModelClient } from './model';
import {
  buildApproachMessages,
  buildBanterMessages,
  buildCampMemoryMessages,
  buildCampTalkMessages,
  buildChronicleMessages,
  buildDepartureMessages,
  buildReflectionMessages,
  type ApproachReason,
} from './prompts';
import type { Scene } from './scene';
import type { Entry, GameState } from './state';

/** Lines of fireside banter per night. */
const BANTER_LINES = 3;
/** Trust in the PC at or below this, with enough logged reasons, makes a companion confront them. */
const CONFRONT_AT = 3;
/** Trust in the PC at or below this, after a confrontation, means they may leave. */
const LEAVE_AT = 1;
/** How many logged grievances a big move needs. */
const GRIEVANCES = 3;
/** Trust at or above this can lead a companion to confide in the PC. */
const CONFIDE_AT = 8;

const grievances = (state: GameState, id: string) => state.companions[id]!.approvals.filter((a) => a.delta < 0).length;

/**
 * The scene is over: the DM writes down what happened, the party rests, each companion reflects
 * on the day (memories, beliefs, feelings), two of them talk by the fire, and one seeks out the PC.
 */
export async function makeCamp(state: GameState, scene: Scene, model: ModelClient): Promise<void> {
  if (state.mode !== 'over') throw new ModelError('The party can only make camp once the scene is over');
  if (!nextScene(state)) throw new ModelError('The adventure is over');

  let summary = (state.transcript.findLast((e) => e.kind === 'sceneEnd') as Extract<Entry, { kind: 'sceneEnd' }> | undefined)?.outcome ?? '';
  try {
    const raw = parseJsonObject(await model.complete({ role: 'helper', messages: buildChronicleMessages(state, scene), json: true })) as { summary?: unknown };
    if (typeof raw.summary === 'string' && raw.summary.trim()) summary = raw.summary.trim().slice(0, 1500);
  } catch (e) {
    if (isFatal(e)) throw e;
  }

  state.transcript.push({ kind: 'campStart' });
  longRest(state, scene);

  const ids = livingCompanions(state);
  const party = partyMembers(state, scene);
  const me = (id: string) => party.find((c) => c.id === id)!;

  await Promise.all(
    ids.map(async (id) => {
      const def = companionDef(id);
      const others = ids.filter((o) => o !== id);
      const reply = await askWithRetry(model, 'companion', buildReflectionMessages(state, scene, def, me(id), party), (t) => parseReflection(t, others));
      if (!reply) return; // a companion who can't reflect tonight keeps yesterday's beliefs
      const cs = state.companions[id]!;
      cs.memories.push(...reply.memories.map((m) => ({ ...m, chapter: state.chapter })));
      if (reply.beliefs.length) cs.beliefs = reply.beliefs;
      if (reply.feeling) cs.feeling = reply.feeling;
      if (reply.mood) cs.mood = reply.mood;
      cs.intention = reply.intention;
      for (const [other, value] of Object.entries(reply.trust)) cs.trust[other] = nudgeTrust(cs.trust[other] ?? 5, value);
    }),
  );

  const approach = chooseApproach(state, scene, ids);

  // Two companions talk by the fire, the one not seeking out the PC opening.
  if (ids.length >= 2) {
    const [a, b] = approach && ids.includes(approach.id) ? [ids.find((i) => i !== approach.id)!, approach.id] : [ids[0]!, ids[1]!];
    for (let line = 0; line < BANTER_LINES; line++) {
      const speaker = line % 2 === 0 ? a : b;
      const partner = me(line % 2 === 0 ? b : a);
      const def = companionDef(speaker);
      const turn = await askWithRetry(model, 'companion', buildBanterMessages(state, scene, def, me(speaker), party, partner, line === 0), (t) => parseTurn(t, { spoken: true }));
      if (!turn) break;
      state.transcript.push({ kind: 'companion', id: speaker, name: me(speaker).name, say: turn.say, act: turn.act, thought: turn.thought, role: 'banter' });
    }
  }

  if (approach) {
    const { id, reason } = approach;
    const cs = state.companions[id]!;
    if (reason === 'confront') cs.warned = true;
    if (reason === 'confide') cs.confided = true;
    const turn = await askWithRetry(model, 'companion', buildApproachMessages(state, scene, companionDef(id), me(id), party, reason), (t) => parseTurn(t, { spoken: true }));
    if (turn) {
      state.transcript.push({ kind: 'companion', id, name: me(id).name, say: turn.say, act: turn.act, thought: turn.thought, role: 'private', hiddenFrom: ids.filter((o) => o !== id) });
    }
  }

  state.mode = 'camp';
  state.camp = { summary, ...(approach ? { approacher: approach.id, reason: approach.reason } : {}) };
}

/** Rest restores everyone still alive: HP, spell slots and once-per-rest abilities. */
function longRest(state: GameState, scene: Scene): void {
  for (const spec of [scene.pc, ...state.roster.map((id) => companionDef(id).spec)]) {
    const m = state.party[spec.id];
    if (!m || m.dead) continue;
    const fresh = buildCharacter(spec);
    state.party[spec.id] = { hp: fresh.hp, secondWind: fresh.resources.secondWind, actionSurge: fresh.resources.actionSurge, slots: fresh.spellcasting?.slots };
  }
}

/**
 * Who seeks the PC out tonight. A companion losing faith comes first (that confrontation is the
 * warning any departure needs), then one who trusts the PC enough to confide, then whoever was
 * most moved, for better or worse, by today.
 */
export function chooseApproach(state: GameState, scene: Scene, ids: string[]): { id: string; reason: ApproachReason } | null {
  if (ids.length === 0) return null;
  const trust = (id: string) => state.companions[id]!.trust[scene.pc.id] ?? 5;
  const confront = ids.filter((id) => trust(id) <= CONFRONT_AT && grievances(state, id) >= GRIEVANCES && !state.companions[id]!.warned).sort((x, y) => trust(x) - trust(y))[0];
  if (confront) return { id: confront, reason: 'confront' };
  const confide = ids.filter((id) => trust(id) >= CONFIDE_AT && !state.companions[id]!.confided).sort((x, y) => trust(y) - trust(x))[0];
  if (confide) return { id: confide, reason: 'confide' };
  const stirred = (id: string) => state.companions[id]!.approvals.filter((a) => a.chapter === state.chapter).length;
  const id = [...ids].sort((x, y) => stirred(y) - stirred(x) || state.companions[x]!.lastLed - state.companions[y]!.lastLed)[0]!;
  return { id, reason: 'talk' };
}

/** The PC talks privately with one companion at camp. */
export async function campTalk(state: GameState, scene: Scene, model: ModelClient, text: string, to: string): Promise<void> {
  if (state.mode !== 'camp') throw new ModelError('There is no camp right now');
  const ids = livingCompanions(state);
  if (!ids.includes(to)) throw new ModelError('They are not here');
  const said = text.trim();
  if (!said) return;
  const hiddenFrom = ids.filter((o) => o !== to);
  state.transcript.push({ kind: 'player', text: said, hiddenFrom });
  const party = partyMembers(state, scene);
  const me = party.find((c) => c.id === to)!;
  const reply = await askWithRetry(model, 'companion', buildCampTalkMessages(state, scene, companionDef(to), me, party), parseCampTalk);
  if (!reply) throw new ModelError(`${me.name} didn't answer. Try again.`);
  state.transcript.push({ kind: 'companion', id: to, name: me.name, say: reply.say, act: reply.act, thought: reply.thought, role: 'private', hiddenFrom });
  if (reply.mood) state.companions[to]!.mood = reply.mood;
  recordApproval(state, scene, to, reply.approve, reply.because);
}

/**
 * Morning. The night's talk becomes memories; anyone who has given up on the PC may be gone; the
 * finished scene is filed away; and the DM opens the next one in light of everything before it.
 */
export async function breakCamp(state: GameState, scene: Scene, model: ModelClient): Promise<void> {
  if (state.mode !== 'camp' || !state.camp) throw new ModelError('There is no camp right now');
  const next = nextScene(state);
  if (!next) throw new ModelError('The adventure is over');
  const ids = livingCompanions(state);
  const party = partyMembers(state, scene);
  const me = (id: string) => party.find((c) => c.id === id)!;

  const campStart = state.transcript.findIndex((e) => e.kind === 'campStart');
  const heardSomething = (id: string) =>
    state.transcript.slice(campStart).some((e) => (e.kind === 'companion' || e.kind === 'player') && !e.hiddenFrom?.includes(id));
  await Promise.all(
    ids.filter(heardSomething).map(async (id) => {
      const memories = await askWithRetry(model, 'helper', buildCampMemoryMessages(state, scene, companionDef(id)), parseCampMemories);
      state.companions[id]!.memories.push(...(memories ?? []).map((m) => ({ ...m, chapter: state.chapter })));
    }),
  );

  const departures: Entry[] = [];
  for (const id of ids) {
    const cs = state.companions[id]!;
    if (!cs.warned || (cs.trust[scene.pc.id] ?? 5) > LEAVE_AT || grievances(state, id) < GRIEVANCES) continue;
    const def = companionDef(id);
    const reply = await askWithRetry(model, 'companion', buildDepartureMessages(state, scene, def, me(id), party), (t) => parseDeparture(t, !!def.betrayal));
    if (!reply || reply.decision === 'stay') continue;
    departures.push({ kind: 'departure', id, name: me(id).name, betrayed: reply.decision === 'betray', text: reply.note });
  }

  const outcome = (state.transcript.findLast((e) => e.kind === 'sceneEnd') as Extract<Entry, { kind: 'sceneEnd' }> | undefined)?.outcome ?? '';
  const leftNote = departures
    .map((d) => (d.kind === 'departure' ? `${d.name} left the party that night${d.betrayed ? `, betraying them: ${companionDef(d.id).betrayal}` : '.'}` : ''))
    .join(' ');
  state.history.push({ sceneId: scene.id, title: scene.title, outcome, summary: [state.camp.summary, leftNote].filter(Boolean).join(' '), transcript: state.transcript });

  const gone = new Set(departures.map((d) => (d.kind === 'departure' ? d.id : '')));
  state.roster = state.roster.filter((id) => !gone.has(id) && !state.party[id]?.dead);
  state.chapter += 1;
  state.sceneId = next.id;
  state.mode = 'explore';
  state.transcript = [{ kind: 'chapter', title: next.title }, ...departures];
  state.unlockedSecrets = [];
  state.removedEnemies = [];
  delete state.camp;

  const reply = await askDm(
    state, next, model,
    `A new scene begins the next day. Write its opening narration from this OPENING, changed to fit everything in EARLIER CHAPTERS and the party as it is now (who is still with them, what they still carry):\n"${next.opening}"\nStart with one sentence recalling where the party has come from. Do not ask for a check or start combat.`,
    { allowCheck: false, allowCombat: false },
  );
  state.transcript.push(dmEntry(reply));
}
