import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { RangerHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * Copies `plugins/explorer/src/wiring.ts` exactly, including the reasoning:
 * a plugin's `"use server"` module is imported by Next.js, not constructed,
 * so `configureRanger()` is called once by the composition root
 * (`src/lib/core/runtime.ts`) and the actions read what it left. The slot is
 * a realm-wide `Symbol.for` key rather than a module-level `let` because
 * Next.js can place a server action's module and the module that wired it in
 * different bundles.
 */

export type RangerScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/** Structural, not imported, so this plugin does not depend on the kernel's
 *  concrete runtime type just to be handed a context. */
export interface RangerRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: RangerScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface RangerWiring {
  readonly runtime: RangerRuntime;
  readonly host: RangerHost;
  /**
   * The same handle `ctx.data` carries. Duplicated here for the deletion
   * hook, which runs *because* a team or repo was deleted and so has no
   * scope left to build a context from.
   */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.ranger.wiring");

type Carrier = typeof globalThis & { [SLOT]?: RangerWiring };

export function configureRanger(wiring: RangerWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function rangerWiring(): RangerWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The ranger plugin is not wired. The composition root must call " +
        "configureRanger({ runtime, host, data }) before any ranger action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isRangerConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
