import { describe, it, expect } from 'vitest';
import { normalizePageText } from './page-text-diff';

describe('normalizePageText', () => {
  it('collapses runs of blank lines to a single blank', () => {
    const input = 'first\n\n\n\nsecond\n\n\nthird';
    expect(normalizePageText(input)).toBe('first\n\nsecond\n\nthird');
  });

  it('trims trailing whitespace per line', () => {
    const input = 'foo   \nbar\t\nbaz';
    expect(normalizePageText(input)).toBe('foo\nbar\nbaz');
  });

  it('trims leading and trailing newlines', () => {
    const input = '\n\n\nhello\n\n\n';
    expect(normalizePageText(input)).toBe('hello');
  });

  it('preserves single blank separators inside content', () => {
    const input = 'a\n\nb';
    expect(normalizePageText(input)).toBe('a\n\nb');
  });

  it('handles empty input', () => {
    expect(normalizePageText('')).toBe('');
  });
});
