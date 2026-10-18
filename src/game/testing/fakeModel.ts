import type { CompletionRequest, ModelClient } from '../model';

/** A scripted model for party tests: it recognises each kind of call from its prompt. */
export type CallKind =
  | 'dm' | 'helper' | 'poll' | 'companion' | 'combat'
  | 'chronicle' | 'campMemory' | 'reflection' | 'banter' | 'approach' | 'talk' | 'departure'
  | 'outline' | 'plan' | 'ledger' | 'recap';

function kindOf(req: CompletionRequest): CallKind {
  const text = req.messages.map((m) => m.content).join('\n');
  if (text.includes('Design a new campaign')) return 'outline';
  if (text.includes('Write the plan for the next scene')) return 'plan';
  if (text.includes('You keep the record for a tabletop campaign')) return 'ledger';
  if (text.includes('"previously on')) return 'recap';
  if (req.role === 'dm') return 'dm';
  if (req.role === 'helper') {
    if (text.includes('"intent"')) return 'poll';
    if (text.includes('You keep the record')) return 'chronicle';
    if (text.includes('You keep the memory of')) return 'campMemory';
    return 'helper';
  }
  if (text.includes('YOUR OPTIONS RIGHT NOW')) return 'combat';
  if (text.includes('Alone with your thoughts')) return 'reflection';
  if (text.includes('by the fire')) return 'banter';
  if (text.includes('asleep or out of earshot')) return 'approach';
  if (text.includes('is talking with you privately')) return 'talk';
  if (text.includes('dark before dawn')) return 'departure';
  return 'companion';
}

/** Which companion a poll or turn is for, read from its persona line. */
const whoFor = (text: string) => (text.includes('Brenna Ashford, human cleric') ? 'brenna' : 'quill');

export type Reply = unknown | ((text: string) => unknown);

/** Scripted model: replies per kind of call, optionally per companion, recording everything it was sent. */
export class FakeModel implements ModelClient {
  requests: { kind: CallKind; who: string; text: string }[] = [];
  constructor(private replies: Partial<Record<string, Reply[]>> = {}) {}
  async complete(req: CompletionRequest): Promise<string> {
    const kind = kindOf(req);
    const text = req.messages.map((m) => m.content).join('\n');
    const who = ['dm', 'helper', 'chronicle', 'outline', 'plan', 'ledger', 'recap'].includes(kind) ? '' : whoFor(text);
    this.requests.push({ kind, who, text });
    const queue = this.replies[`${kind}:${who}`] ?? this.replies[kind];
    let next = queue?.shift();
    if (typeof next === 'function') next = next(text);
    if (next === undefined) next = defaults(kind, who);
    const out = typeof next === 'string' ? next : JSON.stringify(next);
    // Streams in two halves, like a real model would in many small pieces.
    if (req.onText) for (const end of [0, out.length >> 1, out.length]) req.onText(out.slice(0, end));
    return out;
  }
  seen(kind: CallKind, who = ''): string[] {
    return this.requests.filter((r) => r.kind === kind && (!who || r.who === who)).map((r) => r.text);
  }
}

function defaults(kind: CallKind, who: string): unknown {
  switch (kind) {
    case 'dm':
      return narrate('The river roars.');
    case 'helper':
      return { met: [] };
    case 'poll':
      return { intent: 'pass', urgency: 1 };
    case 'companion':
      return { say: `${who} nods.`, act: '', thought: `${who} private thought`, mood: 'wary', trust: {} };
    case 'combat':
      return { choices: [0], say: '', thought: '' };
    case 'chronicle':
      return { summary: 'The party crossed Greyford Bridge.' };
    case 'campMemory':
      return { memories: [] };
    case 'reflection':
      return { memories: [{ text: `${who} remembers the bridge.`, importance: 3 }], beliefs: [`${who} believes in the road.`], feeling: 'steady', mood: 'tired', intention: 'sleep', trust: {} };
    case 'banter':
    case 'approach':
      return { say: `${who} speaks at the fireside.`, act: '', thought: '' };
    case 'talk':
      return { say: `${who} answers.`, act: '', thought: '', mood: 'calm', approve: 0, because: '' };
    case 'departure':
      return { decision: 'stay', note: '', thought: '' };
    case 'outline':
      return OUTLINE;
    case 'plan':
      return scenePlan('The Salt Steps');
    case 'ledger':
      return { summary: 'The party did a day\'s work.', quests: [], factions: [], actDone: false };
    case 'recap':
      return { recap: 'Previously, you crossed a bridge.' };
  }
}

export const narrate = (narration: string, action: unknown = { type: 'none' }, extra: Record<string, unknown> = {}) => ({
  narration, action, revealed: [], prompt: 'What do you do?', ...extra,
});


/** A complete campaign outline, as the planner might write it. */
export const OUTLINE = {
  title: 'The Brine Crown',
  premise: 'Salt miners are vanishing beneath the town of Saltmere, and the mine guild says nothing.',
  tone: 'mystery',
  region: { name: 'Saltmere', description: 'A grey mining town on a cold coast.' },
  places: [{ name: 'The Deep Galleries', description: 'Old flooded tunnels.' }],
  factions: [
    { id: 'guild', name: 'The Salt Guild', description: 'Owns the mine.', goal: 'Hide the drowned shrine they broke into.', attitude: 0 },
    { id: 'tide-sisters', name: 'Tide Sisters', description: 'Fisherwomen who pray to the sea.', goal: 'Seal the shrine forever.', attitude: 1 },
  ],
  threat: { name: 'The Brine Queen', description: 'A drowned saint waking under the mine.', goal: 'Rise and take the town.' },
  acts: [
    { title: 'Missing Miners', goal: 'Find out what happened to the miners.', plan: 'The guild broke into a drowned shrine; its keeper takes miners.' },
    { title: 'The Guild\'s Lie', goal: 'Expose the guild.', plan: 'The guildmaster bargains with the Brine Queen.' },
    { title: 'The Drowned Shrine', goal: 'Stop the Brine Queen.', plan: 'Seal the shrine or bargain with her.' },
  ],
  secrets: ['The guildmaster has been feeding miners to the shrine.'],
  endings: ['The shrine is sealed.', 'The Brine Queen rises.'],
  pcHook: 'Steven\'s old friend was one of the missing miners.',
  companions: {
    brenna: { hook: 'You came to Saltmere to treat a coughing sickness in the mine.', mood: 'uneasy' },
    quill: { hook: 'You owe the Salt Guild money.', mood: 'twitchy', betrayal: 'Sell the party out to the guild to clear your debt.' },
  },
  firstQuest: { title: 'Find the missing miners', goal: 'Learn what happened to the night shift.' },
};

/** A scene plan, as the planner might write it. */
export const scenePlan = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  location: 'Wet stone steps down into the mine.',
  opening: `${title}: you stand at the top of the salt steps as the night shift fails to come up.`,
  situation: 'The night shift is missing. The foreman is nervous.',
  npcs: [{ id: 'foreman', name: 'Foreman Garrow', description: 'A nervous man with a lantern.', goal: 'Keep his job.', voice: 'Mumbles.' }],
  secrets: [{ id: 'ledger', text: 'The foreman was paid to send the shift down the flooded gallery.', trigger: 'The party presses the foreman or reads his ledger.' }],
  enemies: [{ id: 'garrow-men', monster: 'thug', name: 'Garrow\'s cousin' }],
  endings: ['The party goes down the steps.', 'The party leaves.'],
  ...extra,
});
