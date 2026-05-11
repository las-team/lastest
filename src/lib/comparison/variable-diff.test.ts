import { describe, it, expect } from 'vitest';
import { computeVariableDiff, summarizeVariableDiff } from './variable-diff';

describe('computeVariableDiff', () => {
  it('returns empty diff for identical maps', () => {
    const m = { user: 'alice', count: 3 };
    const d = computeVariableDiff(m, m);
    expect(d.changes).toHaveLength(0);
  });

  it('flags structural break when key added', () => {
    const baseline = { a: 1 };
    const current = { a: 1, b: 2 };
    const d = computeVariableDiff(baseline, current);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0].tier).toBe('structural-break');
    expect(d.changes[0].path).toBe('b');
  });

  it('flags structural break when key removed', () => {
    const baseline = { a: 1, b: 2 };
    const current = { a: 1 };
    const d = computeVariableDiff(baseline, current);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0].tier).toBe('structural-break');
    expect(d.changes[0].baseline).toBe(2);
  });

  it('flags type-change for type mismatches', () => {
    const baseline = { x: '5' };
    const current = { x: 5 };
    const d = computeVariableDiff(baseline, current);
    expect(d.changes[0].tier).toBe('type-change');
  });

  it('classifies numeric vs string changes', () => {
    const baseline = { count: 1, name: 'alice' };
    const current = { count: 2, name: 'bob' };
    const d = computeVariableDiff(baseline, current);
    const numeric = d.changes.find(c => c.path === 'count');
    const str = d.changes.find(c => c.path === 'name');
    expect(numeric?.tier).toBe('value-change-numeric');
    expect(str?.tier).toBe('value-change-string');
  });

  it('sorts structural changes before value changes', () => {
    const baseline = { keep: 'old' };
    const current = { keep: 'new', added: 'x' };
    const d = computeVariableDiff(baseline, current);
    expect(d.changes[0].tier).toBe('structural-break');
    expect(d.changes[1].tier).toBe('value-change-string');
  });

  it('respects ignorePaths globs', () => {
    const baseline = { user: { id: '1', name: 'alice' } };
    const current = { user: { id: '2', name: 'alice' } };
    const d = computeVariableDiff(baseline, current, { ignorePaths: ['user.id'] });
    expect(d.changes).toHaveLength(0);
  });

  it('supports ** wildcard for any depth', () => {
    const baseline = { a: { b: { ts: 1 } }, c: { ts: 2 } };
    const current = { a: { b: { ts: 9 } }, c: { ts: 99 } };
    const d = computeVariableDiff(baseline, current, { ignorePaths: ['**.ts'] });
    expect(d.changes).toHaveLength(0);
  });

  it('recurses into arrays', () => {
    const baseline = { items: [1, 2, 3] };
    const current = { items: [1, 9, 3] };
    const d = computeVariableDiff(baseline, current);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0].path).toBe('items[1]');
  });
});

describe('summarizeVariableDiff', () => {
  it('reports tier counts', () => {
    const baseline = { a: 1 };
    const current = { a: 2, b: 'new' };
    const d = computeVariableDiff(baseline, current);
    expect(summarizeVariableDiff(d)).toContain('1 structural');
    expect(summarizeVariableDiff(d)).toContain('1 numeric');
  });
});
