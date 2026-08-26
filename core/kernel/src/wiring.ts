import type { CapabilityName, DataCapability } from "@lastest/contracts";

/**
 * Manifest-derived wiring slots.
 *
 * A plugin's wiring used to be hand-assembled per plugin in the composition
 * root, and five distinct shapes grew out of that — each with a good reason,
 * but a reader had to hold all five plus per-plugin rationale to answer
 * "where does auth happen for this plugin". The manifest already declares
 * everything the shape depends on, so the kernel derives it instead:
 *
 * - **`runtime`** — present iff the plugin is tenanted (`tenancy` ≠ `"none"`).
 *   An untenanted plugin has no scope to build a `ctx` from (`buildContext`
 *   would throw `UntenantedPluginError` anyway), so handing it a runtime
 *   would only advertise a call it must never make.
 * - **`data`** — present iff the manifest declares a `schema`. This is the
 *   same handle `ctx.data` carries, duplicated for the callers that have no
 *   scope to build a context from: every deletion hook, plus background
 *   dispatchers and anonymous reads. A plugin with no tables gets none.
 * - **`storageHost`** — present iff the plugin consumes the `storage`
 *   capability. `ctx.storage` is team-scoped and exists only inside a built
 *   context; the deletion hook that must reap a deleted team's blobs has no
 *   context, so it gets the raw host and scopes it itself (see
 *   `plugins/data-sources/src/deletion.ts`).
 *
 * The composition root feeds this into each plugin's `configure<Name>()`. A
 * wiring that *needs* a slot the manifest does not grant fails at boot (the
 * root asserts each required slot is present), so a wrong shape is a startup
 * error next to the registry's other checks rather than a review catch.
 */
export interface WiringSlots<R, S> {
  readonly runtime?: R;
  readonly data?: DataCapability;
  readonly storageHost?: S;
}

/** The manifest facts the derivation reads. Structural, so the registry's
 *  widened `AnyManifest` and a concrete `PluginManifest` both satisfy it. */
export interface WiringShapeSource {
  readonly id: string;
  readonly tenancy?: "team" | "none";
  readonly schema?: () => Promise<unknown>;
  readonly capabilities?: readonly CapabilityName[];
}

export function wiringSlotsFor<R, S>(
  manifest: WiringShapeSource,
  from: {
    readonly runtime: R;
    readonly dataFor: (pluginId: string) => DataCapability;
    readonly storageHost: S;
  },
): WiringSlots<R, S> {
  return {
    runtime: manifest.tenancy === "none" ? undefined : from.runtime,
    data: manifest.schema ? from.dataFor(manifest.id) : undefined,
    storageHost: (manifest.capabilities ?? []).includes("storage")
      ? from.storageHost
      : undefined,
  };
}

/**
 * Assert a derived slot is present, for wirings that require it.
 *
 * This is the boot error that replaces the review catch: a plugin whose
 * wiring demands `runtime` while its manifest says `tenancy: "none"` (or
 * demands `data` with no `schema`) fails here, at startup, with the manifest
 * field that would grant it named in the message.
 */
export function requireSlot<T>(
  slot: T,
  pluginId: string,
  name: keyof WiringSlots<unknown, unknown>,
): NonNullable<T> {
  if (slot === undefined || slot === null) {
    const grant =
      name === "runtime"
        ? `tenancy other than "none"`
        : name === "data"
          ? `a \`schema\``
          : `\`capabilities: ["storage"]\``;
    throw new Error(
      `Plugin "${pluginId}"'s wiring requires the "${name}" slot, but its ` +
        `manifest does not grant it (needs ${grant}). Fix the manifest or ` +
        `the wiring — they describe the same shape.`,
    );
  }
  return slot;
}
