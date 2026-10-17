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
import { parseDmReply, type DmReply, type DmReplyRules } from './dmReply';
import { ModelError, parseJsonObject, type ChatMessage, type ModelClient } from './model';
import { buildDmMessages, buildGatekeeperMessages } from './prompts';
import type { Scene } from './scene';
import type { CombatResult, Entry, GameState } from './state';

export function newGame(scene: Scene, id: string, seed: number): GameState {
  const pc = buildCharacter(scene.pc);
  return {
    version: 1,
    id,
    sceneId: scene.id,
    seed,
    mode: 'explore',
    transcript: [{ kind: 'dm', text: scene.opening, prompt: 'What do you do?' }],
    unlockedSecrets: [],
    removedEnemies: [],
    checksRolled: 0,
    pc: { hp: pc.hp, secondWind: pc.resources.secondWind, actionSurge: pc.resources.actionSurge },
  };
}

/** The player character with their current HP and resources applied. */
export function currentPc(state: GameState, scene: Scene): Combatant {
  const pc = buildCharacter(scene.pc);
  pc.hp = state.pc.hp;
  pc.resources = { secondWind: state.pc.secondWind, actionSurge: state.pc.actionSurge };
  return pc;
}

/**
 * One exploration beat: the player acts, the gatekeeper unlocks any secrets whose trigger was met,
 * the DM responds, and if the DM asks for a check the engine rolls it and the DM narrates the result.
 */
export async function playerActs(state: GameState, scene: Scene, model: ModelClient, text: string): Promise<void> {
  if (state.mode !== 'explore') throw new ModelError(state.mode === 'combat' ? 'Choose a combat action instead' : 'The scene is over');
  const said = text.trim();
  if (!said) return;
  state.transcript.push({ kind: 'player', text: said });
  await unlockSecrets(state, scene, model);

  const reply = await askDm(state, scene, model, 'Respond to the PLAYER\'s last action.', { allowCheck: true, allowCombat: true });
  await applyDmReply(state, scene, model, reply);
}

async function applyDmReply(state: GameState, scene: Scene, model: ModelClient, reply: DmReply): Promise<void> {
  state.transcript.push({ kind: 'dm', text: reply.narration, prompt: reply.prompt });
  const action = reply.action;
  if (action.type === 'check') {
    const pc = currentPc(state, scene);
    const result = abilityCheck(pc, action.check, action.dc, seededRng(state.seed * 7919 + state.checksRolled));
    state.checksRolled += 1;
    state.transcript.push({
      kind: 'check', label: checkLabel(action.check), dc: action.dc, rolls: result.rolls, modifier: result.modifier,
      total: result.total, success: result.success, reason: action.reason,
    });
    const followUp = await askDm(
      state, scene, model,
      'The rules engine has resolved the CHECK above. A SUCCESS means the player character gets what they were attempting; a FAILURE means they do not. Narrate what happens because of that result. Do not ask for another check now.',
      { allowCheck: false, allowCombat: true },
    );
    await applyDmReply(state, scene, model, followUp);
  } else if (action.type === 'combat') {
    startCombat(state, action.enemies);
  } else if (action.type === 'endScene') {
    state.transcript.push({ kind: 'sceneEnd', outcome: action.outcome });
    state.mode = 'over';
  }
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
  } catch {
    // A failed gatekeeper call only means no secret unlocks this beat; the story goes on.
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
  };
  if (rules.enemyIds.length === 0) rules.allowCombat = false;
  const messages: ChatMessage[] = buildDmMessages(state, scene, currentPc(state, scene), instruction);
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await model.complete({ role: 'dm', messages, json: true });
    } catch (e) {
      // A rate limit or a bad key won't fix itself on an instant retry; anything else (e.g. JSON mode rejecting the reply) gets one more try.
      if (/rate limiting|\((401|403)\)/.test((e as Error).message)) throw e;
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
}

/**
 * Rebuilds the fight from its seed and the player's recorded actions. Enemies act through the
 * autopilot. Stops when it is the player's turn with no recorded action left, or the fight ends.
 */
