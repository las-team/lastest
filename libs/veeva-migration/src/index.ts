/**
 * @lastest/veeva-migration — public barrel.
 * Spec: docs/MIGRATION_SPEC.md · Builder guide: docs/CONTRACTS.md
 *
 * Entry points: `loadConfig` → `runPreflight` / `runMigration`; the clients
 * and the state store are exposed for embedding hosts and tests.
 */
export * from "./types";
export * from "./country-of";
export * from "./hash";
export { getLogger, logger, type Logger } from "./logger";

export * from "./objects/types";
export * from "./objects/registry";

export * from "./transform/ids";
export * from "./transform/spec";
export * from "./transform/registry";
export * from "./transform/apply";

export * from "./config/schema";
export * from "./config/load";
export * from "./config/resolve";
export * from "./config/countries";

export * from "./sfdc/index";
export * from "./vault/index";
export * from "./store/index";
export * from "./preflight/index";
export * from "./extract/index";
export * from "./load/index";
export * from "./reconcile/index";
export * from "./run/index";

// Names defined in more than one area (different implementations): the public
// barrel resolves each to its canonical owner. Reach the other through the
// area barrel (`./vault/index`, `./store/index`, `./load/index`, `./run/index`).
export {
  backoffDelayMs,
  defaultSleep,
  type RandomFn,
  type SleepFn,
} from "./sfdc/retry";
export { toCsv } from "./sfdc/csv";
export { buildCount, buildSelect } from "./sfdc/soql";
export { unitDir } from "./extract/files";
export { SYSTEM_COLUMNS } from "./extract/columns";
export { isLater } from "./extract/delta";
export { blobNameOf, blobPolicyOf } from "./load/blobs";
