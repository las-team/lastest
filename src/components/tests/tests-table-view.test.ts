import { describe, it, expect } from 'vitest';
import {
  compareTests,
  defaultVisibleColumns,
  parseStoredColumns,
  serializeColumns,
  parseStoredSort,
  serializeSort,
  type TestWithStatus,
  type TestsTableColumnKey,
  type TestsTableSort,
} from './tests-table-view';

const baseTest = (overrides: Partial<TestWithStatus> = {}): TestWithStatus =>
  ({
    id: 't1',
    name: 'Test',
    code: '',
    description: null,
    functionalAreaId: null,
    repositoryId: null,
    isPlaceholder: false,
    quarantined: false,
    targetUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    latestStatus: null,
    lastRunAt: null,
    ...overrides,
  }) as unknown as TestWithStatus;

const noArea = (_id: string | null) => null;

describe('compareTests', () => {
  it('sorts names case-insensitively asc', () => {
    const a = baseTest({ id: 'a', name: 'banana' });
    const b = baseTest({ id: 'b', name: 'Apple' });
    const sorted = [a, b].sort((x, y) => compareTests(x, y, 'name', 'asc', noArea));
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('sorts names desc', () => {
    const a = baseTest({ id: 'a', name: 'banana' });
    const b = baseTest({ id: 'b', name: 'apple' });
    const sorted = [a, b].sort((x, y) => compareTests(x, y, 'name', 'desc', noArea));
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('puts null lastRunAt last regardless of direction', () => {
    const ran = baseTest({ id: 'r', lastRunAt: new Date('2026-04-01T00:00:00Z') });
    const never = baseTest({ id: 'n', lastRunAt: null });
    const asc = [never, ran].sort((x, y) => compareTests(x, y, 'lastRun', 'asc', noArea));
    const desc = [ran, never].sort((x, y) => compareTests(x, y, 'lastRun', 'desc', noArea));
    expect(asc[asc.length - 1].id).toBe('n');
    expect(desc[desc.length - 1].id).toBe('n');
  });

  it('sorts lastRun desc by recency', () => {
    const old = baseTest({ id: 'old', lastRunAt: new Date('2026-01-01T00:00:00Z') });
    const recent = baseTest({ id: 'recent', lastRunAt: new Date('2026-04-01T00:00:00Z') });
    const sorted = [old, recent].sort((x, y) => compareTests(x, y, 'lastRun', 'desc', noArea));
    expect(sorted.map((t) => t.id)).toEqual(['recent', 'old']);
  });

  it('uses getAreaName for the area key', () => {
    const t1 = baseTest({ id: '1', functionalAreaId: 'a-id' });
    const t2 = baseTest({ id: '2', functionalAreaId: 'b-id' });
    const lookup = (id: string | null) => (id === 'a-id' ? 'Zebra' : id === 'b-id' ? 'Alpha' : null);
    const sorted = [t1, t2].sort((x, y) => compareTests(x, y, 'area', 'asc', lookup));
    expect(sorted.map((t) => t.id)).toEqual(['2', '1']);
  });

  it('null status sorts last', () => {
    const passed = baseTest({ id: 'p', latestStatus: 'passed' });
    const none = baseTest({ id: 'n', latestStatus: null });
    const sorted = [none, passed].sort((x, y) => compareTests(x, y, 'status', 'asc', noArea));
    expect(sorted[sorted.length - 1].id).toBe('n');
  });
});

describe('defaultVisibleColumns', () => {
  it('includes area when not scoped', () => {
    expect(defaultVisibleColumns(false).has('area')).toBe(true);
  });
  it('drops area when scoped to an area', () => {
    expect(defaultVisibleColumns(true).has('area')).toBe(false);
  });
  it('always includes status, lastRun, lastModified', () => {
    const cols = defaultVisibleColumns(true);
    expect(cols.has('status')).toBe(true);
    expect(cols.has('lastRun')).toBe(true);
    expect(cols.has('lastModified')).toBe(true);
  });
});

describe('parseStoredColumns', () => {
  it('returns null on null input', () => {
    expect(parseStoredColumns(null)).toBeNull();
  });
  it('returns null on bad json', () => {
    expect(parseStoredColumns('{not json')).toBeNull();
  });
  it('returns null on version mismatch', () => {
    expect(parseStoredColumns(JSON.stringify({ v: 99, cols: ['status'] }))).toBeNull();
  });
  it('returns Set on valid input', () => {
    const cols = parseStoredColumns(JSON.stringify({ v: 1, cols: ['status', 'area'] }));
    expect(cols).toBeInstanceOf(Set);
    expect(cols!.has('status')).toBe(true);
    expect(cols!.has('area')).toBe(true);
  });
  it('filters unknown keys', () => {
    const cols = parseStoredColumns(JSON.stringify({ v: 1, cols: ['status', 'bogus'] }));
    expect(cols!.has('status')).toBe(true);
    expect(cols!.has('bogus' as TestsTableColumnKey)).toBe(false);
  });
  it('round-trips via serializeColumns', () => {
    const cols = new Set<TestsTableColumnKey>(['status', 'lastRun']);
    const restored = parseStoredColumns(serializeColumns(cols));
    expect(restored).toEqual(cols);
  });
});

describe('parseStoredSort', () => {
  it('returns null on bad input', () => {
    expect(parseStoredSort(null)).toBeNull();
    expect(parseStoredSort('garbage')).toBeNull();
    expect(parseStoredSort(JSON.stringify({ v: 1, key: 'name' }))).toBeNull();
    expect(parseStoredSort(JSON.stringify({ v: 1, key: 'invalid', dir: 'asc' }))).toBeNull();
  });
  it('round-trips a valid sort', () => {
    const sort: TestsTableSort = { key: 'lastRun', dir: 'desc' };
    expect(parseStoredSort(serializeSort(sort))).toEqual(sort);
  });
});
