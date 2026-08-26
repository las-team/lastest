import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { GamificationHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Same realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under Next.js
 * bundling.
 *
 * ### The standard tenanted shape: `runtime` + `host` + `data`
 *
 * The `runtime` serves the session paths — the viewer's score card and the
 * `onTestCreated` listener resolve "who is calling" through
 * `contextFor(gamificationPlugin)` (`ctx.actor` + `ctx.team`), which retired
 * the host's `currentActor` method. `requireTeamAdmin` stays on the host:
 * RBAC is deliberately not on `PluginContext` (recipe §1.7).
 *
 * The bare `data` handle serves the callers with no session to build a
 * context from. Chief among them is `awardScore()`, invoked from six app call
 * sites that have *already* authorized a team and pass its id in — a diff
 * being approved, a build finishing. Building a `ctx` for those would mean
 * handing `contextFor({ teamId })` a request-supplied id, and
 * `core/kernel/src/runtime.ts` documents that field as background-paths-only
 * for exactly the reason it would be wrong here: "honouring it from a user
 * request would be a tenancy escape". So on those paths the tenancy
 * guarantee stays with the caller that did `requireTeamAccess()` — the same
 * arrangement as before the migration, and the same route every plugin's
 * deletion hook takes.
 */

export type GamificationScopeRequest = {
  readonly repositoryId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface GamificationRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: GamificationScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface GamificationWiring {
  readonly runtime: GamificationRuntime;
  readonly host: GamificationHost;
  /** Scoped to this plugin's six tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.gamification.wiring");

type Carrier = typeof globalThis & { [SLOT]?: GamificationWiring };

export function configureGamification(wiring: GamificationWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function gamificationWiring(): GamificationWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The gamification plugin is not wired. The composition root must call " +
        "configureGamification({ runtime, host, data }) before any scoring call.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isGamificationConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
