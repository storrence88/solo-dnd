import { describe, expect, it } from 'vitest';
import { splitInitial } from './Initial';

describe('splitInitial', () => {
  it('takes the first letter for the illuminated initial', () => {
    expect(splitInitial('Silence falls.')).toEqual({ lead: '', letter: 'S', rest: 'ilence falls.' });
  });
  it('keeps an opening quote apart from the letter', () => {
    expect(splitInitial('“Halt!” cries the guard.')).toEqual({ lead: '“', letter: 'H', rest: 'alt!” cries the guard.' });
  });
  it('leaves passages with no letter alone', () => {
    expect(splitInitial('')).toBeNull();
    expect(splitInitial('…')).toBeNull();
  });
});
