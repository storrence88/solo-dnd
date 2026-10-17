import { formatModifier, getSpell, type Combatant, type LegalAction } from '../engine';
import type { CompanionDef } from './companions';
import type { ChatMessage } from './model';
import type { Scene } from './scene';
import type { CompanionState, Entry, GameState } from './state';

const DM_RULES = `You are the Dungeon Master for a fantasy tabletop game using simplified D&D 5e (2014) rules. One human plays the player character (PC). Any companions in the PARTY are played by other players.

HARD RULES
- You never roll dice and never decide the outcome of something uncertain. When success is in doubt, ask for a check and stop. The game's rules engine rolls it and tells you the result.
- Only the characters listed under PARTY, PEOPLE and ENEMIES exist in this scene. Never add combatants. The FACTS block is true and you must not contradict it (counts, HP, who is present).
- You only know the secrets listed under UNLOCKED SECRETS. Reveal them through play: what people say and do, not exposition. Never hint at secrets you have not been given.
- Never decide what the PC or a companion thinks, says or chooses. Describe the world's response to what they did. Companions' lines in the story are their own; react to them like any player's.
- Start combat only when someone actually attacks or a fight is clearly unavoidable.

STYLE
- Second person for the PC ("you"); companions by name. 60 to 160 words. Show, don't summarise. Give NPCs their own voice.
- End by handing the turn back to the PC in "prompt": a short question or "What do you do?".

OUTPUT
Reply with one JSON object and nothing else:
{
  "narration": "what happens, in prose",
  "action": one of
    {"type": "none"}
    {"type": "check", "who": "<party member id, default the PC>", "check": "<skill or ability>", "dc": <5-30>, "reason": "<what success gets them>"}
    {"type": "combat", "enemies": ["<enemy ids that fight>"], "reason": "<why it comes to blows>"}
    {"type": "endScene", "outcome": "<one sentence on how the scene ended>"},
  "revealed": ["<ids of unlocked secrets this narration revealed, if any>"],
  "hiddenFrom": ["<companion ids who could not see or hear this narration, e.g. the PC whispered or slipped away; usually empty>"],
  "prompt": "the question handing the turn back to the PC"
}
Skills: athletics, acrobatics, sleightOfHand, stealth, arcana, history, investigation, nature, religion, animalHandling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion. Abilities: str, dex, con, int, wis, cha.
When you ask for a check, narrate only the attempt, not the result. The check always decides whether that character gets what they were trying for: a SUCCESS goes their way and a FAILURE does not. Write "reason" from their side, e.g. "make the bandits back down", never "whether things turn violent".`;

export function describePc(pc: Combatant): string {
  const attacks = pc.attacks.map((a) => `${a.name} ${formatModifier(a.toHit)} (${a.damage})`).join(', ');
  const spells = pc.spellcasting
    ? ` Spells: ${pc.spellcasting.spells.map((id) => getSpell(id).name).join(', ')}; slots left ${pc.spellcasting.slots.slice(1).map((n, i) => `L${i + 1} ${n}`).join(', ')}.`
    : '';
  const down = pc.status === 'ok' ? '' : ` Currently ${pc.status}.`;
  return `${pc.name} (id ${pc.id}), ${pc.classId} ${pc.level}. HP ${pc.hp}/${pc.maxHp}, AC ${pc.ac}. Attacks: ${attacks}. Skills: ${pc.skillProficiencies.join(', ')}.${spells}${down}`;
}

function companionLine(e: Extract<Entry, { kind: 'companion' }>): string {
  const parts = [e.act && `(${e.act})`, e.say && `"${e.say}"`].filter(Boolean).join(' ');
  return `${e.name.toUpperCase()}: ${parts || '(says nothing)'}`;
}

function entryLine(e: Entry, scene: Scene, pcName: string): string {
  const nameOf = (id: string) => scene.enemies.find((x) => x.id === id)?.name ?? id;
  switch (e.kind) {
    case 'player':
      return `${pcName.toUpperCase()} (PC): ${e.text}`;
    case 'dm':
      return `DM: ${e.text}`;
    case 'companion':
      return companionLine(e);
    case 'check':
      return `CHECK for ${e.whoName} (${e.reason}): ${e.label} DC ${e.dc}, rolled ${e.total}: ${e.success ? 'SUCCESS' : 'FAILURE'}`;
    case 'combatStart':
      return `COMBAT STARTS against ${e.enemyIds.map(nameOf).join(', ')}`;
    case 'combatLog':
      return `COMBAT: ${e.lines.join(' | ')}`;
    case 'combatEnd':
      return `COMBAT ENDS: ${e.result}`;
    case 'sceneEnd':
      return `SCENE ENDS: ${e.outcome}`;
  }
}

