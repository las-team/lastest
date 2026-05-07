import { describe, it, expect } from 'vitest';
import { diffVisibleText } from './text-content-diff';
import type { DomSnapshotData } from '../db/schema';

const snapshot = (texts: string[]): DomSnapshotData => ({
  url: 'https://example.com',
  timestamp: 0,
  elements: texts.map((textContent, i) => ({
    tag: 'span',
    textContent,
    boundingBox: { x: 0, y: i * 20, width: 100, height: 20 },
    selectors: [{ type: 'css', value: `span:nth-child(${i + 1})` }],
  })),
});

describe('diffVisibleText', () => {
  it('returns no diffs when text is identical', () => {
    const a = snapshot(['hello', 'world']);
    const b = snapshot(['hello', 'world']);
    const r = diffVisibleText(a, b);
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it('detects added and removed lines', () => {
    const r = diffVisibleText(snapshot(['a', 'b']), snapshot(['a', 'c']));
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
  });

  it('handles missing snapshots gracefully', () => {
    const r = diffVisibleText(null, snapshot(['x']));
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
    expect(r.baselineLength).toBe(0);
    expect(r.currentLength).toBe(1);
  });

  it('applies ignore patterns', () => {
    const r = diffVisibleText(
      snapshot(['hello at 12:34']),
      snapshot(['hello at 99:99']),
      { ignorePatterns: ['\\d{1,2}:\\d{2}'] },
    );
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it('collapses whitespace before diffing', () => {
    const r = diffVisibleText(snapshot(['foo  bar']), snapshot(['foo bar']));
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });
});
