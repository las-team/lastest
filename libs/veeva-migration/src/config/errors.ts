/**
 * Config error type shared by the loader and the overlay merger (kept in its
 * own module so `load.ts` ↔ `countries.ts` need no import cycle).
 * Exit code 5 (§8.10).
 */
import type { ZodError } from "zod";

export class ConfigError extends Error {
  readonly exitCode = 5;
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export function formatZodError(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
}
