import type { Memory } from './state';

const STOP = new Set(
  'that this with from have they them their there what when where which while about would could should into your just like been were will than then over under after before again only some more most very much also back down here even'.split(' '),
);

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * The memories that matter most right now: important ones, recent ones, and ones that share words
 * with what is happening. Returned oldest first so they read like a story.
 */
export function recallMemories(memories: Memory[], cue: string, chapter: number, limit = 6): Memory[] {
  if (memories.length <= limit) return memories;
  const cueWords = words(cue);
  const score = (m: Memory) => {
    let overlap = 0;
    for (const w of words(m.text)) if (cueWords.has(w)) overlap += 1;
    const recency = m.chapter >= chapter - 1 ? 1 : 0;
    return m.importance + recency + Math.min(3, overlap);
  };
  const ranked = memories.map((m, i) => ({ m, i, s: score(m) })).sort((a, b) => b.s - a.s || b.i - a.i);
  return ranked
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.m);
}
