import { describe, it, expect } from 'vitest';
import { diffVariables, diffStringMap } from './variables-diff';

describe('diffStringMap', () => {
  it('classifies kinds correctly', () => {
    const out = diffStringMap(
      { a: '1', b: '2', c: '3' },
      { a: '1', b: '20', d: '4' },
      new Set(),
    );
    const byKey = Object.fromEntries(out.map((e) => [e.key, e.kind]));
    expect(byKey.a).toBe('unchanged');
    expect(byKey.b).toBe('changed');
    expect(byKey.c).toBe('removed');
    expect(byKey.d).toBe('added');
  });

  it('respects ignore list', () => {
    const out = diffStringMap({ a: '1' }, { a: '2' }, new Set(['a']));
    expect(out).toHaveLength(0);
  });
});

describe('diffVariables', () => {
  it('counts new console errors as added', () => {
    const r = diffVariables({
      baseline: { consoleErrors: ['old-error'] },
      current: { consoleErrors: ['old-error', 'new-error'] },
    });
    expect(r.consoleErrors.added).toEqual(['new-error']);
    expect(r.consoleErrors.common).toBe(1);
    expect(r.consoleErrors.removed).toEqual([]);
  });

  it('counts log additions ignoring timestamp drift', () => {
    const r = diffVariables({
      baseline: { logs: [{ timestamp: 1, level: 'info', message: 'hi' }] },
      current: {
        logs: [
          { timestamp: 99, level: 'info', message: 'hi' },
          { timestamp: 100, level: 'warn', message: 'new warning' },
        ],
      },
    });
    expect(r.logs.addedCount).toBe(1);
    expect(r.logs.removedCount).toBe(0);
    expect(r.logs.sample[0]).toContain('new warning');
  });
});
