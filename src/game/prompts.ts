import { formatModifier, getSpell, type Combatant, type LegalAction } from '../engine';
import { COMPANIONS, type CompanionDef } from './companions';
import { recallMemories } from './memory';
import type { ChatMessage } from './model';
import type { Scene } from './scene';
import type { Entry, GameState } from './state';

const DM_RULES = `You are the Dungeon Master for a fantasy tabletop game using simplified D&D 5e (2014) rules. One human plays the player character (PC). Any companions in the PARTY are played by other players.

HARD RULES
- You never roll dice and never decide the outcome of something uncertain. When success is in doubt, ask for a check and stop. The game's rules engine rolls it and tells you the result.
- Only the characters listed under PARTY, PEOPLE and ENEMIES exist in this scene. Never add combatants. The FACTS block is true and you must not contradict it (counts, HP, who is present).
- You only know the secrets listed under UNLOCKED SECRETS. Reveal them through play: what people say and do, not exposition. Never hint at secrets you have not been given.
- Never decide what the PC or a companion thinks, says or chooses. Describe the world's response to what they did. Companions' lines in the story are their own; react to them like any player's.
- Start combat only when someone actually attacks or a fight is clearly unavoidable.

STYLE
- Second person for the PC ("you"); companions by name, using the pronouns listed for them. 60 to 160 words. Show, don't summarise. Give NPCs their own voice.
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

/** ", pronouns they/them" for a companion; nothing for the PC, whose pronouns the player sets by how they write. */
function pronounsOf(id: string): string {
  const def = COMPANIONS[id];
  return def ? `, pronouns ${def.pronouns}` : '';
}

export function describePc(pc: Combatant): string {
  const attacks = pc.attacks.map((a) => `${a.name} ${formatModifier(a.toHit)} (${a.damage})`).join(', ');
  const spells = pc.spellcasting
    ? ` Spells: ${pc.spellcasting.spells.map((id) => getSpell(id).name).join(', ')}; slots left ${pc.spellcasting.slots.slice(1).map((n, i) => `L${i + 1} ${n}`).join(', ')}.`
    : '';
  const down = pc.status === 'ok' ? '' : ` Currently ${pc.status}.`;
  return `${pc.name} (id ${pc.id}${pronounsOf(pc.id)}), ${pc.classId} ${pc.level}. HP ${pc.hp}/${pc.maxHp}, AC ${pc.ac}. Attacks: ${attacks}. Skills: ${pc.skillProficiencies.join(', ')}.${spells}${down}`;
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
    case 'campStart':
      return 'NIGHT FALLS: the party makes camp and rests.';
    case 'departure':
      return `${e.name.toUpperCase()} LEFT THE PARTY in the night${e.betrayed ? ' and took some of the medicine' : ''}. Their note: "${e.text}"`;
    case 'chapter':
      return `--- ${e.title} ---`;
    case 'approval':
      return '';
  }
}

/** Approval reactions are for the player's eyes only; nobody in the story hears them. */
const inStory = (e: Entry) => e.kind !== 'approval';

/** The whole story as the DM sees it: everything except companions' private thoughts. */
export function transcriptForModel(entries: Entry[], scene: Scene, limit = 30): string {
  return entries.filter(inStory).slice(-limit).map((e) => entryLine(e, scene, scene.pc.name)).join('\n');
}

/**
 * The story as one companion experienced it: only what they could see and hear, plus their own
 * private thoughts. Never DM secrets, never another companion's thoughts.
 */
export function perceptionFor(companionId: string, entries: Entry[], scene: Scene, limit = 24, { skipCombatLog = false } = {}): string {
  return entries
    .filter(inStory)
    .filter((e) => !('hiddenFrom' in e && e.hiddenFrom?.includes(companionId)))
    .filter((e) => !(skipCombatLog && e.kind === 'combatLog'))
    .slice(-limit)
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
    `PARTY: ${scene.pc.name} (the PC, id ${scene.pc.id})${companions.map((c) => `, ${c.name} (companion, id ${c.id}${pronounsOf(c.id)})`).join('')}`,
    `PEOPLE:\n${scene.npcs.map((n) => `- ${n.name} (id ${n.id}): ${n.description} Wants: ${n.goal} Voice: ${n.voice}`).join('\n')}`,
    `ENEMIES (if it comes to a fight): ${scene.enemies.map((e) => `${e.name} (id ${e.id})`).join(', ')}`,
    `UNLOCKED SECRETS:\n${secrets.length ? secrets.map((s) => `- [${s.id}] ${s.text}`).join('\n') : '(none yet)'}`,
    `HOW THE SCENE CAN END:\n${scene.endings.map((e) => `- ${e}`).join('\n')}`,
    `FACTS:\n${factsBlock(state, scene, party)}`,
    state.history.length ? `EARLIER CHAPTERS (true; stay consistent with them):\n${earlierChapters(state)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: `${DM_RULES}\n\n${sceneBlock}` },
    { role: 'user', content: `STORY SO FAR:\n${transcriptForModel(state.transcript, scene)}\n\n${instruction}` },
  ];
}

