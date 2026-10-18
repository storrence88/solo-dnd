import { describe, expect, it } from 'vitest';
import { typeStep } from './flow';

describe('typing streamed text', () => {
  it('reads at a steady pace and catches up faster when far behind', () => {
    expect(typeStep(0, 10, 0.1)).toBeCloseTo(8, 0);
    const near = typeStep(0, 20, 0.1);
    const far = typeStep(0, 400, 0.1);
    expect(far - 0).toBeGreaterThan(near * 5);
    expect(typeStep(5, 6, 1)).toBe(6);
    expect(typeStep(6, 6, 1)).toBe(6);
  });
});