export function replayCombat(state: GameState, scene: Scene): CombatSnapshot {
  const combat = state.combat;
  if (!combat) throw new Error('No combat in progress');
  const pc = currentPc(state, scene);
  const enemies = scene.enemies.filter((e) => combat.enemyIds.includes(e.id)).map((e) => buildMonster(e.monster, e.id, e.name));
  const startingEnemyHp = enemies.reduce((sum, e) => sum + e.maxHp, 0);
  const enc = new Encounter([pc, ...enemies], seededRng(combat.seed));
  enc.start();

  const morale = () => {
    const left = enc.combatants.filter((c) => c.side === 'enemy').reduce((sum, c) => sum + c.hp, 0);
    return left > 0 && left < startingEnemyHp * scene.moraleBreak;
  };
  let next = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    if (enc.isOver()) return { enc, result: enc.winner === 'party' ? 'victory' : 'defeat' };
    if (morale()) return { enc, result: 'enemiesFled' };
    if (enc.current().id === pc.id) {
      const action = combat.actions[next];
      if (!action) return { enc, result: null };
      next += 1;
      applyAction(enc, action);
    } else {
      takeTurn(enc);
    }
  }
  throw new Error('Combat replay did not settle');
}

/** Applies a player's combat action. When the turn passes back to the player or the fight ends, the DM narrates. */
export async function playerCombatAction(state: GameState, scene: Scene, model: ModelClient, action: CombatAction): Promise<void> {
  if (state.mode !== 'combat' || !state.combat) throw new ModelError('There is no fight right now');
  const before = replayCombat(state, scene);
  const legal = legalActions(before.enc).some((l) => JSON.stringify(l.action) === JSON.stringify(action));
  if (!legal) throw new ModelError('That action is not allowed right now');
  state.combat.actions.push(action);
  const after = replayCombat(state, scene);
  const nameOf = (id: string) => after.enc.get(id).name;
  const fresh = after.enc.events.slice(state.combat.narratedEvents);

  // Mid-turn actions just show the dice; the DM narrates once the turn comes back around or the fight ends.
  if (action.kind !== 'endTurn' && !after.result) return;
  state.combat.narratedEvents = after.enc.events.length;
  const lines = fresh.map((e) => describeEvent(e, nameOf)).filter((l) => !l.endsWith("'s turn"));
  if (lines.length) state.transcript.push({ kind: 'combatLog', lines });

  if (after.result) {
    endCombat(state, scene, after);
    const instruction =
      after.result === 'defeat'
        ? 'The player character was knocked unconscious. The enemies do not kill them: narrate what the enemies do with the wagon and how the player character comes to, battered, with 1 HP. Usually this ends the scene.'
        : after.result === 'enemiesFled'
          ? 'The enemies\' nerve broke: the survivors yield or flee. Narrate it, then hand the turn back.'
          : 'The enemies are down. Narrate the aftermath, then hand the turn back.';
    const reply = await askDm(state, scene, model, instruction, { allowCheck: false, allowCombat: false });
    await applyDmReply(state, scene, model, reply);
    return;
  }
  const reply = await askDm(
    state, scene, model,
    'Narrate the latest COMBAT line as vivid action in 40 to 90 words, faithful to every hit, miss and number. Then hand the turn back to the player.',
    { allowCheck: false, allowCombat: false },
  );
  state.transcript.push({ kind: 'dm', text: reply.narration, prompt: reply.prompt });
}

function endCombat(state: GameState, scene: Scene, snap: CombatSnapshot): void {
  const pc = snap.enc.get(scene.pc.id);
  state.pc = {
    hp: snap.result === 'defeat' ? 1 : Math.max(1, pc.hp),
    secondWind: pc.resources.secondWind,
    actionSurge: pc.resources.actionSurge,
  };
  for (const c of snap.enc.combatants) {
    if (c.side === 'enemy' && (c.status === 'dead' || snap.result === 'enemiesFled')) {
      if (!state.removedEnemies.includes(c.id)) state.removedEnemies.push(c.id);
    }
  }
  state.transcript.push({ kind: 'combatEnd', result: snap.result! });
  state.mode = 'explore';
  delete state.combat;
}

// ---- What the player sees --------------------------------------------------

export interface GameView {
  id: string;
  title: string;
  mode: GameState['mode'];
  transcript: Entry[];
  pc: Combatant;
  combat?: {
    combatants: Combatant[];
    round: number;
    yourTurn: boolean;
    actions: LegalAction[];
    log: string[];
  };
}

/** Everything the browser may show. Secrets never leave the server. */
export function viewGame(state: GameState, scene: Scene): GameView {
  const view: GameView = { id: state.id, title: scene.title, mode: state.mode, transcript: state.transcript, pc: currentPc(state, scene) };
  if (state.mode === 'combat' && state.combat) {
    const { enc } = replayCombat(state, scene);
    const nameOf = (id: string) => enc.get(id).name;
    const yourTurn = !enc.isOver() && enc.current().id === scene.pc.id;
    view.pc = enc.get(scene.pc.id);
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