function earlierChapters(state: GameState): string {
  return state.history.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join('\n');
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
- You may argue, refuse, keep secrets or lie, but only for reasons rooted in who you are and what has happened. Never act out of character for drama.
- What you REMEMBER and BELIEVE comes from earlier days. Let it colour what you say and do, and bring it up when it matters.`;

/** The companion's fixed persona plus everything that has changed: memories, beliefs, mood and trust. */
function companionSystem(state: GameState, def: CompanionDef, me: Combatant, party: Combatant[], cue: string): string {
  const cs = state.companions[def.id]!;
  const others = party.filter((c) => c.id !== me.id);
  const memories = recallMemories(cs.memories, cue, state.chapter);
  return [
    COMPANION_RULES,
    `WHO YOU ARE (pronouns ${def.pronouns}):\n${def.persona}`,
    `YOUR CHARACTER SHEET: ${describePc(me)}`,
    `THE PARTY: ${others.map((c) => describePc(c)).join(' | ')}`,
    memories.length ? `WHAT YOU REMEMBER FROM EARLIER:\n${memories.map((m) => `- ${m.text}`).join('\n')}` : '',
    cs.beliefs.length ? `WHAT YOU BELIEVE:\n${cs.beliefs.map((b) => `- ${b}`).join('\n')}` : '',
    `YOUR INNER STATE: mood: ${cs.mood}. Trust (0-10): ${others.map((c) => `${c.name} ${cs.trust[c.id] ?? 5}`).join(', ')}.${cs.intention ? ` You privately intend: ${cs.intention}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The last few lines of the story, used to pick which memories come to mind. */
const recentCue = (state: GameState) =>
  state.transcript
    .slice(-4)
    .map((e) => ('text' in e ? e.text : 'say' in e ? `${e.say} ${e.act}` : ''))
    .join(' ');

/** A quick, cheap read on whether this companion wants the spotlight this beat, and what they make of the PC's choice. */
export function buildPollMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[]): ChatMessage[] {
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 12)}\n\n` +
        `The PC (${scene.pc.name}) has just acted. Before anyone else speaks, decide how much you want to step in right now.\n` +
        '"lead": this moment is yours (your expertise, your secret, your values, or you were asked). "support": a short reaction or small helpful act. "pass": stay quiet and let it play out.\n' +
        `Also judge what ${scene.pc.name} just did, by your own values and goals: "approve" is 1 if you like it, -1 if it bothers you, 0 if neither. Most moments are 0; save 1 and -1 for choices that really touch what you care about. "because" says why in a few words, from your point of view.\n` +
        'Reply with JSON only: {"intent": "lead" | "support" | "pass", "urgency": 1-5, "why": "a few words", "approve": -1 | 0 | 1, "because": "a few words"}',
    },
  ];
}

const SAY_ACT_THOUGHT = (def: CompanionDef) =>
  `"say": "your words, or empty", "act": "what you physically do, in third person using your name and your pronouns (${def.pronouns}${def.pronouns === 'they/them' ? `, e.g. "${def.spec.name} shifts their weight", never he or she` : ''}), or empty", "thought": "one private sentence nobody else hears"`;

