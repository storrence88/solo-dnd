import { narrationSoFar } from '../src/game/dmReply';
import type { ModelClient } from '../src/game/model';
import type { Entry, GameState } from '../src/game/state';

/** What the page hears while a turn is running, before the finished turn comes back. */
export type LiveEvent =
  /** A line of the story, in order. */
  | { type: 'entry'; entry: Entry }
  /** The DM's narration so far, as the model writes it. Empty means it started over. */
  | { type: 'narration'; text: string }
  /** A new chapter began mid-turn: the entries that follow start a fresh page. */
  | { type: 'chapter' };

type Listener = (event: LiveEvent) => void;

/** Who is watching which game, so a running turn can show its progress as it happens. */
export class LiveHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(id: string, listener: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }

  emit(id: string, event: LiveEvent): void {
    for (const listener of this.listeners.get(id) ?? []) listener(event);
  }

  /**
   * Watches one turn: new transcript entries as they are added, and the DM's narration as it streams.
   * Returns the model to run the turn with, and a function to call when the turn is over.
   */
  watch(id: string, state: GameState, model: ModelClient): { model: ModelClient; stop: () => void } {
    let transcript = state.transcript;
    let sent = transcript.length;
    let narration = '';
    const flush = () => {
      if (state.transcript !== transcript) {
        transcript = state.transcript;
        sent = 0;
        this.emit(id, { type: 'chapter' });
      }
      while (sent < transcript.length) this.emit(id, { type: 'entry', entry: transcript[sent++]! });
    };
    const timer = setInterval(flush, 100);
    const streaming: ModelClient = {
      complete: (request) => {
        if (request.role !== 'dm' || !request.json) return model.complete(request);
        flush();
        return model.complete({
          ...request,
          onText: (soFar) => {
            const text = narrationSoFar(soFar);
            if (text === narration) return;
            narration = text;
            this.emit(id, { type: 'narration', text });
          },
        });
      },
    };
    return {
      model: streaming,
      stop: () => {
        clearInterval(timer);
        flush();
      },
    };
  }
}
