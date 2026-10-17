import { formatModifier, type Combatant } from '../engine';
import type { ChatMessage } from './model';
import type { Scene } from './scene';
import type { Entry, GameState } from './state';

const DM_RULES = `You are the Dungeon Master for a solo fantasy tabletop game using simplified D&D 5e (2014) rules.

HARD RULES
- You never roll dice and never decide the outcome of something uncertain. When success is in doubt, ask for a check and stop. The game's rules engine rolls it and tells you the result.
- Only the characters listed under PEOPLE and ENEMIES exist in this scene. Never add combatants. The FACTS block is true and you must not contradict it (counts, HP, who is present).
- You only know the secrets listed under UNLOCKED SECRETS. Reveal them through play: what people say and do, not exposition. Never hint at secrets you have not been given.
- Never decide what the player character thinks, says or chooses. Describe the world's response to their action.
- Start combat only when someone actually attacks or a fight is clearly unavoidable.

STYLE
- Second person for the player character ("you"). 60 to 160 words. Show, don't summarise. Give NPCs their own voice.
- End by handing the turn back to the player in "prompt": a short question or "What do you do?".

OUTPUT
Reply with one JSON object and nothing else:
{
  "narration": "what happens, in prose",
  "action": one of
    {"type": "none"}
    {"type": "check", "check": "<skill or ability>", "dc": <5-30>, "reason": "<what the roll decides>"}
    {"type": "combat", "enemies": ["<enemy ids that fight>"], "reason": "<why it comes to blows>"}
    {"type": "endScene", "outcome": "<one sentence on how the scene ended>"},
  "revealed": ["<ids of unlocked secrets this narration revealed, if any>"],
  "prompt": "the question handing the turn back to the player"
}
Skills: athletics, acrobatics, sleightOfHand, stealth, arcana, history, investigation, nature, religion, animalHandling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion. Abilities: str, dex, con, int, wis, cha.
When you ask for a check, narrate only the attempt, not the result.`;

export function describePc(pc: Combatant): string {
  const attacks = pc.attacks.map((a) => `${a.name} ${formatModifier(a.toHit)} (${a.damage})`).join(', ');
  return `${pc.name}, ${pc.classId} ${pc.level}. HP ${pc.hp}/${pc.maxHp}, AC ${pc.ac}. Attacks: ${attacks}. Skills: ${pc.skillProficiencies.join(', ')}.`;
}

export function transcriptForModel(entries: Entry[], scene: Scene, limit = 30): string {
  const nameOf = (id: string) => scene.enemies.find((e) => e.id === id)?.name ?? id;
  return entries
    .slice(-limit)
    .map((e) => {
      switch (e.kind) {
        case 'player':
          return `PLAYER: ${e.text}`;
        case 'dm':
          return `DM: ${e.text}`;
        case 'check':
          return `CHECK (${e.reason}): ${e.label} DC ${e.dc}, rolled ${e.total}: ${e.success ? 'SUCCESS' : 'FAILURE'}`;
        case 'combatStart':
          return `COMBAT STARTS against ${e.enemyIds.map(nameOf).join(', ')}`;
        case 'combatLog':
          return `COMBAT: ${e.lines.join(' | ')}`;
        case 'combatEnd':
          return `COMBAT ENDS: ${e.result}`;
        case 'sceneEnd':
          return `SCENE ENDS: ${e.outcome}`;
      }
    })
    .join('\n');
}

function factsBlock(state: GameState, scene: Scene, pc: Combatant): string {
  const present = scene.enemies.filter((e) => !state.removedEnemies.includes(e.id));
  const gone = scene.enemies.filter((e) => state.removedEnemies.includes(e.id));
  return [
    `Player character: ${describePc(pc)}`,
    `Enemies still in the scene: exactly ${present.length}${present.length ? ` (${present.map((e) => e.name).join(', ')})` : ''}.`,
    gone.length ? `No longer in play: ${gone.map((e) => e.name).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDmMessages(state: GameState, scene: Scene, pc: Combatant, instruction: string): ChatMessage[] {
  const secrets = scene.secrets.filter((s) => state.unlockedSecrets.includes(s.id));
  const sceneBlock = [
    `SCENE: ${scene.title}`,
    `SITUATION: ${scene.situation}`,
    `LOCATION: ${scene.location}`,
    `PEOPLE:\n${scene.npcs.map((n) => `- ${n.name} (id ${n.id}): ${n.description} Wants: ${n.goal} Voice: ${n.voice}`).join('\n')}`,
    `ENEMIES (if it comes to a fight): ${scene.enemies.map((e) => `${e.name} (id ${e.id})`).join(', ')}`,
    `UNLOCKED SECRETS:\n${secrets.length ? secrets.map((s) => `- [${s.id}] ${s.text}`).join('\n') : '(none yet)'}`,
    `HOW THE SCENE CAN END:\n${scene.endings.map((e) => `- ${e}`).join('\n')}`,
    `FACTS:\n${factsBlock(state, scene, pc)}`,
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
