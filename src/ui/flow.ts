import { useEffect, useReducer, useRef } from 'react';

/**
 * How many characters of streamed text to show after `dt` seconds: a steady reading pace that speeds
 * up as the backlog grows, so the text flows evenly whatever size the pieces arrive in.
 */
export function typeStep(shown: number, total: number, dt: number): number {
  if (shown >= total) return total;
  const perSecond = 55 + (total - shown) * 2.5;
  return Math.min(total, shown + perSecond * dt);
}

/** Types `target` out smoothly as it grows. Returns the text so far and whether it has caught up. */
export function useTypewriter(target: string, instant: boolean): { text: string; caughtUp: boolean } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const r = useRef({ text: '', length: 0 });
  const s = r.current;
  // A different text (a new narration, or the model starting over) types from the beginning.
  if (!target.startsWith(s.text.slice(0, Math.floor(s.length)))) s.length = 0;
  s.text = target;
  if (instant) s.length = target.length;

  useEffect(() => {
    if (s.length >= target.length) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      s.length = typeStep(s.length, s.text.length, (now - last) / 1000);
      last = now;
      rerender();
      if (s.length < s.text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, instant, s]);

  const n = Math.floor(Math.min(s.length, target.length));
  return { text: target.slice(0, n), caughtUp: n >= target.length };
}

/**
 * Keeps the newest part of the story in view as it grows, unless the player has scrolled up to read
 * something earlier; scrolling back to the bottom picks it up again.
 */
export function useFollowStory(): { follow: () => void } {
  const following = useRef(true);
  const quietUntil = useRef(0);
  useEffect(() => {
    const bottom = () => document.documentElement.scrollHeight - innerHeight;
    const onScroll = () => {
      // Our own smooth scrolls pass through the middle of the page; only the player's scrolling counts.
      if (performance.now() < quietUntil.current) return;
      following.current = scrollY >= bottom() - 160;
    };
    const grew = () => {
      if (!following.current) return;
      const gap = bottom() - scrollY;
      if (gap <= 1) return;
      if (gap > 160) {
        quietUntil.current = performance.now() + 700;
        scrollTo({ top: bottom(), behavior: 'smooth' });
      } else {
        scrollTo({ top: bottom(), behavior: 'instant' });
      }
    };
    const observer = new ResizeObserver(grew);
    observer.observe(document.body);
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      removeEventListener('scroll', onScroll);
    };
  }, []);
  return { follow: () => (following.current = true) };
}