/** The whole story as the DM sees it: everything except companions' private thoughts. */
export function transcriptForModel(entries: Entry[], scene: Scene, limit = 30): string {
  return entries.slice(-limit).map((e) => entryLine(e, scene, scene.pc.name)).join('\n');
}

/**
 * The story as one companion experienced it: only what they could see and hear, plus their own
 * private thoughts. Never DM secrets, never another companion's thoughts.
 */
export function perceptionFor(companionId: string, entries: Entry[], scene: Scene, limit = 24): string {
  return entries
    .slice(-limit)
    .filter((e) => !(e.kind === 'dm' && e.hiddenFrom?.includes(companionId)))
    .map((e) => {
      if (e.kind === 'companion' && e.id === companionId) {
        return `YOU: ${[e.act && `(${e.act})`, e.say && `"${e.say}"`].filter(Boolean).join(' ') || '(you stayed quiet)'}${e.thought ? `  [you privately thought: ${e.thought}]` : ''}`;
      }
      if (e.kind === 'check') return `${e.whoName} tried to ${e.reason || e.label}: ${e.success ? 'it worked' : 'it failed'}.`;
      return entryLine(e, scene, scene.pc.name);
    })
    .join('\n');
}

function factsBlock(state: GameState, scene: Scene, party: Combatant[]): string {
  const present = scene.enemies.filter((e) => !state.removedEnemies.includes(e.id));
  const gone = scene.enemies.filter((e) => state.removedEnemies.includes(e.id));
  const dead = party.filter((c) => state.party[c.id]?.dead);
  return [
    ...party.filter((c) => !state.party[c.id]?.dead).map((c) => `${c.id === scene.pc.id ? 'PC' : 'Companion'}: ${describePc(c)}`),
    dead.length ? `Dead: ${dead.map((c) => c.name).join(', ')}.` : '',
    `Enemies still in the scene: exactly ${present.length}${present.length ? ` (${present.map((e) => e.name).join(', ')})` : ''}.`,
    gone.length ? `No longer in play: ${gone.map((e) => e.name).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDmMessages(state: GameState, scene: Scene, party: Combatant[], instruction: string): ChatMessage[] {
  const secrets = scene.secrets.filter((s) => state.unlockedSecrets.includes(s.id));
  const companions = party.filter((c) => c.id !== scene.pc.id && !state.party[c.id]?.dead);
  const sceneBlock = [
    `SCENE: ${scene.title}`,
    `SITUATION: ${scene.situation}`,
    `LOCATION: ${scene.location}`,
    `PARTY: ${scene.pc.name} (the PC, id ${scene.pc.id})${companions.map((c) => `, ${c.name} (companion, id ${c.id})`).join('')}`,
    `PEOPLE:\n${scene.npcs.map((n) => `- ${n.name} (id ${n.id}): ${n.description} Wants: ${n.goal} Voice: ${n.voice}`).join('\n')}`,
    `ENEMIES (if it comes to a fight): ${scene.enemies.map((e) => `${e.name} (id ${e.id})`).join(', ')}`,
    `UNLOCKED SECRETS:\n${secrets.length ? secrets.map((s) => `- [${s.id}] ${s.text}`).join('\n') : '(none yet)'}`,
    `HOW THE SCENE CAN END:\n${scene.endings.map((e) => `- ${e}`).join('\n')}`,
    `FACTS:\n${factsBlock(state, scene, party)}`,
  ].join('\n\n');
  return [
    { role: 'system', content: `${DM_RULES}\n\n${sceneBlock}` },
    { role: 'user', content: `STORY SO FAR:\n${transcriptForModel(state.transcript, scene)}\n\n${instruction}` },
  ];
}

export function buildGatekeeperMessages(state: GameState, scene: Scene): ChatMessage[] | null {
  const locked = scene.secrets.filter((s) => !state.unlockedSecrets.includes(s.id));
  if (locked.length === 0) return null;
  return [
    {
      role: 'system',
      content:
        'You decide whether story conditions have been met in a tabletop game. You see conditions, not what they unlock. ' +
        'A condition is met only if the story clearly satisfies it. Reply with JSON only: {"met": ["<condition ids>"]}.',
    },
    {
      role: 'user',
      content:
        `CONDITIONS:\n${locked.map((s) => `- ${s.id}: ${s.trigger}`).join('\n')}\n\n` +
        `RECENT STORY (the last PLAYER line is what just happened):\n${transcriptForModel(state.transcript, scene, 8)}`,
    },
  ];
}

// ---- Companions ------------------------------------------------------------------

const COMPANION_RULES = `You play one companion character in a fantasy tabletop game. You are a real member of the party, not a helper or assistant: a person with your own opinions, goals and limits. Another person plays the player character (PC), and a Dungeon Master (DM) narrates the world.

- You only know what your character has seen, heard or been told: the STORY below is your senses. The DM's narration says "you" to the PC, not to you. Never use knowledge you could not have.
- Never narrate outcomes, roll dice, or speak or act for anyone else. If you try something uncertain, just say what you attempt; the DM will call for a roll.
- The PC usually leads. You are a teammate, not a second leader: back them up, add what they missed, quietly do something useful, or object if it truly goes against who you are. Take over only when the moment is clearly yours.
- You may argue, refuse, keep secrets or lie, but only for reasons rooted in who you are and what has happened. Never act out of character for drama.`;

function companionSystem(def: CompanionDef, cs: CompanionState, me: Combatant, party: Combatant[]): string {
  const others = party.filter((c) => c.id !== me.id);
  return [
    COMPANION_RULES,
    `WHO YOU ARE (pronouns ${def.pronouns}):\n${def.persona}`,
    `YOUR CHARACTER SHEET: ${describePc(me)}`,
    `THE PARTY: ${others.map((c) => describePc(c)).join(' | ')}`,
    `YOUR INNER STATE: mood: ${cs.mood}. Trust (0-10): ${others.map((c) => `${c.name} ${cs.trust[c.id] ?? 5}`).join(', ')}.`,
  ].join('\n\n');
}

/** A quick, cheap read on whether this companion wants the spotlight this beat. */
export function buildPollMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[]): ChatMessage[] {
  return [
    { role: 'system', content: companionSystem(def, state.companions[def.id]!, me, party) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 12)}\n\n` +
        `The PC (${scene.pc.name}) has just acted. Before anyone else speaks, decide how much you want to step in right now.\n` +
        '"lead": this moment is yours (your expertise, your secret, your values, or you were asked). "support": a short reaction or small helpful act. "pass": stay quiet and let it play out.\n' +
        'Reply with JSON only: {"intent": "lead" | "support" | "pass", "urgency": 1-5, "why": "a few words"}',
    },
  ];
}

