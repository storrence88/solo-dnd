import { describe, expect, it } from 'vitest';
import { narrationSoFar } from './dmReply';

describe('narration as it streams in', () => {
  it('shows the narration field so far, decoding escapes and holding back a half-received one', () => {
    expect(narrationSoFar('')).toBe('');
    expect(narrationSoFar('{"narr')).toBe('');
    expect(narrationSoFar('{"narration": "The ri')).toBe('The ri');
    expect(narrationSoFar('{"narration":"He says \\"run')).toBe('He says "run');
    expect(narrationSoFar('{"narration":"Line one.\\nLine two\\')).toBe('Line one.\nLine two');
    expect(narrationSoFar('{"narration":"caf\\u00e9 and \\u00')).toBe('café and ');
    expect(narrationSoFar('{"narration":"Done.","action":{"type":"none"}}')).toBe('Done.');
    expect(narrationSoFar('{"summary":"Not a narration."}')).toBe('');
  });
});
