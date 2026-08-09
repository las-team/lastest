/**
 * The host port.
 *
 * `core/**` may never import `@/…`, so the actual bytes-on-disk and the
 * signed-URL mint are injected — same shape and reason as `core/browser`'s
 * `BrowserHost`. This package owns the *policy*: namespacing, the put-time
 * quota check, TTL bookkeeping. It does not own a filesystem, a bucket
 * client, or an HMAC secret.
 */

export interface HostBlobRef {
  readonly key: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly createdAt: Date;
}

export interface StorageHost {
  /** `key` is already namespaced by core — see `namespace.ts`. */
  put(
    key: string,
    data: Uint8Array,
    opts: { contentType?: string; ttlSeconds?: number },
  ): Promise<HostBlobRef>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<HostBlobRef | null>;
  /** `prefix` is already namespaced. */
  list(prefix: string): Promise<HostBlobRef[]>;
  delete(key: string): Promise<void>;
  /** Sum of bytes currently stored under a namespace prefix. */
  usedBytes(prefix: string): Promise<number>;
  /** The team's overall quota ceiling. */
  quotaLimitBytes(teamId: string): Promise<number>;
  /**
   * Sign a URL safe to hand to a browser. `key` is already namespaced.
   * Returning `null` reads to the caller as "no grant could be signed" —
   * the same fail-closed shape `core/browser`'s `streamGrant` uses.
   */
  signedUrl(
    key: string,
    opts: { expiresInSeconds?: number; filename?: string },
  ): Promise<string | null>;
}