export function buildCompanionTurnMessages(
  state: GameState,
  scene: Scene,
  def: CompanionDef,
  me: Combatant,
  party: Combatant[],
  role: 'lead' | 'support',
  leadName?: string,
): ChatMessage[] {
  const roleText =
    role === 'lead'
      ? 'The spotlight is yours this beat: react to what just happened and take the initiative if you want to.'
      : leadName
        ? `${leadName} has the spotlight this beat. You support: one short line or a small action, or almost nothing. Do not take over or repeat what they did.`
        : 'React briefly: one short line or a small action. Do not take over the scene.';
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene)}\n\n${roleText}\n` +
        'Keep "say" and "act" under 60 words together. Update your mood if something just changed it.\n' +
        `Reply with JSON only: {${SAY_ACT_THOUGHT(def)}, "mood": "a few words"}`,
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
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
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

// ---- Scene end and camp ----------------------------------------------------------

/** The DM's record of a finished scene: plain facts later scenes must respect. */
export function buildChronicleMessages(state: GameState, scene: Scene): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You keep the record for a tabletop game. Summarise the scene below as plain facts in 3 to 6 sentences: what the party did, who they helped or hurt, what they gained or lost (especially the medicine), promises made, who died, and anything left unresolved. No style, no speculation.\n' +
        'Reply with JSON only: {"summary": "..."}',
    },
    { role: 'user', content: `SCENE: ${scene.title}\n\n${transcriptForModel(state.transcript.filter((e) => e.kind !== 'combatLog'), scene, 80)}` },
  ];
}

/**
 * The night's reflection: the companion turns the day into memories, rewrites what they believe,
 * and settles how they feel. One call does all of it to keep the night cheap.
 */
export function buildReflectionMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[]): ChatMessage[] {
  const cs = state.companions[def.id]!;
  const pc = scene.pc;
  const others = party.filter((c) => c.id !== me.id && c.id !== pc.id);
  const reasons = cs.approvals.filter((a) => a.chapter === state.chapter);
  return [
    { role: 'system', content: companionSystem(state, def, me, party, 'today') },
    {
      role: 'user',
      content:
        `TODAY (what you saw and heard):\n${perceptionFor(def.id, state.transcript, scene, 60, { skipCombatLog: true })}\n\n` +
        (reasons.length ? `HOW ${pc.name.toUpperCase()} STRUCK YOU TODAY:\n${reasons.map((a) => `- ${a.delta > 0 ? 'liked' : 'disliked'}: ${a.why}`).join('\n')}\n\n` : '') +
        `Night has fallen and the party has made camp. Alone with your thoughts, reflect on the day.\n` +
        '- "memories": 2 to 5 things you will remember from today, each one sentence in first person ("I saw Steven spare the bandit leader"), with "importance" 1 (small) to 5 (you will never forget it).\n' +
        `- "beliefs": up to 6 short opinions you now hold about the people in the party and your situation, rewritten from your old beliefs and today.\n` +
        `- "feeling": one line on how you come across toward ${pc.name} right now, as they could notice it (e.g. "warmer than yesterday", "keeps their distance").\n` +
        '- "intention": what you privately mean to do tomorrow, one sentence.\n' +
        (others.length ? `- "trust": your trust (0-10) in ${others.map((c) => c.name).join(' and ')}; it moves at most 1 point a night.\n` : '') +
        `Reply with JSON only: {"memories": [{"text": "...", "importance": 1-5}], "beliefs": ["..."], "feeling": "...", "mood": "a few words", "intention": "...", "trust": {${others.map((c) => `"${c.id}": 0-10`).join(', ')}}}`,
    },
  ];
}

/** One line of fireside talk between two companions. The PC can overhear. */
export function buildBanterMessages(
  state: GameState,
  scene: Scene,
  def: CompanionDef,
  me: Combatant,
  party: Combatant[],
  partner: Combatant,
  opening: boolean,
): ChatMessage[] {
  const task = opening
    ? `The party is resting by the fire. Start a short conversation with ${partner.name} about something from today that is on your mind: something you saw, someone you disagree with, a worry or a joke. The PC can hear you.`
    : `You are talking with ${partner.name} by the fire, and the PC can hear. Answer what was just said, in character. Keep it moving; don't wrap it up neatly.`;
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 24, { skipCombatLog: true })}\n\n${task}\n` +
        'One or two sentences of speech, plus a small action if it fits.\n' +
        `Reply with JSON only: {${SAY_ACT_THOUGHT(def)}}`,
    },
  ];
}

export type ApproachReason = 'confront' | 'confide' | 'talk';

/** A companion seeks the PC out alone at camp. */
export function buildApproachMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[], reason: ApproachReason): ChatMessage[] {
  const cs = state.companions[def.id]!;
  const pc = scene.pc.name;
  const negatives = cs.approvals.filter((a) => a.delta < 0).map((a) => a.why);
  const task =
    reason === 'confront'
      ? `Your trust in ${pc} has fallen to ${cs.trust[scene.pc.id]}. These things have worn it down: ${negatives.join('; ')}. You take them aside to have it out. Say plainly what has been bothering you and what would have to change. You are not leaving yet, but you are thinking about it.`
      : reason === 'confide'
        ? `You trust ${pc} more than almost anyone (${cs.trust[scene.pc.id]}/10). You take them aside. If you have been keeping something from them, tonight you might finally tell them, or at least start to. Only do it if it fits who you are.`
        : `You take ${pc} aside for a quiet word about what is on your mind after today: something they did, something that worries you, or something you want them to know.`;
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 24, { skipCombatLog: true })}\n\n` +
        `It is night at camp; the others are asleep or out of earshot. ${task}\nUnder 70 words.\n` +
        `Reply with JSON only: {${SAY_ACT_THOUGHT(def)}}`,
    },
  ];
}

