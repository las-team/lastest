/**
 * Programmatic entry point (§8.10): wire clients and the state store from a
 * `MigrationConfig`, execute one mode end-to-end and tear the sessions down.
 * The CLI's `runMode` is this plus the exit-code mapping; library callers get
 * the full `RunSummary`. Pass `deps` to supply pre-built dependencies (tests,
 * embedding hosts) — then nothing is wired or closed here.
 */
import { DefaultRunEngine, type EngineDeps } from "./engine";
import type { RunOptions, RunSummary } from "./types";
import { createEngineDeps, type WiringOptions } from "./wiring";

export interface RunMigrationOptions {
  /** Pre-built dependencies; skips `createEngineDeps` and the teardown. */
  deps?: EngineDeps;
  /** Forwarded to `createEngineDeps` when `deps` is not supplied. */
  wiring?: Omit<WiringOptions, "countries" | "offline">;
}

export async function runMigration(
  opts: RunOptions,
  options: RunMigrationOptions = {},
): Promise<RunSummary> {
  if (options.deps) return new DefaultRunEngine(options.deps).execute(opts);
  const deps = await createEngineDeps(opts.config, opts.context, {
    ...options.wiring,
    countries: opts.countries,
    offline: opts.mode === "report",
  });
  try {
    return await new DefaultRunEngine(deps).execute(opts);
  } finally {
    await deps.close();
  }
}
