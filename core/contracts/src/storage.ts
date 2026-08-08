/**
 * Generic tenant-scoped blob storage.
 *
 * This replaces the RFC's `core/artifacts` ("screenshots, evidence, quota").
 * See `docs/architecture/core-scope.md` §4: *quota* and *tenant isolation* are
 * boundaries — a feature ignoring them fills the disk for everyone, or serves
 * one team's bytes to another. *Screenshot*, *baseline* and *evidence* are
 * feature vocabulary and core has no business knowing them.
 *
 * So this interface knows about bytes, keys, tenants and quota. It does not
 * know what a screenshot is. A feature that wants baselines builds them on top,
 * in the feature.
 */

/** A stored object. Plugins get a reference, never a filesystem path. */
export interface BlobRef {
  /** Storage key, namespaced to the plugin by core. Stable. */
  readonly key: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly createdAt: Date;
}

export interface PutOptions {
  readonly contentType?: string;
  /**
   * Delete automatically after this many seconds. Core enforces it; the plugin
   * does not have to write a reaper, and quota does not silently grow because
   * someone forgot to.
   */
  readonly ttlSeconds?: number;
}

export interface SignedUrlOptions {
  readonly expiresInSeconds?: number;
  /** Suggest a download filename. Presentation only. */
  readonly filename?: string;
}

export interface QuotaStatus {
  readonly usedBytes: number;
  readonly limitBytes: number;
}

/**
 * All keys are implicitly namespaced by `(teamId, pluginId)`. A plugin cannot
 * construct a key that reaches another plugin's or another team's objects —
 * that isolation is core's job, not something each plugin re-implements.
 */
export interface StorageCapability {
  /**
   * Store bytes. Rejects when the team is over quota, so quota is enforced at
   * the only place that can enforce it rather than trusted to callers.
   */
  put(key: string, data: Uint8Array, opts?: PutOptions): Promise<BlobRef>;

  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<BlobRef | null>;
  list(prefix: string): Promise<BlobRef[]>;
  delete(key: string): Promise<void>;

  /** Signed and expiring. Safe to hand to a browser. */
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;

  /** For a plugin that wants to degrade gracefully instead of hitting a reject. */
  quota(): Promise<QuotaStatus>;
}
