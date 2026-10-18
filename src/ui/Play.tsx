import { motion, useReducedMotion } from 'motion/react';
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CombatAction, Combatant } from '../engine';
import type { GameView } from '../game/game';
import type { Entry } from '../game/state';
import { atEnd, clampCursor, TUMBLE, endCursor, nextCursor, pendingState, unitAt, type Cursor, type Roll } from './playback';
import { Card } from './Sandbox';
import { useFollowStory, useTypewriter } from './flow';
import { Illuminated } from './Initial';

// three.js is big, so the dice load on their own while the page is already up.
const DiceTray = lazy(() => import('./Dice'));

interface Status {
  hasKey: boolean;
  provider: string;
  dmModel: string;
  campaigns: { id: string; title: string }[];
  tones: string[];
  classes: string[];
}

/** What the player fills in to make their own character. */
interface NewCharacter {
  name: string;
  classId: string;
  pronouns: string;
  background: string;
}

/** The player character's id, so entries about them can leave their name off. */
const PcId = createContext('steven');

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const;
type AbilityKey = keyof typeof ABILITY_NAMES;

interface SavedGame {
  id: string;
  title: string;
  scene: string;
  chapter: number;
  mode: string;
  turns: number;
}

const LAST_GAME = 'solo-dnd:last-game';
const SHOW_THOUGHTS = 'solo-dnd:show-thoughts';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

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

/** A turn as it happens, before the finished turn comes back (see server/live.ts). */
type LiveEvent = { type: 'entry'; entry: Entry } | { type: 'narration'; text: string } | { type: 'chapter' };

interface Live {
  /** A new chapter began mid-turn, so these entries start a fresh page. */
  fresh: boolean;
  entries: Entry[];
  /** The DM's narration so far, while it is being written. */
  narration: string;
}

/** Listens to a game's running turn. Resolves once listening (or after a second, so a turn is never held up). */
function listen(id: string, onEvent: (e: LiveEvent) => void): Promise<() => void> {
  return new Promise((resolve) => {
    if (typeof EventSource === 'undefined') return resolve(() => {});
    const source = new EventSource(`/api/games/${id}/live`);
    const stop = () => source.close();
    const timer = setTimeout(() => resolve(stop), 1000);
    source.onopen = () => {
      clearTimeout(timer);
      resolve(stop);
    };
    source.onmessage = (m) => onEvent(JSON.parse(m.data as string) as LiveEvent);
  });
}

