/**
 * Extract file layout and streaming CSV I/O (§2.2 step 3, §2.3):
 *   {runDir}/{country}/{objectKey}/extract/[p{partition}/]{jobId}-{pageN}.csv
 *   {runDir}/{country}/{objectKey}/extract/deleted/{jobId}-{pageN}.csv
 *   {runDir}/{country}/{objectKey}/sorted/*.csv   (external sort output)
 *   {runDir}/{country}/{objectKey}/depth/d{n}.csv (depth ordering output)
 *
 * Pages are written as soon as they arrive and never held across
 * transforms; readers stream row by row through `CsvParser`.
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CsvParser, toCsv } from "../sfdc/csv";
import type { CountryCode, ObjectKey, SourceRow } from "../types";

export function unitDir(
  runDir: string,
  country: CountryCode,
  objectKey: ObjectKey,
): string {
  return path.join(runDir, country, objectKey);
}

export function extractDir(
  runDir: string,
  country: CountryCode,
  objectKey: ObjectKey,
  partition?: number,
): string {
  const base = path.join(unitDir(runDir, country, objectKey), "extract");
  return partition === undefined ? base : path.join(base, `p${partition}`);
}

export function deletedDir(
  runDir: string,
  country: CountryCode,
  objectKey: ObjectKey,
): string {
  return path.join(unitDir(runDir, country, objectKey), "extract", "deleted");
}

export function sortedDir(
  runDir: string,
  country: CountryCode,
  objectKey: ObjectKey,
): string {
  return path.join(unitDir(runDir, country, objectKey), "sorted");
}

export function depthDir(
  runDir: string,
  country: CountryCode,
  objectKey: ObjectKey,
): string {
  return path.join(unitDir(runDir, country, objectKey), "depth");
}

export function pageFileName(jobId: string, pageNo: number): string {
  return `${jobId}-${pageNo}.csv`;
}

/** Write rows as RFC-4180 CSV (header first), creating parent directories. */
export async function writeCsvFile(
  file: string,
  rows: readonly SourceRow[],
  columns: readonly string[],
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, toCsv(rows, columns), "utf8");
}

/** Stream a CSV file row by row (values are strings, empty = null). */
export async function* readCsvFile(file: string): AsyncIterable<SourceRow> {
  const parser = new CsvParser();
  const stream = createReadStream(file, { encoding: "utf8" });
  for await (const chunk of stream) {
    for (const rec of parser.push(chunk as string))
      yield rec as unknown as SourceRow;
  }
  for (const rec of parser.finish()) yield rec as unknown as SourceRow;
}

export async function readCsvRows(file: string): Promise<SourceRow[]> {
  const out: SourceRow[] = [];
  for await (const r of readCsvFile(file)) out.push(r);
  return out;
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
