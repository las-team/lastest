/**
 * State store entry point (§2.4): implementations + the factory that picks
 * one from the staging config.
 *
 *   staging.databaseUrl = postgres://…   → PostgresStateStore
 *   staging.databaseUrl = file:<dir>     → FileStateStore in <dir>
 *   staging.databaseUrl = memory:        → MemoryStateStore (tests / throwaway dry runs)
 *   no databaseUrl, runDir set           → FileStateStore in {runDir}/state
 *   nothing                              → FileStateStore in ./runs/state
 *
 * `driver` overrides the inference (a `--store memory` style CLI flag).
 */
import path from "node:path";
import { getLogger } from "../logger";
import { MemoryStateStore } from "../testkit/memory-store";
import { FileStateStore } from "./file";
import { PostgresStateStore } from "./postgres";
import type { StateStore } from "./types";

export * from "./types";
export { FileStateStore, FILE_STORE_FORMAT } from "./file";
export type { FileStateStoreOptions } from "./file";
export {
  PostgresStateStore,
  postgresExecutor,
  translateError,
  isUniqueViolation,
} from "./postgres";
export type { PostgresStateStoreOptions, SqlExecutor } from "./postgres";
export { MemoryStateStore } from "../testkit/memory-store";
export {
  DEFAULT_SCHEMA,
  SCHEMA_VERSION,
  TABLES,
  TABLE_NAMES,
  ddlStatements,
  buildUpsert,
  buildSelect,
  buildUpdate,
  buildDelete,
  buildCount,
  buildWhere,
  dedupeRows,
  chunk,
} from "./sql";
export type { TableName, TableDef, ColumnDef, Statement } from "./sql";

export type StateStoreDriver = "memory" | "file" | "postgres";

/** What the factory needs — satisfied by `MigrationConfig` and `ResolvedCountryConfig`. */
export interface StateStoreConfigSource {
  target: { vaultDns: string };
  staging?: { databaseUrl?: string; runDir?: string };
}

export interface CreateStateStoreOverrides {
  /** Force a driver regardless of `staging.databaseUrl`. */
  driver?: StateStoreDriver;
  /** Explicit directory for the file driver (default `{runDir}/state`). */
  dir?: string;
  /** Postgres schema namespace (default `veeva_migration`). */
  schema?: string;
  batchSize?: number;
}

export interface ResolvedStoreTarget {
  driver: StateStoreDriver;
  vaultDns: string;
  databaseUrl?: string;
  dir?: string;
}

export const DEFAULT_RUN_DIR = "./runs";

/** Pure selection logic (unit-tested); `createStateStore` acts on it. */
export function resolveStoreTarget(
  source: StateStoreConfigSource,
  overrides: CreateStateStoreOverrides = {},
): ResolvedStoreTarget {
  const vaultDns = source.target?.vaultDns;
  if (!vaultDns)
    throw new Error("createStateStore: target.vaultDns is required");
  const url = source.staging?.databaseUrl?.trim() || undefined;
  const runDir = source.staging?.runDir || DEFAULT_RUN_DIR;
  const fileDir = overrides.dir ?? path.join(runDir, "state");

  let driver: StateStoreDriver;
  let dir: string | undefined;
  if (overrides.driver) driver = overrides.driver;
  else if (!url) driver = "file";
  else if (/^memory:/i.test(url)) driver = "memory";
  else if (/^file:/i.test(url)) driver = "file";
  else if (/^postgres(ql)?:\/\//i.test(url)) driver = "postgres";
  else
    throw new Error(
      `createStateStore: unsupported staging.databaseUrl scheme (expected postgres://, file: or memory:)`,
    );

  if (driver === "file")
    dir =
      overrides.dir ??
      (url && /^file:/i.test(url)
        ? url.replace(/^file:(\/\/)?/i, "") || fileDir
        : fileDir);
  if (driver === "postgres" && !(url && /^postgres(ql)?:\/\//i.test(url)))
    throw new Error(
      "createStateStore: postgres driver needs staging.databaseUrl = postgres://…",
    );

  return {
    driver,
    vaultDns,
    databaseUrl: driver === "postgres" ? url : undefined,
    dir,
  };
}

/** Build and open the store selected by the staging config (postgres is migrated on open). */
export async function createStateStore(
  source: StateStoreConfigSource,
  overrides: CreateStateStoreOverrides = {},
): Promise<StateStore> {
  const target = resolveStoreTarget(source, overrides);
  const log = getLogger("Store");
  switch (target.driver) {
    case "memory":
      log.debug({ vault_dns: target.vaultDns }, "using in-memory state store");
      return new MemoryStateStore(target.vaultDns);
    case "file": {
      log.debug(
        { vault_dns: target.vaultDns, dir: target.dir },
        "using file state store",
      );
      return FileStateStore.open({
        dir: target.dir!,
        vaultDns: target.vaultDns,
      });
    }
    case "postgres": {
      log.debug(
        { vault_dns: target.vaultDns, schema: overrides.schema },
        "using postgres state store",
      );
      return PostgresStateStore.connect({
        vaultDns: target.vaultDns,
        databaseUrl: target.databaseUrl,
        schema: overrides.schema,
        batchSize: overrides.batchSize,
      });
    }
  }
}
