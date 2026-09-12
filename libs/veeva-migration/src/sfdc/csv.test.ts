import { describe, expect, it } from "vitest";
import { CsvParser, parseCsv, parseCsvRows, toCsv } from "./csv";

describe("CSV parser", () => {
  it("parses a plain RFC-4180 page with LF and a trailing newline", () => {
    const rows = parseCsv("Id,Name,Amount\n001,Acme,10\n002,,\n");
    expect(rows).toEqual([
      { Id: "001", Name: "Acme", Amount: "10" },
      { Id: "002", Name: null, Amount: null },
    ]);
  });

  it("handles CRLF, BOM and a last row without a newline", () => {
    const rows = parseCsv("\uFEFFId,Name\r\n001,A\r\n002,B");
    expect(rows).toEqual([
      { Id: "001", Name: "A" },
      { Id: "002", Name: "B" },
    ]);
  });

  it("handles quoted commas, escaped quotes and embedded newlines", () => {
    const text =
      'Id,Note\n001,"Hello, ""world""\nsecond line"\n002,"plain"\n003,""\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      { Id: "001", Note: 'Hello, "world"\nsecond line' },
      { Id: "002", Note: "plain" },
      { Id: "003", Note: null },
    ]);
  });

  it("keeps a value that starts with a space or a quote-like prefix intact", () => {
    const rows = parseCsv('Id,V\n001, qfoo\n002," qbar"\n');
    expect(rows).toEqual([
      { Id: "001", V: " qfoo" },
      { Id: "002", V: " qbar" },
    ]);
  });

  it("is chunk-boundary agnostic (quotes, escaped quotes and CRLF cut in half)", () => {
    const text = 'Id,Note\r\n001,"a""b,\r\nc"\r\n002,x\r\n';
    const whole = parseCsv(text);
    for (let cut = 1; cut < text.length; cut++) {
      const p = new CsvParser();
      const rows = [
        ...p.push(text.slice(0, cut)),
        ...p.push(text.slice(cut)),
        ...p.finish(),
      ];
      expect(rows, `cut at ${cut}`).toEqual(whole);
    }
    expect(whole).toEqual([
      { Id: "001", Note: 'a"b,\r\nc' },
      { Id: "002", Note: "x" },
    ]);
  });

  it("works one character at a time", () => {
    const text = 'A,B\n"x,y",""\n1,2\n';
    const p = new CsvParser();
    const rows: unknown[] = [];
    for (const ch of text) rows.push(...p.push(ch));
    rows.push(...p.finish());
    expect(rows).toEqual([
      { A: "x,y", B: null },
      { A: "1", B: "2" },
    ]);
    expect(p.columns).toEqual(["A", "B"]);
    expect(p.rows).toBe(2);
  });

  it("reports ragged rows and unterminated quotes", () => {
    expect(() => parseCsv("A,B\n1\n")).toThrow(/has 1 fields, header has 2/);
    expect(() => parseCsv('A\n"open')).toThrow(/inside a quoted field/);
  });

  it("returns no rows for a header-only page", () => {
    expect(parseCsv("Id,Name\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });

  it("parseCsvRows requires an Id column only when rows exist", () => {
    expect(parseCsvRows("Name\n")).toEqual([]);
    expect(() => parseCsvRows("Name\nx\n")).toThrow(/no Id column/);
    expect(parseCsvRows("Id,Account_vod__r.Name\n001,Acme\n")).toEqual([
      { Id: "001", "Account_vod__r.Name": "Acme" },
    ]);
  });

  it("toCsv round-trips through the parser", () => {
    const rows = [
      { Id: "001", Note: 'a "q", b\nc', Empty: null },
      { Id: "002", Note: "plain", Empty: "" },
    ];
    const csv = toCsv(rows, ["Id", "Note", "Empty"]);
    expect(parseCsv(csv)).toEqual([
      { Id: "001", Note: 'a "q", b\nc', Empty: null },
      { Id: "002", Note: "plain", Empty: null },
    ]);
  });
});