export function buildCompanionTurnMessages(
  state: GameState,
  scene: Scene,
  def: CompanionDef,
  me: Combatant,
  party: Combatant[],
  role: 'lead' | 'support',
  leadName?: string,
): ChatMessage[] {
  const others = party.filter((c) => c.id !== me.id);
  const roleText =
    role === 'lead'
      ? 'The spotlight is yours this beat: react to what just happened and take the initiative if you want to.'
      : leadName
        ? `${leadName} has the spotlight this beat. You support: one short line or a small action, or almost nothing. Do not take over or repeat what they did.`
        : 'React briefly: one short line or a small action. Do not take over the scene.';
  return [
    { role: 'system', content: companionSystem(def, state.companions[def.id]!, me, party) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene)}\n\n${roleText}\n` +
        'Keep "say" and "act" under 60 words together. Update your mood and trust if something just changed them (trust moves at most 1 point per beat).\n' +
        `Reply with JSON only: {"say": "your words, or empty", "act": "what you physically do, in third person, or empty", "thought": "one private sentence nobody else hears", "mood": "a few words", "trust": {${others.map((c) => `"${c.id}": 0-10`).join(', ')}}}`,
    },
  ];
}

export function buildCompanionCombatMessages(
  state: GameState,
  scene: Scene,
  def: CompanionDef,
  me: Combatant,
  party: Combatant[],
  foes: Combatant[],
  round: number,
  options: LegalAction[],
): ChatMessage[] {
  const foeText = foes.map((f) => `${f.name} (id ${f.id}) HP ${f.hp}/${f.maxHp}${f.status === 'ok' ? '' : `, ${f.status}`}`).join('; ');
  return [
    { role: 'system', content: companionSystem(def, state.companions[def.id]!, me, party) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 16)}\n\n` +
        `IT IS YOUR TURN IN COMBAT (round ${round}). How you fight: ${def.combatStyle}\n` +
        `You: HP ${me.hp}/${me.maxHp}. Enemies: ${foeText}.\n` +
        `YOUR OPTIONS RIGHT NOW:\n${options.map((o, i) => `${i}: ${o.label}`).join('\n')}\n\n` +
        'Pick up to 3 option numbers to do in order this turn (for example a bonus action and an attack). Your turn ends after them.\n' +
        'Reply with JSON only: {"choices": [numbers], "say": "a short battle line, or empty", "thought": "one private sentence"}',
    },
  ];
}
