import { describe, it, expect } from 'vitest';
import { resolveVarReferences } from './resolver';
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
});