/** The companion answers the PC in a private talk at camp, and judges what the PC said. */
export function buildCampTalkMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[]): ChatMessage[] {
  const pc = scene.pc.name;
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 30, { skipCombatLog: true })}\n\n` +
        `It is night at camp and ${pc} is talking with you privately. Answer what they just said, in character, under 70 words.\n` +
        `Judge what ${pc} just said by your own values: "approve" is 1 if it moves you or wins you over, -1 if it hurts or angers you, 0 otherwise. Words count for less than deeds: an honest apology or a real promise can earn a 1, empty flattery does not. "because" says why in a few words.\n` +
        `Reply with JSON only: {${SAY_ACT_THOUGHT(def)}, "mood": "a few words", "approve": -1 | 0 | 1, "because": "a few words"}`,
    },
  ];
}

/** At dawn, a companion who has lost all trust decides whether to stay. */
export function buildDepartureMessages(state: GameState, scene: Scene, def: CompanionDef, me: Combatant, party: Combatant[]): ChatMessage[] {
  const cs = state.companions[def.id]!;
  const pc = scene.pc.name;
  const negatives = cs.approvals.filter((a) => a.delta < 0).map((a) => a.why);
  const choices = def.betrayal ? '"stay" | "leave" | "betray"' : '"stay" | "leave"';
  return [
    { role: 'system', content: companionSystem(state, def, me, party, recentCue(state)) },
    {
      role: 'user',
      content:
        `STORY (what you have seen and heard):\n${perceptionFor(def.id, state.transcript, scene, 30, { skipCombatLog: true })}\n\n` +
        `It is the dark before dawn. Your trust in ${pc} is down to ${cs.trust[scene.pc.id]}/10, worn away by: ${negatives.join('; ')}. You already told them what was wrong.\n` +
        `Decide, as yourself, whether to stay with the party.\n- "stay": you give them one more chance.\n- "leave": ${def.departure}\n` +
        (def.betrayal ? `- "betray": ${def.betrayal}\n` : '') +
        `If you go, "note" is what you leave behind for ${pc}: in your own voice, naming what drove you away. Under 60 words.\n` +
        `Reply with JSON only: {"decision": ${choices}, "note": "...", "thought": "one private sentence"}`,
    },
  ];
}

/** After the camp talk, a cheap pass turns the night's conversations into memories. */
export function buildCampMemoryMessages(state: GameState, scene: Scene, def: CompanionDef): ChatMessage[] {
  const campStart = state.transcript.findIndex((e) => e.kind === 'campStart');
  return [
    {
      role: 'system',
      content:
        `You keep the memory of ${def.spec.name}, a character in a tabletop game. From the night's conversations below, write 0 to 2 things they will remember, ` +
        'each one sentence in first person, with "importance" 1 to 5. Only what truly matters to them; small talk is 0 memories.\n' +
        'Reply with JSON only: {"memories": [{"text": "...", "importance": 1-5}]}',
    },
    { role: 'user', content: `${def.persona}\n\nTONIGHT AT CAMP (YOU = ${def.spec.name}):\n${perceptionFor(def.id, state.transcript.slice(campStart), scene, 40)}` },
  ];
}
