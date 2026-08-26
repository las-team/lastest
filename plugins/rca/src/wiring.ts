import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { RcaHost } from "./host";

/**
 * How the plugin reaches what it was wired with.
 *
 * Same arrangement as `plugins/explorer/src/wiring.ts`, and for the same
 * reason: a plugin's `"use server"` module is imported by Next.js rather than
 * constructed, so there is no moment at which to pass it arguments.
 * `configureRca()` is called once by the composition root
 * (`src/lib/core/runtime.ts`) and the actions read what it left.
 *
 * The slot is a realm-wide `Symbol.for` key on `globalThis`, not a module-level
 * `let`. Next.js can place a server action's module and the module that wired
 * it in different bundles, and two copies of a module-level binding is a
 * failure that only shows up in a production build.
 *
 * Unlike explorer this carries no `data` handle — RCA owns no tables, so there
 * is nothing to hand it.
 */

export type RcaScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/**
 * The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses.
 *
 * Structural rather than imported so the package does not depend on the
 * kernel's concrete runtime type just to be handed a context.
 */
export interface RcaRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: RcaScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface RcaWiring {
  readonly runtime: RcaRuntime;
  readonly host: RcaHost;
}

const SLOT = Symbol.for("lastest.plugin.rca.wiring");

type Carrier = typeof globalThis & { [SLOT]?: RcaWiring };

export function configureRca(wiring: RcaWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function rcaWiring(): RcaWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The rca plugin is not wired. The composition root must call " +
        "configureRca({ runtime, host }) before any rca action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isRcaConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
