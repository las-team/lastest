import { describe, it, expect } from 'vitest';
import { resolveVarReferences, pickRowForVariable, pickRowsForVariables, resolveAssignedValues } from './resolver';
import type { TestVariable, GoogleSheetsDataSource, CsvDataSource } from '@/lib/db/schema';

const csvSource: CsvDataSource = {
  id: 'csv-1',
  repositoryId: 'r1',
  teamId: 't1',
  alias: 'users',
  filename: 'users.csv',
  storagePath: null,
  cachedHeaders: ['email', 'name'],
  cachedData: [['alice@x.test', 'Alice'], ['bob@x.test', 'Bob']],
  rowCount: 2,
  lastSyncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sheetSource: GoogleSheetsDataSource = {
  id: 'gs-1',
  repositoryId: 'r1',
  teamId: 't1',
  googleSheetsAccountId: 'a1',
  spreadsheetId: 'sid',
  spreadsheetName: 'Sheet1',
  sheetName: 'Sheet1',
  sheetGid: null,
  alias: 'orders',
  headerRow: 1,
  dataRange: null,
  cachedHeaders: ['order_id'],
  cachedData: [['ord-001']],
  lastSyncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('resolveVarReferences', () => {
  it('resolves a static var', () => {
    const variables: TestVariable[] = [
      { id: 'v1', name: 'token', mode: 'assign', sourceType: 'static', staticValue: 'abc' },
    ];
    const r = resolveVarReferences("await fill('{{var:token}}')", variables, [], []);
    expect(r.resolvedCode).toBe("await fill('abc')");
    expect(r.errors).toEqual([]);
  });

  it('resolves a CSV-backed assign var', () => {
    const variables: TestVariable[] = [
      { id: 'v2', name: 'email', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRow: 1 },
    ];
    const r = resolveVarReferences('{{var:email}}', variables, [], [csvSource]);
    expect(r.resolvedCode).toBe('bob@x.test');
  });

  it('resolves a gsheet-backed assign var', () => {
    const variables: TestVariable[] = [
      { id: 'v3', name: 'oid', mode: 'assign', sourceType: 'gsheet', sourceAlias: 'orders', sourceColumn: 'order_id', sourceRow: 0 },
    ];
    const r = resolveVarReferences('{{var:oid}}', variables, [sheetSource], []);
    expect(r.resolvedCode).toBe('ord-001');
  });

  it('errors on undefined name', () => {
    const r = resolveVarReferences('{{var:nope}}', [], [], []);
    expect(r.errors).toHaveLength(1);
    expect(r.resolvedCode).toBe('{{var:nope}}');
  });

  it('errors when extract-mode vars are referenced in code', () => {
    const variables: TestVariable[] = [
      { id: 'v4', name: 'welcome', mode: 'extract', targetSelector: 'h1' },
    ];
    const r = resolveVarReferences('{{var:welcome}}', variables, [], []);
    expect(r.errors).toHaveLength(1);
  });

  it('replaces all occurrences of the same var', () => {
    const variables: TestVariable[] = [
      { id: 'v5', name: 'pw', mode: 'assign', sourceType: 'static', staticValue: 'secret' },
    ];
    const r = resolveVarReferences('{{var:pw}}-{{var:pw}}', variables, [], []);
    expect(r.resolvedCode).toBe('secret-secret');
  });

  it('uses rowOverrides for csv-backed vars when supplied', () => {
    const variables: TestVariable[] = [
      { id: 'v6', name: 'email', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRowMode: 'random' },
    ];
    const r = resolveVarReferences('{{var:email}}', variables, [], [csvSource], { v6: 0 });
    expect(r.resolvedCode).toBe('alice@x.test');
  });

  it('all occurrences agree on the same row from rowOverrides (per-run)', () => {
    const variables: TestVariable[] = [
      { id: 'v7', name: 'email', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRowMode: 'increment' },
    ];
    const r = resolveVarReferences('{{var:email}}-{{var:email}}', variables, [], [csvSource], { v7: 1 });
    expect(r.resolvedCode).toBe('bob@x.test-bob@x.test');
  });
});

describe('pickRowForVariable', () => {
  const v: TestVariable = { id: 'v', name: 'x', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email' };

  it('fixed mode honours sourceRow', () => {
    expect(pickRowForVariable({ ...v, sourceRowMode: 'fixed', sourceRow: 3 }, 10, undefined).row).toBe(3);
  });

  it('random mode picks within bounds (seeded)', () => {
    let calls = 0;
    const seq = [0.1, 0.5, 0.9];
    const rng = () => seq[calls++ % seq.length];
    expect(pickRowForVariable({ ...v, sourceRowMode: 'random' }, 10, undefined, rng).row).toBe(1);
    expect(pickRowForVariable({ ...v, sourceRowMode: 'random' }, 10, undefined, rng).row).toBe(5);
    expect(pickRowForVariable({ ...v, sourceRowMode: 'random' }, 10, undefined, rng).row).toBe(9);
  });

  it('increment walks forward and wraps to 2 past the last row', () => {
    const inc = { ...v, sourceRowMode: 'increment' as const };
    // First run: cursor undefined → pick 0, next 1
    expect(pickRowForVariable(inc, 5, undefined)).toEqual({ row: 0, nextCursor: 1 });
    // 1 → 2
    expect(pickRowForVariable(inc, 5, 1)).toEqual({ row: 1, nextCursor: 2 });
    // 4 (last) → wrap to 2
    expect(pickRowForVariable(inc, 5, 4)).toEqual({ row: 4, nextCursor: 2 });
    // tiny source (rowCount 2) → still wraps inside bounds
    expect(pickRowForVariable(inc, 2, 1)).toEqual({ row: 1, nextCursor: 1 });
  });

  it('rowCount=0 falls back to row 0', () => {
    expect(pickRowForVariable({ ...v, sourceRowMode: 'random' }, 0, undefined).row).toBe(0);
    expect(pickRowForVariable({ ...v, sourceRowMode: 'increment' }, 0, undefined).row).toBe(0);
  });
});

describe('pickRowsForVariables / resolveAssignedValues', () => {
  it('skips fixed mode and picks for increment/random', () => {
    const vars: TestVariable[] = [
      { id: 'a', name: 'a', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRowMode: 'fixed', sourceRow: 0 },
      { id: 'b', name: 'b', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRowMode: 'increment' },
    ];
    // csvSource has rowCount=2. Cursor at 1 → row 1, next wraps to row 1
    // (rowCount ≤ 2 so wrap target = rowCount-1).
    const { rowPicks, nextCursors } = pickRowsForVariables(vars, [], [csvSource], { b: 1 });
    expect(rowPicks).toEqual({ b: 1 });
    expect(nextCursors.b).toBe(1);
    // 'a' is fixed — must not appear in rowPicks.
    expect(rowPicks.a).toBeUndefined();
  });

  it('resolveAssignedValues returns name → value map for assign vars', () => {
    const vars: TestVariable[] = [
      { id: 'a', name: 'token', mode: 'assign', sourceType: 'static', staticValue: 'abc' },
      { id: 'b', name: 'email', mode: 'assign', sourceType: 'csv', sourceAlias: 'users', sourceColumn: 'email', sourceRowMode: 'fixed', sourceRow: 1 },
      { id: 'c', name: 'extracted', mode: 'extract', targetSelector: 'h1' },
    ];
    const out = resolveAssignedValues(vars, [], [csvSource]);
    expect(out).toEqual({ token: 'abc', email: 'bob@x.test' });
  });
});
