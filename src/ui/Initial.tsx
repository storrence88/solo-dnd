/** Splits a passage into what comes before its first letter (an opening quote, say), that letter, and the rest. */
export function splitInitial(text: string): { lead: string; letter: string; rest: string } | null {
  const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}])([\s\S]*)$/u.exec(text);
  if (!m) return null;
  return { lead: m[1]!, letter: m[2]!, rest: m[3]! };
}

/** Vines that curl in from the corners, with leaves and small flowers, drawn behind the letter. */
function Vines() {
  const leaf = (x: number, y: number, turn: number) => (
    <path d="M0 0 C3 -4 9 -4 12 0 C9 4 3 4 0 0 Z" transform={`translate(${x} ${y}) rotate(${turn})`} />
  );
  const flower = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-3.2" rx="2.1" ry="3.2" transform={`rotate(${a})`} className="petal" />
      ))}
      <circle r="1.6" className="heart" />
    </g>
  );
  const corner = (
    <g>
      <path className="stem" d="M8 8 C20 10 26 18 22 28 C19 35 10 33 12 26 C13 22 18 22 18 26" />
      <path className="stem" d="M8 8 C10 20 18 26 28 22 C35 19 33 10 26 12" />
      <g className="leaf">
        {leaf(17, 11, -10)}
        {leaf(11, 17, 100)}
        {leaf(26, 30, 60)}
        {leaf(30, 26, 30)}
      </g>
      {flower(24, 18)}
    </g>
  );
  return (
    <svg className="initial-art" viewBox="0 0 100 100" aria-hidden>
      <rect className="field" x="0" y="0" width="100" height="100" />
      <g>{corner}</g>
      <g transform="translate(100 0) scale(-1 1)">{corner}</g>
      <g transform="translate(0 100) scale(1 -1)">{corner}</g>
      <g transform="translate(100 100) scale(-1 -1)">{corner}</g>
      <rect className="frame" x="2.5" y="2.5" width="95" height="95" />
      <rect className="frame thin" x="6" y="6" width="88" height="88" />
    </svg>
  );
}

/**
 * A passage that opens with an illuminated initial: its first letter set large in red blackletter
 * on a dark green tile, framed in gold and wound with vines, as in an old manuscript.
 */
export function Illuminated({ text, children }: { text: string; children?: React.ReactNode }) {
  const parts = splitInitial(text);
  if (!parts) return <p>{text}{children}</p>;
  return (
    <p className="illuminated">
      {parts.lead && <span className="initial-lead">{parts.lead}</span>}
      <span className="initial" aria-hidden>
        <Vines />
        <span className="initial-letter">{parts.letter}</span>
      </span>
      <span className="sr-only">{parts.letter}</span>
      {parts.rest}
      {children}
    </p>
  );
}
