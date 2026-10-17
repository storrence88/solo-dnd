import { useRef, useState } from 'react';
import { describeEvent, SCENARIOS, takeTurn, type Combatant, type Encounter } from '../engine';

/** Phase 1 sandbox: watch the rules engine run a fight turn by turn, with no AI involved. */
export function App() {
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
    <main>
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
    </main>
  );
}

function startFight(scenarioId: string, seed: number): Encounter {
  const enc = SCENARIOS.find((x) => x.id === scenarioId)!.build(seed);
  enc.start();
  return enc;
}

function Card({ c, active }: { c: Combatant; active: boolean }) {
  const pct = Math.round((c.hp / c.maxHp) * 100);
  const slots = c.spellcasting?.slots.slice(1).map((n, i) => `L${i + 1}: ${n}/${c.spellcasting!.maxSlots[i + 1]}`);
  return (
    <div className={`card ${c.status} ${active ? 'active' : ''}`}>
      <div className="row">
        <strong>{c.name}</strong>
        <span className="meta">
          AC {c.ac}
          {c.level ? ` · ${c.classId} ${c.level}` : ''}
        </span>
      </div>
      <div className="hp">
        <div className="bar" style={{ width: `${pct}%` }} />
        <span>
          {c.hp} / {c.maxHp} HP
        </span>
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
    </div>
  );
}
