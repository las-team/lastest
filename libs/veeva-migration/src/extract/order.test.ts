import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { to18 } from "../transform/ids";
import type { SourceRow } from "../types";
import { readCsvRows, writeCsvFile } from "./files";
import {
  computeDepths,
  depthPartitionFiles,
  externalSort,
  partitionPredicates,
  rowComparator,
} from "./order";
import type { ExtractFile } from "./types";
import { cleanup, tmpRunDir } from "./test-helpers";

const P = (n: number) => to18(`a0P0000000000${String(n).padStart(2, "0")}`);

describe("partitionPredicates", () => {
  it("parents (null) first, then children (notNull)", () => {
    expect(
      partitionPredicates({
        field: "Parent_Call_vod__c",
        order: ["null", "notNull"],
      }),
    ).toEqual(["Parent_Call_vod__c = null", "Parent_Call_vod__c != null"]);
    expect(partitionPredicates(undefined)).toEqual([]);
  });
});

describe("computeDepths (BFS from roots)", () => {
  it("chains, unknown parents as roots, cycles unresolved", () => {
    const r = computeDepths(
      [
        { id: P(1), parentId: null },
        { id: P(2), parentId: P(1) },
        { id: P(3), parentId: P(2) },
        { id: P(4), parentId: to18("a0P0000000000ZZ") }, // parent not in the extract → root
        { id: P(5), parentId: P(6) },
        { id: P(6), parentId: P(5) }, // cycle
        { id: P(7), parentId: P(5) }, // hangs off the cycle
      ],
      20,
    );
    expect(r.depth.get(P(1))).toBe(0);
    expect(r.depth.get(P(2))).toBe(1);
    expect(r.depth.get(P(3))).toBe(2);
    expect(r.depth.get(P(4))).toBe(0);
    expect([...r.unresolved].sort()).toEqual([P(5), P(6), P(7)].sort());
  });

  it("respects maxDepth", () => {
    const edges = [
      { id: P(1), parentId: null },
      { id: P(2), parentId: P(1) },
      { id: P(3), parentId: P(2) },
    ];
    const r = computeDepths(edges, 1);
    expect(r.depth.get(P(2))).toBe(1);
    expect(r.unresolved.has(P(3))).toBe(true);
  });
});

describe("file-based ordering", () => {
  let dir: string | undefined;
  afterEach(async () => cleanup(dir));

  async function pages(
    rows: SourceRow[][],
    columns: string[],
  ): Promise<ExtractFile[]> {
    const out: ExtractFile[] = [];
    for (let i = 0; i < rows.length; i++) {
      const file = path.join(dir!, "extract", `job-${i}.csv`);
      await writeCsvFile(file, rows[i], columns);
      out.push({
        path: file,
        jobId: "job",
        pageNo: i,
        rows: rows[i].length,
        closure: false,
      });
    }
    return out;
  }

  it("externalSort merges chunks by (key, Id) with nulls last and bounded chunk size", async () => {
    dir = await tmpRunDir();
    const cols = ["Id", "Capture_Datetime_vod__c"];
    const files = await pages(
      [
        [
          { Id: P(3), Capture_Datetime_vod__c: "2025-03-01T00:00:00.000Z" },
          { Id: P(1), Capture_Datetime_vod__c: "2025-01-01T00:00:00.000Z" },
        ],
        [
          { Id: P(5), Capture_Datetime_vod__c: null },
          { Id: P(2), Capture_Datetime_vod__c: "2025-01-01T00:00:00.000Z" },
        ],
        [{ Id: P(4), Capture_Datetime_vod__c: "2024-12-31T00:00:00.000Z" }],
      ],
      cols,
    );
    const sorted = await externalSort(
      files,
      ["Capture_Datetime_vod__c", "Id"],
      cols,
      path.join(dir, "sorted"),
      {
        chunkRows: 2,
        pageRows: 2,
      },
    );
    expect(sorted).toHaveLength(3);
    const ids: string[] = [];
    for (const f of sorted)
      for (const r of await readCsvRows(f.path)) ids.push(r.Id);
    expect(ids).toEqual([P(4), P(1), P(2), P(3), P(5)]);
    expect(sorted.map((f) => f.jobId)).toEqual(["sorted", "sorted", "sorted"]);
  });

  it("depthPartitionFiles writes one partition per depth and reports cycles", async () => {
    dir = await tmpRunDir();
    const cols = ["Id", "Parent_Product_vod__c"];
    const files = await pages(
      [
        [
          { Id: P(3), Parent_Product_vod__c: P(2) },
          { Id: P(1), Parent_Product_vod__c: null },
        ],
        [
          { Id: P(2), Parent_Product_vod__c: P(1) },
          { Id: P(5), Parent_Product_vod__c: P(6) },
          { Id: P(6), Parent_Product_vod__c: P(5) },
        ],
      ],
      cols,
    );
    const r = await depthPartitionFiles(
      files,
      "Parent_Product_vod__c",
      cols,
      path.join(dir, "depth"),
      {
        objectKey: "product",
        country: "GLOBAL",
        maxDepth: 20,
      },
    );
    expect(r.files.map((f) => f.partition)).toEqual([0, 1, 2, 21]);
    expect((await readCsvRows(r.files[0].path)).map((x) => x.Id)).toEqual([
      P(1),
    ]);
    expect(
      (await readCsvRows(r.files[3].path)).map((x) => x.Id).sort(),
    ).toEqual([P(5), P(6)].sort());
    expect([...r.unresolved].sort()).toEqual([P(5), P(6)].sort());
    expect(r.findings).toMatchObject([
      { severity: "warning", code: "MAP_DEPTH_UNRESOLVED", count: 2 },
    ]);
  });

  it("rowComparator is stable on Id", () => {
    const cmp = rowComparator(["K"]);
    expect(cmp({ Id: "b", K: "1" }, { Id: "a", K: "1" })).toBeGreaterThan(0);
    expect(cmp({ Id: "a", K: null }, { Id: "b", K: "1" })).toBeGreaterThan(0);
  });
});
