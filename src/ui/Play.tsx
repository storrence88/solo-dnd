import { useEffect, useRef, useState } from 'react';
import type { CombatAction } from '../engine';
import type { GameView } from '../game/game';
import type { Entry } from '../game/state';
import { Card } from './Sandbox';

interface Status {
  hasKey: boolean;
  provider: string;
  dmModel: string;
  scenes: { id: string; title: string }[];
}

interface SavedGame {
  id: string;
  title: string;
  mode: string;
  turns: number;
}

const LAST_GAME = 'solo-dnd:last-game';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ error: `Server error ${res.status}` }))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data;
}

/** Phase 2: play a scene with the AI Dungeon Master. Plain on purpose, so we judge the DM and not the paint. */
export function Play() {
  const [status, setStatus] = useState<Status | null>(null);
  const [saves, setSaves] = useState<SavedGame[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reveal = useReveal(game);
  // While new lines are still appearing, the buttons and HP cards wait so they don't spoil the outcome.
  const revealing = reveal.revealing;
  const side = revealing ? reveal.before : game;

  useEffect(() => {
    call<Status>('GET', '/api/status').then(setStatus, () => setError('Cannot reach the game server. Start it with "npm run dev".'));
    call<SavedGame[]>('GET', '/api/games').then(setSaves, () => {});
    const last = localStorage.getItem(LAST_GAME);
    if (last) call<GameView>('GET', `/api/games/${last}`).then(setGame, () => localStorage.removeItem(LAST_GAME));
  }, []);

  const run = async (work: () => Promise<GameView>): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const view = await work();
      setGame(view);
      localStorage.setItem(LAST_GAME, view.id);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return (
      <>
        <header>
          <h1>Solo D&amp;D</h1>
          <p className="sub">You, a Dungeon Master, and a bridge full of trouble. The AI tells the story; the rules engine rolls every die.</p>
        </header>
        {status && !status.hasKey && <KeyHelp />}
        {error && <p className="error">{error}</p>}
        <section className="start">
          {status?.scenes.map((s) => (
            <button key={s.id} disabled={busy} onClick={() => run(() => call('POST', '/api/games', { sceneId: s.id }))}>
              New game: {s.title}
            </button>
          ))}
          {saves.length > 0 && (
            <div className="saves">
              <h2>Continue</h2>
              {saves.map((s) => (
                <button key={s.id} disabled={busy} onClick={() => run(() => call('GET', `/api/games/${s.id}`))}>
                  {s.title} · {s.turns} turns{s.mode === 'over' ? ' · finished' : ''}
                </button>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="play">
      <header className="row">
        <div>
          <h1>{game.title}</h1>
          {status && <p className="sub">DM: {status.dmModel} via {status.provider}</p>}
        </div>
        <button
          onClick={() => {
            localStorage.removeItem(LAST_GAME);
            setGame(null);
            call<SavedGame[]>('GET', '/api/games').then(setSaves, () => {});
          }}
        >
          Leave
        </button>
      </header>
      {status && !status.hasKey && <KeyHelp />}

      <div className="play-grid">
        <section>
          <Transcript entries={game.transcript} delays={reveal.delays} />
          {game.combat && <CombatLog lines={game.combat.log} delays={reveal.liveDelays} />}
          {busy && <p className="thinking">The DM is thinking…</p>}
          {error && <p className="error">{error}</p>}
          {game.mode === 'explore' && !revealing && <ActBox busy={busy} onSend={(text) => run(() => call('POST', `/api/games/${game.id}/act`, { text }))} />}
          {game.mode === 'over' && !revealing && <p className="over">The scene is over. Leave to start another.</p>}
          {game.combat && !revealing && (
            <Actions
              busy={busy}
              view={game}
              onPick={(action: CombatAction) => run(() => call('POST', `/api/games/${game.id}/combat`, { action }))}
            />
          )}
        </section>
        <aside>
          {side?.combat ? (
            <>
              <h2>Round {side.combat.round}</h2>
              {side.combat.combatants.map((c) => (
                <Card key={c.id} c={c} active={c.id === side.pc.id && side.combat!.yourTurn && !revealing} />
              ))}
            </>
          ) : (
            <>
              <h2>You</h2>
              <Card c={(side ?? game).pc} active={false} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const LINE_DELAY = 0.7;
const ENTRY_DELAY = 0.4;

/**
 * Entries that arrive after the page loads fade in one after another, combat lines one at a time,
 * so a round plays out instead of landing all at once. A loaded save shows instantly.
 */
function useReveal(game: GameView | null) {
  const r = useRef({ gameId: '', seen: 0, liveSeen: 0, delays: new Map<number, number[]>(), liveDelays: [] as number[], until: 0, before: game, last: game });
  const [, rerender] = useState(0);
  const s = r.current;
  const live = game?.combat?.log ?? [];
  if (game && game.id !== s.gameId) {
    Object.assign(s, { gameId: game.id, seen: game.transcript.length, liveSeen: live.length, liveDelays: [], until: 0, before: game });
    s.delays.clear();
  } else if (game && (game.transcript.length > s.seen || live.length !== s.liveSeen)) {
    let t = 0;
    for (let i = s.seen; i < game.transcript.length; i++) {
      const e = game.transcript[i]!;
      if (e.kind === 'player') {
        s.delays.set(i, [0]);
      } else if (e.kind === 'combatLog') {
        s.delays.set(i, e.lines.map((_, j) => t + j * LINE_DELAY));
        t += e.lines.length * LINE_DELAY;
      } else {
        s.delays.set(i, [t]);
        t += ENTRY_DELAY;
      }
    }
    // The fight's not-yet-narrated lines (shown under the transcript) continue the same sequence.
    if (live.length < s.liveSeen || game.transcript.length > s.seen) s.liveSeen = 0;
    s.liveDelays = live.map((_, j) => (j < s.liveSeen ? -1 : t + (j - s.liveSeen) * LINE_DELAY));
    t += Math.max(0, live.length - s.liveSeen) * LINE_DELAY;
    s.liveSeen = live.length;
    s.seen = game.transcript.length;
    s.until = Date.now() + t * 1000;
    s.before = s.last;
  }
  s.last = game;
  const revealing = Date.now() < s.until;
  useEffect(() => {
    if (!revealing) return;
    const timer = setTimeout(() => rerender((n) => n + 1), s.until - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [s.until, revealing]);
  return { revealing, delays: s.delays, liveDelays: s.liveDelays, before: s.before };
}

function Transcript({ entries, delays }: { entries: Entry[]; delays: Map<number, number[]> }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length]);
  const lastDm = entries.findLastIndex((e) => e.kind === 'dm');
  return (
    <div className="transcript">
      {entries.map((e, i) => (
        <EntryView key={i} e={e} showPrompt={i === lastDm} delays={delays.get(i)} />
      ))}
      <div ref={end} />
    </div>
  );
}

function EntryView({ e, showPrompt, delays }: { e: Entry; showPrompt: boolean; delays?: number[] }) {
  if (e.kind === 'combatLog') return <CombatLog lines={e.lines} delays={delays} />;
  if (!delays) return <EntryBody e={e} showPrompt={showPrompt} />;
  return (
    <div className="reveal" style={{ animationDelay: `${delays[0]}s` }}>
      <EntryBody e={e} showPrompt={showPrompt} />
    </div>
  );
}

function EntryBody({ e, showPrompt }: { e: Entry; showPrompt: boolean }) {
  switch (e.kind) {
    case 'dm':
      return (
        <div className="entry dm">
          <p>{e.text}</p>
          {showPrompt && <p className="prompt">{e.prompt}</p>}
        </div>
      );
    case 'player':
      return <div className="entry player">{e.text}</div>;
    case 'check':
      return (
        <div className={`entry check ${e.success ? 'success' : 'failure'}`}>
          <strong>{e.label} check, DC {e.dc}</strong>
          <span>
            d20 {e.rolls.length > 1 ? `(${e.rolls.join(', ')})` : e.rolls[0]} {e.modifier >= 0 ? '+' : '−'} {Math.abs(e.modifier)} = <b>{e.total}</b>
          </span>
          <span className="verdict">{e.success ? 'Success' : 'Failure'}</span>
          {e.reason && <small>{e.reason}</small>}
        </div>
      );
    case 'combatStart':
      return <div className="entry banner">⚔ Combat begins</div>;
    case 'combatLog':
      return <CombatLog lines={e.lines} />;
    case 'combatEnd':
      return <div className="entry banner">{e.result === 'victory' ? 'Victory' : e.result === 'enemiesFled' ? 'The enemies break and flee' : 'You fall'}</div>;
    case 'sceneEnd':
      return <div className="entry banner">Scene over: {e.outcome}</div>;
  }
}

function CombatLog({ lines, delays }: { lines: string[]; delays?: number[] }) {
  if (!lines.length) return null;
  return (
    <ol className="entry combat-log">
      {lines.map((l, i) => (
        <li key={i} className={(delays?.[i] ?? -1) >= 0 ? 'reveal' : undefined} style={(delays?.[i] ?? -1) >= 0 ? { animationDelay: `${delays![i]}s` } : undefined}>
          {l}
        </li>
      ))}
    </ol>
  );
}

function ActBox({ busy, onSend }: { busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim() || busy) return;
    if (await onSend(text)) setText('');
  };
  return (
    <div className="act">
      <textarea
        value={text}
        placeholder="What do you do? (Enter to send, Shift+Enter for a new line)"
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button onClick={send} disabled={busy || !text.trim()}>
        Send
      </button>
    </div>
  );
}

function Actions({ view, busy, onPick }: { view: GameView; busy: boolean; onPick: (a: CombatAction) => void }) {
  const actions = view.combat?.actions ?? [];
  if (!view.combat?.yourTurn) return null;
  return (
    <div className="actions">
      <h2>Your turn</h2>
      <div className="buttons wrap">
        {actions.map((a) => (
          <button key={JSON.stringify(a.action)} disabled={busy} className={a.action.kind === 'endTurn' ? 'end' : ''} onClick={() => onPick(a.action)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyHelp() {
  return (
    <div className="notice">
      <strong>No API key yet.</strong> Create a file named <code>.env</code> in the solo-dnd folder containing <code>GROQ_API_KEY=your-key</code>, then stop
      the server and run <code>npm run dev</code> again.
    </div>
  );
}
