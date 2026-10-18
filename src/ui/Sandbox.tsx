import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { describeEvent, SCENARIOS, takeTurn, type Combatant, type Encounter } from '../engine';

/** Phase 1 sandbox: watch the rules engine run a fight turn by turn, with no AI involved. */
export function Sandbox() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [seed, setSeed] = useState(1);
  const encRef = useRef<Encounter | null>(null);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const reset = (id = scenarioId, s = seed) => {
    encRef.current = startFight(id, s);
    rerender();
  };
  encRef.current ??= startFight(scenarioId, seed);
  const enc = encRef.current;

  const step = () => {
    if (!enc.isOver()) takeTurn(enc);
    rerender();
  };
  const runAll = () => {
    while (!enc.isOver() && enc.round <= 50) takeTurn(enc);
    rerender();
  };

  const nameOf = (id: string) => enc.get(id).name;
  const lines = enc.events.map((e) => ({ kind: e.type, text: describeEvent(e, nameOf) }));
  const currentId = enc.isOver() ? null : enc.current().id;
  const order = enc.initiativeOrder;
  const sides = (['party', 'enemy'] as const).map((side) => ({
    side,
    members: order.map((id) => enc.get(id)).filter((c) => c.side === side),
  }));

  return (
    <>
      <header>
        <h1>Rules sandbox</h1>
        <p className="sub">Every roll here comes from the rules engine. No AI is involved yet.</p>
      </header>

      <section className="controls">
        <label>
          Fight
          <select
            value={scenarioId}
            onChange={(e) => {
              setScenarioId(e.target.value);
              reset(e.target.value, seed);
            }}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => {
              const s = Number(e.target.value) || 0;
              setSeed(s);
              reset(scenarioId, s);
            }}
          />
        </label>
        <div className="buttons">
          <button onClick={step} disabled={enc.isOver()}>
            Next turn
          </button>
          <button onClick={runAll} disabled={enc.isOver()}>
            Run to the end
          </button>
          <button onClick={() => reset()}>Restart</button>
        </div>
        <p className="state">
          {enc.isOver() ? `Over: the ${enc.winner} wins in round ${enc.round}.` : `Round ${enc.round}: ${enc.current().name} is up.`}
        </p>
      </section>

      <section className="board">
        {sides.map(({ side, members }) => (
          <div key={side} className="side">
            <h2>{side === 'party' ? 'Party' : 'Enemies'}</h2>
            {members.map((c) => (
              <Card key={c.id} c={c} active={c.id === currentId} />
            ))}
          </div>
        ))}
      </section>

      <section className="log">
        <h2>Event log</h2>
        <ol>
          {lines.map((l, i) => (
            <li key={i} className={l.kind}>
              {l.text}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function startFight(scenarioId: string, seed: number): Encounter {
  const enc = SCENARIOS.find((x) => x.id === scenarioId)!.build(seed);
  enc.start();
  return enc;
}

export function Card({ c, active, animated = false }: { c: Combatant; active: boolean; animated?: boolean }) {
  const pct = Math.round((c.hp / c.maxHp) * 100);
  const slots = c.spellcasting?.slots.slice(1).map((n, i) => `L${i + 1}: ${n}/${c.spellcasting!.maxSlots[i + 1]}`);
  // Each change in hit points floats off the card: red for damage, green for healing.
  const last = useRef(c.hp);
  const [changes, setChanges] = useState<{ id: number; amount: number }[]>([]);
  const shake = useAnimationControls();
  useEffect(() => {
    const amount = c.hp - last.current;
    last.current = c.hp;
    if (!amount || !animated) return;
    const id = Date.now() + Math.random();
    setChanges((cs) => [...cs, { id, amount }]);
    if (amount < 0) void shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.4 } });
    const timer = setTimeout(() => setChanges((cs) => cs.filter((x) => x.id !== id)), 1400);
    return () => clearTimeout(timer);
  }, [c.hp, animated, shake]);
  return (
    <motion.div animate={shake} className={`card ${c.status} ${active ? 'active' : ''}`}>
      <div className="row">
        <strong>{c.name}</strong>
        <span className="meta">
          AC {c.ac}
          {c.level ? ` · ${c.classId} ${c.level}` : ''}
        </span>
      </div>
      <div className="hp">
        <motion.div className="bar" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: animated ? 0.6 : 0, ease: 'easeOut' }} />
        <span>
          {c.hp} / {c.maxHp} HP
        </span>
        <AnimatePresence>
          {changes.map((x) => (
            <motion.b
              key={x.id}
              className={`hp-change ${x.amount < 0 ? 'down' : 'up'}`}
              initial={{ opacity: 0, y: 4, scale: 0.8 }}
              animate={{ opacity: 1, y: -22, scale: 1.15 }}
              exit={{ opacity: 0, y: -34 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              {x.amount > 0 ? `+${x.amount}` : x.amount}
            </motion.b>
          ))}
        </AnimatePresence>
      </div>
      <div className="meta">
        {c.status !== 'ok' && <span className="tag">{c.status}</span>}
        {c.conditions.map((x) => (
          <span key={x} className="tag">
            {x}
          </span>
        ))}
        {c.status === 'unconscious' && (
          <span className="tag">
            saves {c.deathSaves.successes}✓ {c.deathSaves.failures}✗
          </span>
        )}
        {slots && <span>Slots {slots.join(', ')}</span>}
      </div>
    </motion.div>
  );
}
