import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { AppMapHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * A plugin's `"use server"` module is imported by Next.js, not constructed by
 * anyone, so there is nowhere to pass constructor arguments. `configureAppMap`
 * is called once by the composition root (`src/lib/core/runtime.ts`) and the
 * actions read what it left.
 *
 * The slot is a realm-wide `Symbol.for` key on `globalThis` rather than a
 * module-level `let` — see `plugins/explorer/src/wiring.ts` for why (Next.js
 * can place a server action's module and the module that wired it in different
 * bundles, and two copies of a module-level binding is a failure that only
 * appears in a production build).
 *
 * No `data` field here, unlike explorer and a11y: App Map owns no tables, so
 * there is no deletion hook that would need a handle outside a scope.
 */

export type AppMapScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface AppMapRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: AppMapScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface AppMapWiring {
  readonly runtime: AppMapRuntime;
  readonly host: AppMapHost;
}

const SLOT = Symbol.for("lastest.plugin.app-map.wiring");

type Carrier = typeof globalThis & { [SLOT]?: AppMapWiring };

export function configureAppMap(wiring: AppMapWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function appMapWiring(): AppMapWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The app-map plugin is not wired. The composition root must call " +
        "configureAppMap({ runtime, host }) before any app-map action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isAppMapConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
