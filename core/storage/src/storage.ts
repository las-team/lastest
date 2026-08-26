import type {
  BlobRef,
  PutOptions,
  QuotaStatus,
  SignedUrlOptions,
  StorageCapability,
} from "@lastest/contracts";

import { namespacedKey, namespacedPrefix, stripNamespace } from "./namespace";
import type { HostBlobRef, StorageHost } from "./host";

export interface StorageCapabilityScope {
  readonly pluginId: string;
  readonly teamId: string;
}

function toBlobRef(host: HostBlobRef, prefix: string): BlobRef {
  return {
    key: stripNamespace(host.key, prefix),
    bytes: host.bytes,
    contentType: host.contentType,
    createdAt: host.createdAt,
  };
}

/**
 * Serializes `put()`'s check-then-write per (team, plugin) prefix, in-process.
 *
 * A real fix (atomic increment at the host's storage layer) would also close
 * the race across multiple processes, but nothing here runs as more than one
 * process today — the same assumption `claimDuePluginJobs` and the scheduler
 * already make — so a module-level lock buys the correctness that matters now
 * for the cost of a `Promise` chain, not a storage-layer rewrite for a
 * capability with no consumer yet.
 */
const putLocks = new Map<string, Promise<unknown>>();

function withPutLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = putLocks.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  putLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Build the `storage` capability for one plugin's context.
 */
export function createStorageCapability(
  host: StorageHost,
  scope: StorageCapabilityScope,
): StorageCapability {
  const prefix = namespacedPrefix(scope.teamId, scope.pluginId);
  const fq = (key: string) => namespacedKey(scope.teamId, scope.pluginId, key);

  return {
    put(key, data, opts?: PutOptions) {
      return withPutLock(prefix, async () => {
        const [used, limit] = await Promise.all([
          host.usedBytes(prefix),
          host.quotaLimitBytes(scope.teamId),
        ]);
        if (used + data.byteLength > limit) {
          throw new Error(
            `Storage quota exceeded: ${used + data.byteLength} bytes would exceed the ${limit}-byte limit`,
          );
        }
        const ref = await host.put(fq(key), data, {
          contentType: opts?.contentType,
          ttlSeconds: opts?.ttlSeconds,
        });
        return toBlobRef(ref, prefix);
      });
    },

    get(key) {
      return host.get(fq(key));
    },

    async head(key) {
      const ref = await host.head(fq(key));
      return ref ? toBlobRef(ref, prefix) : null;
    },

    async list(keyPrefix) {
      const refs = await host.list(fq(keyPrefix));
      return refs.map((r) => toBlobRef(r, prefix));
    },

    delete(key) {
      return host.delete(fq(key));
    },

    signedUrl(key, opts?: SignedUrlOptions) {
      return host
        .signedUrl(fq(key), {
          expiresInSeconds: opts?.expiresInSeconds,
          filename: opts?.filename,
        })
        .then((url) => {
          if (!url) {
            throw new Error(
              "No signed URL could be minted — the storage host has no signing secret configured",
            );
          }
          return url;
        });
    },

    async quota(): Promise<QuotaStatus> {
      const [usedBytes, limitBytes] = await Promise.all([
        host.usedBytes(prefix),
        host.quotaLimitBytes(scope.teamId),
      ]);
      return { usedBytes, limitBytes };
    },
  };
}
