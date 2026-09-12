/**
 * State store entry point (§2.4): implementations + the factory that opens one.
 *
 *   driver "memory"         → MemoryStateStore (tests / throwaway dry runs)
 *   driver "file" (default) → FileStateStore in `dir`
 *
 * **There is deliberately no postgres driver here, and no store location in the
 * migration config.** Both used to exist, and together they were the feature's
 * worst defect: `staging.databaseUrl` carried the *app's* own `DATABASE_URL`
 * into the engine, which then opened its own `postgres()` pool — outside the
 * instrumented client in `@lastest/db`, so untraced and outside its
 * bound-parameter redaction policy — and ran DDL under an advisory lock on
 * every page render. Worse, the tables it created were shared by every tenant
 * and keyed by nothing but a Vault DNS string a tenant typed into their own
 * connector, so one customer could read another's id map.
 *
 * The store is now **injected by the caller** (`WiringOptions.store` /
 * `EngineDeps.store`). In the app that is `PluginDataStateStore`, which runs on
 * core's own pool through `ctx.data` and carries the project id in the leading
 * column of every primary key. The CLI gets the file driver and a `--state-dir`
 * flag. Nothing in this package can open a database connection any more.
 */
import path from "node:path";
import { getLogger } from "../logger";
import { MemoryStateStore } from "../testkit/memory-store";
import { FileStateStore } from "./file";
import type { StateStore } from "./types";

export * from "./types";
export { FileStateStore, FILE_STORE_FORMAT } from "./file";
export type { FileStateStoreOptions } from "./file";
export { MemoryStateStore } from "../testkit/memory-store";

export type StateStoreDriver = "memory" | "file";

export interface CreateStateStoreOverrides {
  /** Which implementation to open. Default `file`. */
  driver?: StateStoreDriver;
  /** Directory for the file driver. Default `{runDir}/state`. */
  dir?: string;
}

export interface ResolvedStoreTarget {
  driver: StateStoreDriver;
  vaultDns: string;
  dir?: string;
}

/**
 * What the factory needs.
 *
 * Note it is `runDir` — the caller's directory from `RunContext` — and not a
 * config field. The run's own directory is the only place a file store may
 * default to; a config field is how a settings form came to aim engine writes
 * at an arbitrary path.
 */
export interface StateStoreLocation {
  vaultDns: string;
  runDir: string;
}

/** Pure selection logic (unit-tested); `createStateStore` acts on it. */
export function resolveStoreTarget(
  location: StateStoreLocation,
  overrides: CreateStateStoreOverrides = {},
): ResolvedStoreTarget {
  const vaultDns = location.vaultDns;
  if (!vaultDns)
    throw new Error("createStateStore: target.vaultDns is required");
  if (!location.runDir && !overrides.dir)
    throw new Error("createStateStore: runDir or an explicit dir is required");

  const driver: StateStoreDriver = overrides.driver ?? "file";
  return {
    driver,
    vaultDns,
    dir:
      driver === "file"
        ? (overrides.dir ?? path.join(location.runDir, "state"))
        : undefined,
  };
}

/** Build and open the selected store. */
export async function createStateStore(
  location: StateStoreLocation,
  overrides: CreateStateStoreOverrides = {},
): Promise<StateStore> {
  const target = resolveStoreTarget(location, overrides);
  const log = getLogger("Store");
  switch (target.driver) {
    case "memory":
      log.debug({ vault_dns: target.vaultDns }, "using in-memory state store");
      return new MemoryStateStore(target.vaultDns);
    case "file":
      log.debug(
        { vault_dns: target.vaultDns, dir: target.dir },
        "using file state store",
      );
      return FileStateStore.open({
        dir: target.dir!,
        vaultDns: target.vaultDns,
      });
  }
}
