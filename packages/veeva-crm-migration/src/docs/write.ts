/**
 * The only I/O in `docs/`: writes rendered documents under a directory.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RenderedDoc } from "./render";

/**
 * Writes every document below `dir` (created as needed) and returns the
 * absolute paths written, sorted.
 */
export async function writeDocs(
  docs: readonly RenderedDoc[],
  dir: string,
): Promise<string[]> {
  const root = path.resolve(dir);
  const written: string[] = [];
  for (const doc of docs) {
    const relative = path.normalize(doc.path);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`refusing to write outside ${root}: ${doc.path}`);
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, doc.content, "utf8");
    written.push(file);
  }
  return written.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
