/** Source of die results. Every random number in the engine comes through here, so a game is reproducible from its seed. */
export interface Rng {
  /** Returns an integer from 1 to `sides`, inclusive. */
  roll(sides: number): number;
}

/** Deterministic RNG (mulberry32). The same seed always gives the same rolls. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    roll(sides) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(unit * sides) + 1;
    },
  };
}

/** Returns the given die results in order. For tests: script exactly what the dice show. */
export function scriptedRng(results: number[]): Rng {
  const queue = [...results];
  return {
    roll(sides) {
      const next = queue.shift();
      if (next === undefined) throw new Error(`scriptedRng ran out of results (wanted a d${sides})`);
      if (next < 1 || next > sides) throw new Error(`scriptedRng result ${next} is not possible on a d${sides}`);
      return next;
    },
  };
}
