/**
 * Run-directory layout shared by the run engine, the loader and the
 * reconciler (§2.2 step 3, §2.3, §8.4, §8.6):
 *
 *   {runDir}/{country}/{objectKey}/extract/…            (extractor)
 *   {runDir}/{country}/{objectKey}/payload/batch-{n}.json (transform output, 500 rows/file)
 *   {runDir}/{country}/{objectKey}/blobs/batch-{n}.json   (deferred blobs, §8.6)
 *   {runDir}/{country}/{objectKey}/pending/queue.jsonl    (pending FK queue, §8.4)
 *   {runDir}/report.md, report.json, audit.jsonl
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Unit } from "../types";
import type { PayloadRow } from "./types";

export const PAYLOAD_FILE_ROWS = 500;

export function unitDir(runDir: string, unit: Unit): string {
  return path.join(runDir, unit.country, unit.objectKey);
}
export function payloadDir(runDir: string, unit: Unit): string {
  return path.join(unitDir(runDir, unit), "payload");
}
export function blobsDir(runDir: string, unit: Unit): string {
  return path.join(unitDir(runDir, unit), "blobs");
}
export function pendingDir(runDir: string, unit: Unit): string {
  return path.join(unitDir(runDir, unit), "pending");
}
export function pendingQueueFile(runDir: string, unit: Unit): string {
  return path.join(pendingDir(runDir, unit), "queue.jsonl");
}
export function batchFileName(n: number, prefix = ""): string {
  return `${prefix}batch-${String(n).padStart(5, "0")}.json`;
}

/** Write rows as `[prefix]batch-{n}.json` files of ≤ `rowsPerFile`; returns the file paths. */
export async function writePayloadFiles(
  dir: string,
  rows: AsyncIterable<PayloadRow> | Iterable<PayloadRow>,
  rowsPerFile = PAYLOAD_FILE_ROWS,
  prefix = "",
): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  let buf: PayloadRow[] = [];
  let n = 0;
  const flush = async () => {
    if (!buf.length) return;
    const file = path.join(dir, batchFileName(n++, prefix));
    await fs.writeFile(file, JSON.stringify(buf), "utf8");
    files.push(file);
    buf = [];
  };
  for await (const row of rows) {
    buf.push(row);
    if (buf.length >= rowsPerFile) await flush();
  }
  await flush();
  return files;
}

/** Sorted `batch-*.json` files of a directory (empty when the directory is absent). */
export async function listPayloadFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^(?:[\w.-]+-)?batch-\d+\.json$/.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

export async function* readPayloadFiles(
  files: readonly string[],
): AsyncGenerator<PayloadRow> {
  for (const file of files) {
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as PayloadRow[];
    for (const r of rows) yield r;
  }
}

/** Stream every payload row of a unit (`payload/batch-*.json` in order). */
export async function* readUnitPayloads(
  runDir: string,
  unit: Unit,
): AsyncGenerator<PayloadRow> {
  yield* readPayloadFiles(await listPayloadFiles(payloadDir(runDir, unit)));
}

/** Append-only JSON lines helpers for the pending queue. */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim().length)
    .map((l) => JSON.parse(l) as T);
}

export async function writeJsonl<T>(
  file: string,
  rows: readonly T[],
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

export async function appendJsonl<T>(
  file: string,
  rows: readonly T[],
): Promise<void> {
  if (!rows.length) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(
    file,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
}
