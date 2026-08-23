import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { AuthoringAiHost } from "./host";

/**
 * How the plugin reaches what it was wired with.
 *
 * Same arrangement as `plugins/rca/src/wiring.ts` and
 * `plugins/explorer/src/wiring.ts`: a plugin's `"use server"` module is
 * imported by Next.js rather than constructed, so there is no moment at
 * which to pass it arguments. `configureAuthoringAi()` is called once by
 * the composition root (`src/lib/core/runtime.ts`) and the actions read
 * what it left.
 *
 * The slot is a realm-wide `Symbol.for` key on `globalThis`, not a
 * module-level `let` — Next.js can place a server action's module and the
 * module that wired it in different bundles, and two copies of a
 * module-level binding is a failure that only shows up in a production
 * build.
 *
 * Owns no tables, so — like `rca` — there is no `data` handle to carry.
 */

export type AuthoringAiScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

export interface AuthoringAiRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: AuthoringAiScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface AuthoringAiWiring {
  readonly runtime: AuthoringAiRuntime;
  readonly host: AuthoringAiHost;
}

const SLOT = Symbol.for("lastest.plugin.authoring-ai.wiring");

type Carrier = typeof globalThis & { [SLOT]?: AuthoringAiWiring };

export function configureAuthoringAi(wiring: AuthoringAiWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function authoringAiWiring(): AuthoringAiWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The authoring-ai plugin is not wired. The composition root must call " +
        "configureAuthoringAi({ runtime, host }) before any authoring-ai " +
        "action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isAuthoringAiConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