/** Play an adventure with the AI Dungeon Master and companions, at a table that plays each turn out as it happens. */
export function Play() {
  const [status, setStatus] = useState<Status | null>(null);
  const [saves, setSaves] = useState<SavedGame[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [thoughts, setThoughts] = useState(() => readFlag(SHOW_THOUGHTS));
  const [live, setLive] = useState<Live | null>(null);
  const [roll, setRoll] = useState<(Roll & { id: number }) | null>(null);
  /** DM lines the player already watched being written, which then appear without a second reveal. */
  const streamed = useRef(new Set<string>());
  /** Where this turn's new lines start, and what each card showed when the last turn finished. */
  const turnStart = useRef(0);
  const knownHp = useRef(new Map<string, number>());
  const fast = useReducedMotion() ?? false;
  /** The DM narration being written: typed out smoothly however unevenly it arrives. */
  const [speech, setSpeech] = useState('');
  const typed = useTypewriter(speech, fast);
  const story = useFollowStory();

  // Everything the story holds right now: the saved transcript, then whatever the running turn has added.
  const entries = useMemo<Entry[]>(() => {
    if (!game) return [];
    if (live?.fresh) return live.entries;
    // A fight's lines the DM hasn't narrated yet sit at the end until the next turn moves them into the story.
    const unnarrated = game.combat?.log.length && !live?.entries.length ? [{ kind: 'combatLog' as const, lines: game.combat.log }] : [];
    return [...game.transcript, ...unnarrated, ...(live?.entries ?? [])];
  }, [game, live]);
  const page = game ? `${game.chapters.length + (live?.fresh ? 1 : 0)}` : '';
  // A narration the player watched being written waits for its typing to finish before it settles into the story.
  const stillTyping = (e: Entry) => e.kind === 'dm' && e.text === speech && !typed.caughtUp;
  const playback = usePlayback(entries, game?.id ?? '', page, game?.pcId ?? '', (r) => setRoll({ ...r, id: Date.now() }), fast, stillTyping, typed.caughtUp);
  const here = entries[playback.cursor.i];
  const speaking =
    !!speech &&
    (atEnd(entries, playback.cursor) || (here?.kind === 'dm' && here.text === speech)) &&
    !entries.slice(0, playback.cursor.i).some((e) => e.kind === 'dm' && e.text === speech);
  // While new lines are still appearing, the buttons wait so they don't spoil the outcome.
  const revealing = !playback.done;
  useEffect(() => {
    if (!revealing && game) knownHp.current = new Map((game.combat?.combatants ?? game.party.map((m) => m.character)).map((c) => [c.name, c.hp]));
  }, [revealing, game]);

  useEffect(() => {
    call<Status>('GET', '/api/status').then(setStatus, () => setError('Cannot reach the game server. Start it with "npm run dev".'));
    call<SavedGame[]>('GET', '/api/games').then(setSaves, () => {});
    const last = localStorage.getItem(LAST_GAME);
    if (last) call<GameView>('GET', `/api/games/${last}`).then(resume, () => localStorage.removeItem(LAST_GAME));
  }, []);

  const run = async (work: () => Promise<GameView>, watching = game): Promise<boolean> => {
    setBusy(true);
    setError('');
    let stop = () => {};
    story.follow();
    setSpeech('');
    if (watching) {
      turnStart.current = entries.length;
      setLive({ fresh: false, entries: [], narration: '' });
      let narrating = '';
      stop = await listen(watching.id, (e) => {
        if (e.type === 'narration') {
          narrating = e.text;
          if (e.text) setSpeech(e.text);
        } else if (e.type === 'entry' && e.entry.kind === 'dm' && narrating) {
          // The narration being written has landed as a line of the story.
          streamed.current.add(e.entry.text);
          setSpeech(e.entry.text);
          narrating = '';
        }
        setLive((l) => (l ? applyLive(l, e) : l));
      });
    }
    try {
      const view = await work();
      setLive(null);
      setGame(view);
      localStorage.setItem(LAST_GAME, view.id);
      return true;
    } catch (e) {
      setLive(null);
      setSpeech('');
      setError((e as Error).message);
      return false;
    } finally {
      stop();
      setBusy(false);
    }
  };

  /** Opens a saved game, with a "previously on" if there is a story to recap. */
  const resume = (view: GameView) => {
    setSpeech('');
    setGame(view);
    localStorage.setItem(LAST_GAME, view.id);
    if (!view.recap && view.mode !== 'ended' && (view.chapters.length > 0 || view.transcript.some((e) => e.kind === 'player'))) {
      void run(() => call('POST', `/api/games/${view.id}/recap`), view);
    }
  };

  if (!game) {
    return (
      <>
        <header>
          <h1>Solo D&amp;D</h1>
          <p className="sub">You, a Dungeon Master, and two companions with minds of their own. The AI tells the story; the rules engine rolls every die.</p>
        </header>
        {status && !status.hasKey && <KeyHelp />}
        {error && <p className="error">{error}</p>}
        <section className="start">
          <NewCampaign
            busy={busy}
            tones={status?.tones ?? []}
            classes={status?.classes ?? []}
            onStart={(premise, tone, character) => run(() => call('POST', '/api/games', { premise, tone, character }))}
          />
          {busy && <p className="thinking">The DM is planning your campaign. This can take a minute…</p>}
          <h2>Quick start</h2>
          {status?.campaigns.map((c) => (
            <button key={c.id} disabled={busy} onClick={() => run(() => call('POST', '/api/games', { campaignId: c.id }))}>
              {c.title}
            </button>
          ))}
          {saves.length > 0 && (
            <div className="saves">
              <h2>Continue</h2>
              {saves.map((s) => (
                <button key={s.id} disabled={busy} onClick={() => call<GameView>('GET', `/api/games/${s.id}`).then(resume, (e: Error) => setError(e.message))}>
                  {s.title} · chapter {s.chapter}: {s.scene} · {s.turns} turns{s.mode === 'camp' ? ' · at camp' : s.mode === 'over' ? ' · scene over' : s.mode === 'ended' ? ' · finished' : ''}
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
          <h1>{game.campaignTitle}</h1>
          <p className="sub">
            {game.journal && `Act ${game.journal.act.n}: ${game.journal.act.title} · `}
            Chapter {game.chapters.length + 1}: {game.title} · Level {game.level}
            {status && ` · DM: ${status.dmModel} via ${status.provider}`}
          </p>
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

      <PcId.Provider value={game.pcId}>
      <div className="play-grid">
        <section>
          {game.recap && (
            <div className="recap">
              <strong>Previously…</strong>
              <p>{game.recap}</p>
            </div>
          )}
          {game.chapters.map((c, i) => (
            <PastChapter key={i} n={i + 1} chapter={c} thoughts={thoughts} />
          ))}
          <Transcript entries={entries} cursor={playback.cursor} animateFrom={playback.animateFrom} streamed={streamed.current} thoughts={thoughts} />
          {speaking && (
            <div className="entry dm streaming">
              <Illuminated text={typed.text}>
                <span className="ink-caret" aria-hidden />
              </Illuminated>
            </div>
          )}
          <Suspense fallback={null}>
            <DiceTray roll={roll} />
          </Suspense>
          {busy && !speaking && atEnd(entries, playback.cursor) && <p className="thinking">{busyText(game)}</p>}
          {error && <p className="error">{error}</p>}
          {game.mode === 'explore' && !revealing && (
            <ActBox
              busy={busy}
              hasParty={game.party.length > 1}
              onSend={(text) => run(() => call('POST', `/api/games/${game.id}/act`, { text }))}
              onHandOff={() => run(() => call('POST', `/api/games/${game.id}/act`, { handOff: true }))}
            />
          )}
          {game.mode === 'over' && !revealing && !game.hasNext && <p className="over">The adventure is over. Leave to start another.</p>}
          {game.mode === 'ended' && !revealing && <p className="over">The End. Leave to start another campaign.</p>}
          {game.mode === 'over' && !revealing && game.hasNext && (
            <div className="act-buttons">
              <button disabled={busy} onClick={() => run(() => call('POST', `/api/games/${game.id}/camp`))}>
                Make camp for the night
              </button>
            </div>
          )}
          {game.mode === 'camp' && game.camp && !revealing && (
            <CampBox
              key={game.id}
              busy={busy}
              view={game}
              onSay={(text, to) => run(() => call('POST', `/api/games/${game.id}/talk`, { text, to }))}
              onBreak={() => run(() => call('POST', `/api/games/${game.id}/break`))}
              onBoost={(boosts) => run(() => call('POST', `/api/games/${game.id}/levelup`, { boosts }))}
            />
          )}
          {game.combat && !revealing && (
            <Actions
              busy={busy}
              view={game}
              onPick={(action: CombatAction) => run(() => call('POST', `/api/games/${game.id}/combat`, { action }))}
            />
          )}
        </section>
        <aside>
          {(() => {
            const view = game;
            const inner = (id: string) => view.party.find((m) => m.character.id === id)?.companion;
            const nameOf = (id: string) => view.party.find((m) => m.character.id === id)?.character.name.split(' ')[0] ?? id;
            const innerLine = (id: string) => {
              const c = inner(id);
              if (!c) return null;
              const trust = Object.entries(c.trust).map(([who, n]) => `${nameOf(who)} ${n}`).join(', ');
              return (
                <>
                  {c.feeling && <p className="feeling">{c.feeling}</p>}
                  {thoughts && <p className="inner">Mood: {c.mood} · Trust: {trust}</p>}
                  {thoughts && (c.beliefs.length > 0 || c.memories.length > 0) && (
                    <details className="journal">
                      <summary>What {nameOf(id)} remembers and believes</summary>
                      {c.beliefs.length > 0 && (
                        <ul className="beliefs">
                          {c.beliefs.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {c.memories.length > 0 && (
                        <ul className="memories">
                          {c.memories.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      )}
                      {c.intention && <p className="inner">Means to: {c.intention}</p>}
                    </details>
                  )}
                </>
              );
            };
            const table = tableNow(view, entries, playback.cursor, turnStart.current, knownHp.current);
            const party = table.combatants.filter((c) => c.side === 'party');
            const enemies = table.combatants.filter((c) => c.side === 'enemy');
            return (
              <>
                <h2>{view.combat ? `Round ${table.round}` : view.party.length > 1 ? 'Party' : 'You'}</h2>
                {party.map((c) => (
                  <div key={c.id}>
                    <Card c={c} active={c.id === view.pcId && !!view.combat?.yourTurn && !revealing} animated={!fast} />
                    {innerLine(c.id)}
                  </div>
                ))}
                {enemies.length > 0 && <h2 className="enemies">Enemies</h2>}
                {enemies.map((c) => (
                  <Card key={c.id} c={c} active={false} animated={!fast} />
                ))}
                {view.journal && <Journal journal={view.journal} />}
                {view.party.length > 1 && (
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={thoughts}
                      onChange={(e) => {
                        setThoughts(e.target.checked);
                        try {
                          localStorage.setItem(SHOW_THOUGHTS, e.target.checked ? '1' : '0');
                        } catch {
                          // The setting just won't be remembered.
                        }
                      }}
                    />
                    Peek at companions' thoughts
                  </label>
                )}
              </>
            );
          })()}
        </aside>
      </div>
      </PcId.Provider>
    </div>
  );
}

/** A live event folded into the running turn. */
function applyLive(l: Live, e: LiveEvent): Live {
  if (e.type === 'chapter') return { fresh: true, entries: [], narration: '' };
  if (e.type === 'narration') return { ...l, narration: e.text };
  return { ...l, entries: [...l.entries, e.entry], narration: e.entry.kind === 'dm' ? '' : l.narration };
}

/**
 * Plays new lines one at a time: each entry, and each line of a fight, with a pause to read it and
 * the dice rolled before any line that has a roll. A loaded save shows at once; a new chapter plays
 * from the top.
 */
function usePlayback(entries: Entry[], gameId: string, page: string, pcId: string, onRoll: (r: Roll) => void, fast: boolean, waitFor: (e: Entry) => boolean, waitKey: unknown) {
  const r = useRef({ gameId: '', page: '', cursor: { i: 0, line: 0 } as Cursor, shownAt: 0, hold: 0, rolled: '', rolledAt: 0, animateFrom: 0 });
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const s = r.current;
  if (gameId !== s.gameId) Object.assign(s, { gameId, page, cursor: endCursor(entries), animateFrom: entries.length, hold: 0 });
  else if (page !== s.page) Object.assign(s, { page, cursor: { i: 0, line: 0 }, animateFrom: 0 });
  s.cursor = clampCursor(entries, s.cursor);
  const at = `${s.page}:${s.cursor.i}:${s.cursor.line}`;
  const roll = useRef(onRoll);
  roll.current = onRoll;

  useEffect(() => {
    if (atEnd(entries, s.cursor) || waitFor(entries[s.cursor.i]!)) return;
    const unit = unitAt(entries, s.cursor, pcId);
    const dice = unit.roll && !fast ? unit.roll : null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = () => {
      s.cursor = nextCursor(entries, s.cursor);
      s.shownAt = Date.now();
      s.hold = fast ? unit.hold * 0.3 : unit.hold;
      tick();
    };
    // Roll first and show the line once the die has landed; a roll already under way is not rolled again.
    const rollThenShow = () => {
      if (!dice) return show();
      if (s.rolled !== at) {
        s.rolled = at;
        s.rolledAt = Date.now();
        roll.current(dice);
      }
      timers.push(setTimeout(show, Math.max(0, s.rolledAt + (TUMBLE + 0.2) * 1000 - Date.now())));
    };
    if (s.rolled === at) rollThenShow();
    else timers.push(setTimeout(rollThenShow, Math.max(0, s.shownAt + s.hold * 1000 - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [at, entries.length, waitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { cursor: s.cursor, done: atEnd(entries, s.cursor), animateFrom: s.animateFrom };
}

/**
 * The party and enemies as the player should see them right now: while a turn plays out, hit points
 * and the round follow the lines shown so far instead of jumping to the end of the turn.
 */
function tableNow(view: GameView, entries: Entry[], cursor: Cursor, turnStart: number, known: Map<string, number>): { combatants: Combatant[]; round: number } {
  const combatants = view.combat?.combatants ?? view.party.map((m) => m.character);
  const round = view.combat?.round ?? 0;
  if (atEnd(entries, cursor) && entries.length <= turnStart) return { combatants, round };
  // Changes already shown this turn, last one winning...
  const shown = new Map<string, number>();
  for (let i = turnStart; i <= cursor.i && i < entries.length; i++) {
    const e = entries[i]!;
    if (e.kind !== 'combatLog') continue;
    for (const line of e.lines.slice(0, i === cursor.i ? cursor.line : undefined)) {
      const m = /^(.+?) (?:takes \d+ .*|regains \d+ HP); HP (-?\d+)$/.exec(line);
      if (m) shown.set(m[1]!, Math.max(0, Number(m[2])));
    }
  }
  // ...and where everyone stood before the first change still to come.
  const pending = pendingState(entries, cursor, new Map(combatants.map((c) => [c.name, c.maxHp])), known);
  return {
    combatants: combatants.map((c) => {
      const hp = pending.hp.get(c.name) ?? shown.get(c.name);
      return hp === undefined || hp === c.hp ? c : { ...c, hp, status: hp > 0 ? 'ok' : c.status };
    }),
    round: pending.round ?? round,
  };
}

function Transcript({ entries, cursor, animateFrom, streamed, thoughts }: { entries: Entry[]; cursor: Cursor; animateFrom: number; streamed: Set<string>; thoughts: boolean }) {
  const visible = entries.slice(0, cursor.i);
  const partial = entries[cursor.i];
  if (partial?.kind === 'combatLog' && cursor.line > 0) visible.push({ kind: 'combatLog', lines: partial.lines.slice(0, cursor.line) });
  const lastDm = visible.findLastIndex((e) => e.kind === 'dm');
  return (
    <div className="transcript">
      {visible.map((e, i) => (
        <EntryView key={i} e={e} showPrompt={i === lastDm} animate={i >= animateFrom && !(e.kind === 'dm' && streamed.has(e.text))} thoughts={thoughts} />
      ))}
    </div>
  );
}

/** How each kind of line arrives on the page. */
function entrance(e: Entry) {
  switch (e.kind) {
    case 'companion':
      return { opacity: 0, x: -14 };
    case 'player':
      return { opacity: 0, x: 14 };
    case 'check':
    case 'approval':
      return { opacity: 0, scale: 0.94 };
    case 'combatStart':
    case 'combatEnd':
    case 'chapter':
    case 'campStart':
      return { opacity: 0, scale: 1.15, letterSpacing: '0.3em' };
    case 'journal':
      return e.lines.some((l) => l.startsWith('Level up')) ? { opacity: 0, scale: 0.8 } : { opacity: 0, y: 6 };
    case 'departure':
      return { opacity: 0, filter: 'blur(4px)' };
    default:
      return { opacity: 0, y: 6 };
  }
}

function EntryView({ e, showPrompt, animate, thoughts }: { e: Entry; showPrompt: boolean; animate: boolean; thoughts: boolean }) {
  if (e.kind === 'combatLog') return <CombatLog lines={e.lines} animate={animate} />;
  return (
    <motion.div
      initial={animate ? entrance(e) : false}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)', letterSpacing: e.kind === 'combatStart' || e.kind === 'combatEnd' || e.kind === 'chapter' || e.kind === 'campStart' ? '0.04em' : undefined }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className={e.kind === 'journal' && e.lines.some((l) => l.startsWith('Level up')) ? 'level-burst' : undefined}
    >
      <EntryBody e={e} showPrompt={showPrompt} thoughts={thoughts} />
    </motion.div>
  );
}

function EntryBody({ e, showPrompt, thoughts }: { e: Entry; showPrompt: boolean; thoughts: boolean }) {
  const pcId = useContext(PcId);
  switch (e.kind) {
    case 'companion':
      if (!e.say && !e.act && !(thoughts && e.thought)) return null;
      return (
        <div className={`entry companion ${e.id} ${e.role}`}>
          <strong className="who">
            {e.name.split(' ')[0]}
            {e.role === 'private' && <small> (to you, privately)</small>}
          </strong>
          {e.act && <span className="act">{e.act}</span>}
          {e.say && <span className="say">“{e.say}”</span>}
          {thoughts && e.thought && <span className="thought">thinks: {e.thought}</span>}
        </div>
      );
    case 'dm':
      return (
        <div className="entry dm">
          <Illuminated text={e.text} />
          {showPrompt && <p className="prompt">{e.prompt}</p>}
        </div>
      );
    case 'player':
      return <div className={`entry player${e.handOff ? ' handoff' : ''}${e.hiddenFrom ? ' private' : ''}`}>{e.text}</div>;
    case 'approval':
      return (
        <div className={`entry approval ${e.delta > 0 ? 'up' : 'down'}`}>
          {e.name.split(' ')[0]} {e.delta > 0 ? 'approves' : 'disapproves'}
          {thoughts && <small>: {e.why}</small>}
        </div>
      );
    case 'campStart':
      return <div className="entry banner camp">Night falls. The party makes camp and rests.</div>;
    case 'chapter':
      return <h2 className="entry chapter-title">{e.title}</h2>;
    case 'departure':
      return (
        <div className={`entry departure${e.betrayed ? ' betrayed' : ''}`}>
          <strong>
            {e.name.split(' ')[0]} is gone.{e.betrayed ? ' And they did not leave empty-handed.' : ''}
          </strong>
          <p>“{e.text}”</p>
        </div>
      );
    case 'check':
      return (
        <div className={`entry check ${e.success ? 'success' : 'failure'}`}>
          <strong>
            {e.whoName && e.who !== pcId ? `${e.whoName.split(' ')[0]}: ` : ''}
            {e.label} check, DC {e.dc}
          </strong>
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
      return <CombatLog lines={e.lines} animate={false} />;
    case 'combatEnd':
      return <div className="entry banner">{e.result === 'victory' ? 'Victory' : e.result === 'enemiesFled' ? 'The enemies break and flee' : 'Defeat'}</div>;
    case 'sceneEnd':
      return <div className="entry banner">Scene over: {e.outcome}</div>;
    case 'journal':
      return (
        <div className="entry journal-update">
          {e.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      );
  }
}

function CombatLog({ lines, animate }: { lines: string[]; animate: boolean }) {
  if (!lines.length) return null;
  return (
    <ol className="entry combat-log">
      {lines.map((l, i) => (
        <motion.li key={i} initial={animate ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className={lineClass(l)}>
          {l}
        </motion.li>
      ))}
    </ol>
  );
}

/** Colour for a fight's line: hits, misses, healing, the fallen. */
function lineClass(line: string): string | undefined {
  if (/CRITICAL HIT$/.test(line)) return 'crit';
  if (/, hit$/.test(line)) return 'hit';
  if (/, miss$/.test(line)) return 'miss';
  if (/ regains \d+ HP/.test(line)) return 'heal';
  if (/ takes \d+ /.test(line)) return 'damage';
  if (/^Round \d+$/.test(line)) return 'round';
  if (/ is (dead|unconscious|stable)| is now /.test(line)) return 'status';
  return undefined;
}

function ActBox({ busy, hasParty, onSend, onHandOff }: { busy: boolean; hasParty: boolean; onSend: (text: string) => Promise<boolean>; onHandOff: () => void }) {
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
      <div className="act-buttons">
        <button onClick={send} disabled={busy || !text.trim()}>
          Send
        </button>
        {hasParty && (
          <button onClick={onHandOff} disabled={busy} title="Hold back and let a companion take the lead this beat">
            Let the party act
          </button>
        )}
      </div>
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

function busyText(game: GameView): string {
  if (game.mode === 'over') return 'The party makes camp…';
  if (game.mode === 'camp') return game.journal ? 'The night goes on, and the DM plans the morning…' : 'The night goes on…';
  return game.party.length > 1 ? 'The party and the DM are thinking…' : 'The DM is thinking…';
}

/** Start a new campaign from an idea and a tone, as your own character or as Steven, or let the DM surprise you. */
function NewCampaign({ busy, tones, classes, onStart }: { busy: boolean; tones: string[]; classes: string[]; onStart: (premise: string, tone: string, character?: NewCharacter) => void }) {
  const [premise, setPremise] = useState('');
  const [tone, setTone] = useState('heroic');
  const [own, setOwn] = useState(false);
  const [pc, setPc] = useState<NewCharacter>({ name: '', classId: 'fighter', pronouns: 'they/them', background: '' });
  const ready = !own || !!pc.name.trim();
  const start = (p: string) => onStart(p, tone, own ? pc : undefined);
  return (
    <div className="new-campaign">
      <h2>New campaign</h2>
      <textarea
        value={premise}
        maxLength={500}
        rows={3}
        placeholder="What's it about? e.g. smugglers in a canal city, a haunted salt mine, a missing heir"
        onChange={(e) => setPremise(e.target.value)}
      />
      <div className="tones">
        {tones.map((t) => (
          <button key={t} className={t === tone ? 'chosen' : ''} disabled={busy} onClick={() => setTone(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="tones">
        <button className={own ? '' : 'chosen'} disabled={busy} onClick={() => setOwn(false)}>
          Play as Steven
        </button>
        <button className={own ? 'chosen' : ''} disabled={busy} onClick={() => setOwn(true)}>
          Make my own character
        </button>
      </div>
      {own && (
        <div className="creator">
          <div className="creator-row">
            <input value={pc.name} maxLength={40} placeholder="Name" disabled={busy} onChange={(e) => setPc({ ...pc, name: e.target.value })} />
            <input value={pc.pronouns} maxLength={20} placeholder="Pronouns" disabled={busy} onChange={(e) => setPc({ ...pc, pronouns: e.target.value })} />
          </div>
          <div className="tones">
            {classes.map((c) => (
              <button key={c} className={c === pc.classId ? 'chosen' : ''} disabled={busy} onClick={() => setPc({ ...pc, classId: c })}>
                {c}
              </button>
            ))}
          </div>
          <textarea
            value={pc.background}
            maxLength={300}
            rows={2}
            placeholder="A line or two of background (optional). The DM weaves it into the campaign."
            onChange={(e) => setPc({ ...pc, background: e.target.value })}
          />
        </div>
      )}
      <div className="act-buttons">
        <button disabled={busy || !premise.trim() || !ready} onClick={() => start(premise)}>
          Plan this campaign
        </button>
        <button disabled={busy || !ready} onClick={() => start('')}>
          Surprise me
        </button>
      </div>
    </div>
  );
}

/** The campaign journal: the act, the quests, and how the factions you've met feel about you. */
function Journal({ journal }: { journal: NonNullable<GameView['journal']> }) {
  const active = journal.quests.filter((q) => q.status === 'active');
  const closed = journal.quests.filter((q) => q.status !== 'active');
  return (
    <div className="campaign-journal">
      <h2>Journal</h2>
      <details>
        <summary>{journal.region.name}</summary>
        <p>{journal.premise}</p>
        {journal.region.description && <p>{journal.region.description}</p>}
      </details>
      <p className="act-line">
        <strong>
          Act {journal.act.n} of {journal.act.total}: {journal.act.title}
        </strong>
        <span>{journal.act.goal}</span>
      </p>
      <h3>Quests</h3>
      {active.length === 0 && <p className="muted">No open quests.</p>}
      <ul className="quests">
        {active.map((q) => (
          <li key={q.id}>
            <strong>{q.title}</strong>
            <span>{q.goal}</span>
            {q.notes.length > 0 && <small>{q.notes[q.notes.length - 1]}</small>}
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <details>
          <summary>Finished ({closed.length})</summary>
          <ul className="quests closed">
            {closed.map((q) => (
              <li key={q.id} className={q.status}>
                <strong>{q.title}</strong> <span>{q.status === 'done' ? 'done' : 'failed'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {journal.factions.length > 0 && (
        <>
          <h3>Factions</h3>
          <ul className="factions">
            {journal.factions.map((f) => (
              <li key={f.id} title={f.description}>
                <span>{f.name}</span> <b className={`attitude ${f.attitude}`}>{f.attitude}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** An earlier scene: its summary, with the full story a click away. */
function PastChapter({ n, chapter, thoughts }: { n: number; chapter: GameView['chapters'][number]; thoughts: boolean }) {
  return (
    <details className="past-chapter">
      <summary>
        <strong>
          Chapter {n}: {chapter.title}
        </strong>
        <span>{chapter.summary || chapter.outcome}</span>
      </summary>
      <div className="transcript">
        {chapter.transcript.map((e, i) => (
          <EntryBody key={i} e={e} showPrompt={false} thoughts={thoughts} />
        ))}
      </div>
    </details>
  );
}

/** At camp: talk privately with a companion, or break camp and move on. */
function CampBox({
  view,
  busy,
  onSay,
  onBreak,
  onBoost,
}: {
  view: GameView;
  busy: boolean;
  onSay: (text: string, to: string) => Promise<boolean>;
  onBreak: () => void;
  onBoost: (boosts: Partial<Record<AbilityKey, number>>) => void;
}) {
  const ids = view.camp?.companions ?? [];
  const [to, setTo] = useState(view.camp?.approacher ?? ids[0] ?? '');
  const [text, setText] = useState('');
  const nameOf = (id: string) => view.party.find((m) => m.character.id === id)?.character.name.split(' ')[0] ?? id;
  const send = async () => {
    if (!text.trim() || busy || !to) return;
    if (await onSay(text, to)) setText('');
  };
  return (
    <div className="act camp-box">
      {view.levelUp && <LevelUp level={view.levelUp.level} abilities={view.levelUp.abilities} busy={busy} onBoost={onBoost} />}
      {ids.length > 0 && (
        <>
          <div className="talk-to">
            Talk privately with:
            {ids.map((id) => (
              <button key={id} className={id === to ? 'chosen' : ''} disabled={busy} onClick={() => setTo(id)}>
                {nameOf(id)}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            placeholder={`What do you say to ${nameOf(to)}? (Enter to send)`}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </>
      )}
      <div className="act-buttons">
        {ids.length > 0 && (
          <button onClick={send} disabled={busy || !text.trim()}>
            Say it
          </button>
        )}
        <button onClick={onBreak} disabled={busy} title="Sleep, then set out in the morning">
          {view.nextTitle ? `Break camp: on to ${view.nextTitle}` : 'Break camp at dawn'}
        </button>
      </div>
    </div>
  );
}

/** An ability score increase: +2 to one ability, or +1 to two. */
function LevelUp({ level, abilities, busy, onBoost }: { level: number; abilities: Record<AbilityKey, number>; busy: boolean; onBoost: (boosts: Partial<Record<AbilityKey, number>>) => void }) {
  const [picks, setPicks] = useState<Partial<Record<AbilityKey, number>>>({});
  const spent = Object.values(picks).reduce((a, b) => a + (b ?? 0), 0);
  const add = (k: AbilityKey) => {
    const n = picks[k] ?? 0;
    if (spent >= 2 || abilities[k] + n >= 20) return;
    setPicks({ ...picks, [k]: n + 1 });
  };
  return (
    <div className="level-up">
      <strong>Level {level}! Raise your abilities: +2 to one, or +1 to two.</strong>
      <div className="abilities">
        {(Object.keys(ABILITY_NAMES) as AbilityKey[]).map((k) => (
          <button key={k} className={picks[k] ? 'chosen' : ''} disabled={busy || (!picks[k] && (spent >= 2 || abilities[k] >= 20))} onClick={() => add(k)}>
            {ABILITY_NAMES[k]} {abilities[k] + (picks[k] ?? 0)}
            {picks[k] ? ` (+${picks[k]})` : ''}
          </button>
        ))}
      </div>
      <div className="act-buttons">
        <button disabled={busy || spent !== 2} onClick={() => onBoost(picks)}>
          Confirm
        </button>
        <button disabled={busy || spent === 0} onClick={() => setPicks({})}>
          Reset
        </button>
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
