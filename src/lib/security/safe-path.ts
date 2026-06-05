import path from "node:path";
import { promises as fs } from "node:fs";

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/**
 * Throw if `absPath` is not strictly under `baseDir`. Both arguments must be
 * absolute. Uses a prefix check on the normalized joined paths — caller is
 * responsible for normalization where needed.
 */
export function assertWithinDir(absPath: string, baseDir: string): void {
  const normalized = path.resolve(absPath);
  const base = path.resolve(baseDir);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (normalized !== base && !normalized.startsWith(baseWithSep)) {
    throw new UnsafePathError(
      `Path escapes base directory: ${absPath} (base ${baseDir})`,
    );
  }
}

/**
 * Realpath + prefix check. Returns the resolved canonical path, throws on
 * escape or non-existence. Use when you need to be certain a symlink hasn't
 * been planted under `baseDir`.
 */
export async function realpathWithin(
  absPath: string,
  baseDir: string,
): Promise<string> {
  let real: string;
  try {
    real = await fs.realpath(absPath);
  } catch {
    throw new UnsafePathError(
      `Path does not exist or cannot be resolved: ${absPath}`,
    );
  }
  const baseReal = await fs
    .realpath(baseDir)
    .catch(() => path.resolve(baseDir));
  const baseWithSep = baseReal.endsWith(path.sep)
    ? baseReal
    : baseReal + path.sep;
  if (real !== baseReal && !real.startsWith(baseWithSep)) {
    throw new UnsafePathError(
      `Path resolves outside base directory: ${absPath} → ${real}`,
    );
  }
  return real;
}
