/**
 * `@lastest/core-storage` — the `storage` capability: tenant-scoped bytes and
 * quota, nothing else.
 *
 * This replaces the RFC's `core/artifacts` ("screenshots, evidence, quota").
 * `docs/architecture/core-scope.md` §4: quota and tenant isolation are
 * boundaries; "screenshot", "baseline" and "evidence" are feature vocabulary
 * this package deliberately does not know. `core/contracts/src/storage.ts`
 * was already written to this shape — implemented here as specified, no
 * feature vocabulary found to push back on.
 */
import type { TeamRef } from "@lastest/contracts";

import { createStorageCapability } from "./storage";
import type { StorageHost } from "./host";

export { createStorageCapability } from "./storage";
export type { StorageCapabilityScope } from "./storage";
export type { HostBlobRef, StorageHost } from "./host";
export {
  assertSafeKey,
  namespacedKey,
  namespacedPrefix,
  stripNamespace,
  UnsafeStorageKeyError,
} from "./namespace";

export interface StorageScope {
  readonly team: TeamRef;
}

export interface StorageFactoryOptions {
  readonly host: StorageHost;
}

/** Mirrors `createBrowserFactory`'s shape — see `core/repos` for the twin. */
export function createStorageFactory(opts: StorageFactoryOptions) {
  return (pluginId: string, scope: StorageScope) =>
    createStorageCapability(opts.host, {
      pluginId,
      teamId: scope.team.id,
    });
}
