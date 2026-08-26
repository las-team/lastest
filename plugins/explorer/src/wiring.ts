import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { ExplorerHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * A plugin's `"use server"` module is imported by Next.js, not constructed by
 * anyone — so there is nowhere to pass constructor arguments. `configure()` is
 * called once by the composition root (`src/lib/core/runtime.ts`) and the
 * actions read what it left.
 *
 * The slot lives on `globalThis` behind a `Symbol.for` key rather than in a
 * module-level `let`. That is not paranoia: Next.js can and does place a server
 * action's module and the module that wired it in different bundles, and two
 * copies of a module-level binding is a failure that only shows up in a
 * production build. A realm-wide symbol has exactly one copy.
 */

export type ExplorerScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/**
 * The slice of `@lastest/kernel`'s `PluginRuntime` explorer uses.
 *
 * Structural rather than imported so the plugin does not have to depend on the
 * kernel's concrete runtime type just to be handed a context.
 */
export interface ExplorerRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: ExplorerScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface ExplorerWiring {
  readonly runtime: ExplorerRuntime;
  readonly host: ExplorerHost;
  /**
   * The same handle `ctx.data` carries.
   *
   * Duplicated here for one caller: the deletion hook. It runs *because* a team
   * was deleted, so there is no scope left to build a context from — asking
   * `contextFor({ teamId })` to resolve a team that no longer exists is a
   * circular requirement, not an oversight.
   */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.explorer.wiring");

type Carrier = typeof globalThis & { [SLOT]?: ExplorerWiring };

export function configureExplorer(wiring: ExplorerWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function explorerWiring(): ExplorerWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The explorer plugin is not wired. The composition root must call " +
        "configureExplorer({ runtime, host }) before any explorer action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isExplorerConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
