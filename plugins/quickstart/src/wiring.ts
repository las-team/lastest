import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { QuickstartHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * Copies `plugins/ci/src/wiring.ts`'s shape exactly: tenanted (every action
 * runs against a repository) *and* wired with a `runtime`, so `contextFor`
 * does the auth work `requireRepoAccess`/`requireTeamAccess` used to do
 * inline. `configureQuickstart()` is called once by the composition root
 * (`src/lib/core/runtime.ts`); the slot is a realm-wide `Symbol.for` key
 * rather than a module-level `let` for the reason every other plugin's
 * wiring file states — Next.js can place a server action's module and the
 * module that wired it in different bundles.
 */

export type QuickstartScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

export interface QuickstartRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: QuickstartScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface QuickstartWiring {
  readonly runtime: QuickstartRuntime;
  readonly host: QuickstartHost;
}

const SLOT = Symbol.for("lastest.plugin.quickstart.wiring");

type Carrier = typeof globalThis & { [SLOT]?: QuickstartWiring };

export function configureQuickstart(wiring: QuickstartWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function quickstartWiring(): QuickstartWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The quickstart plugin is not wired. The composition root must call " +
        "configureQuickstart({ runtime, host }) before any quickstart action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isQuickstartConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
