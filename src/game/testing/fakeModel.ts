import type { CompletionRequest, ModelClient } from '../model';

/** A scripted model for party tests: it recognises each kind of call from its prompt. */
export type CallKind =
  | 'dm' | 'helper' | 'poll' | 'companion' | 'combat'
  | 'chronicle' | 'campMemory' | 'reflection' | 'banter' | 'approach' | 'talk' | 'departure';

function kindOf(req: CompletionRequest): CallKind {
  const text = req.messages.map((m) => m.content).join('\n');
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
    const who = kind === 'dm' || kind === 'helper' || kind === 'chronicle' ? '' : whoFor(text);
    this.requests.push({ kind, who, text });
    const queue = this.replies[`${kind}:${who}`] ?? this.replies[kind];
    let next = queue?.shift();
    if (typeof next === 'function') next = next(text);
    if (next === undefined) next = defaults(kind, who);
    return typeof next === 'string' ? next : JSON.stringify(next);
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
  }
}

export const narrate = (narration: string, action: unknown = { type: 'none' }, extra: Record<string, unknown> = {}) => ({
  narration, action, revealed: [], prompt: 'What do you do?', ...extra,
});

