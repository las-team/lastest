import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseCsvBuffer,
  parseCsvBufferYielding,
  parseCsvYielding,
  parseCsvReference,
  findCsvReferences,
} from "./api";

describe("parseCsv", () => {
  it("parses headers and rows with comma delimiter", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(r.rowCount).toBe(2);
    expect(r.delimiter).toBe(",");
  });

  it("handles quoted fields with embedded commas, quotes, and newlines", () => {
    const csv = `name,bio\n"Alice","Says ""hi"""\n"Bob","line1\nline2"`;
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual(["Alice", 'Says "hi"']);
    expect(r.rows[1]).toEqual(["Bob", "line1\nline2"]);
  });

  it("detects semicolon delimiter", () => {
    const r = parseCsv("a;b\n1;2");
    expect(r.delimiter).toBe(";");
    expect(r.rows[0]).toEqual(["1", "2"]);
  });

  it("pads short rows to header length", () => {
    const r = parseCsv("a,b,c\n1,2");
    expect(r.rows[0]).toEqual(["1", "2", ""]);
  });

  it("returns empty when input is empty", () => {
    expect(parseCsv("").headers).toEqual([]);
  });
});

describe("parseCsvReference", () => {
  it("parses column with row index", () => {
    expect(parseCsvReference("{{csv:users.email[0]}}")).toEqual({
      type: "column",
      alias: "users",
      column: "email",
      rowIndex: 0,
    });
  });

  it("parses bare column reference", () => {
    expect(parseCsvReference("{{csv:users.email}}")).toEqual({
      type: "column",
      alias: "users",
      column: "email",
    });
  });

  it("parses cell reference", () => {
    expect(parseCsvReference("{{csv:users.A1}}")).toEqual({
      type: "cell",
      alias: "users",
      cellRef: "A1",
    });
  });

  it("rejects invalid prefixes", () => {
    expect(parseCsvReference("{{sheet:x.y}}")).toBeNull();
    expect(parseCsvReference("csv:no-braces")).toBeNull();
  });
});

describe("findCsvReferences", () => {
  it("extracts every {{csv:...}} match", () => {
    const code = `await page.fill('#email', '{{csv:users.email[0]}}');\nawait page.fill('#name', '{{csv:users.name[0]}}');`;
    const results = findCsvReferences(code);
    expect(results).toHaveLength(2);
    expect(results[0].reference.column).toBe("email");
    expect(results[1].reference.column).toBe("name");
  });
});

describe("parseCsvYielding", () => {
  /** Multi-chunk, and deliberately adversarial about where a chunk boundary
   *  can land: quoted fields carrying the delimiter, escaped quotes, and
   *  embedded newlines that make one record span several physical lines. */
  function fixture(rows: number): string {
    const out = ["name,bio,country"];
    for (let i = 0; i < rows; i++) {
      out.push(
        `"User ${i}","line1\nline2, still ${i}\nsays ""hi""","C${i % 7}"`,
      );
    }
    return out.join("\n");
  }

  it("produces byte-identical output to the synchronous parser", async () => {
    const csv = fixture(200);
    // chunkRows well under the record count, and not a divisor of it, so the
    // pauses land mid-file rather than tidily at the end.
    for (const chunkRows of [1, 3, 7, 64]) {
      const async_ = await parseCsvYielding(csv, { chunkRows });
      expect(async_).toEqual(parseCsv(csv));
    }
  });

  it("keeps quoted state across a pause", async () => {
    // One record per chunk, and every record contains newlines inside quotes —
    // a parser that resumed on a line boundary instead of a suspended scan
    // would split these.
    const csv = fixture(10);
    const r = await parseCsvYielding(csv, { chunkRows: 1 });
    expect(r.rows).toHaveLength(10);
    expect(r.rows[3][1]).toBe('line1\nline2, still 3\nsays "hi"');
    expect(r.headers).toEqual(["name", "bio", "country"]);
  });

  it("matches on the edge cases the sync parser already handles", async () => {
    for (const csv of [
      "",
      "a,b,c",
      "a;b\n1;2",
      "a,b,c\n1,2\n",
      "a\tb\n1\t2\r\n3\t4\r\n",
      '﻿a,b\n"x,y",2',
    ]) {
      expect(await parseCsvYielding(csv, { chunkRows: 1 })).toEqual(
        parseCsv(csv),
      );
    }
  });

  it("parses a buffer the same way", async () => {
    const csv = fixture(50);
    expect(
      await parseCsvBufferYielding(Buffer.from(csv), { chunkRows: 5 }),
    ).toEqual(parseCsvBuffer(Buffer.from(csv)));
  });
});
