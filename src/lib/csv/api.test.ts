import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvReference, findCsvReferences } from './api';

describe('parseCsv', () => {
  it('parses headers and rows with comma delimiter', () => {
    const r = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(r.headers).toEqual(['a', 'b', 'c']);
    expect(r.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(r.rowCount).toBe(2);
    expect(r.delimiter).toBe(',');
  });

  it('handles quoted fields with embedded commas, quotes, and newlines', () => {
    const csv = `name,bio\n"Alice","Says ""hi"""\n"Bob","line1\nline2"`;
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual(['Alice', 'Says "hi"']);
    expect(r.rows[1]).toEqual(['Bob', 'line1\nline2']);
  });

  it('detects semicolon delimiter', () => {
    const r = parseCsv('a;b\n1;2');
    expect(r.delimiter).toBe(';');
    expect(r.rows[0]).toEqual(['1', '2']);
  });

  it('pads short rows to header length', () => {
    const r = parseCsv('a,b,c\n1,2');
    expect(r.rows[0]).toEqual(['1', '2', '']);
  });

  it('returns empty when input is empty', () => {
    expect(parseCsv('').headers).toEqual([]);
  });
});

describe('parseCsvReference', () => {
  it('parses column with row index', () => {
    expect(parseCsvReference('{{csv:users.email[0]}}')).toEqual({
      type: 'column',
      alias: 'users',
      column: 'email',
      rowIndex: 0,
    });
  });

  it('parses bare column reference', () => {
    expect(parseCsvReference('{{csv:users.email}}')).toEqual({
      type: 'column',
      alias: 'users',
      column: 'email',
    });
  });

  it('parses cell reference', () => {
    expect(parseCsvReference('{{csv:users.A1}}')).toEqual({
      type: 'cell',
      alias: 'users',
      cellRef: 'A1',
    });
  });

  it('rejects invalid prefixes', () => {
    expect(parseCsvReference('{{sheet:x.y}}')).toBeNull();
    expect(parseCsvReference('csv:no-braces')).toBeNull();
  });
});

describe('findCsvReferences', () => {
  it('extracts every {{csv:...}} match', () => {
    const code = `await page.fill('#email', '{{csv:users.email[0]}}');\nawait page.fill('#name', '{{csv:users.name[0]}}');`;
    const results = findCsvReferences(code);
    expect(results).toHaveLength(2);
    expect(results[0].reference.column).toBe('email');
    expect(results[1].reference.column).toBe('name');
  });
});
