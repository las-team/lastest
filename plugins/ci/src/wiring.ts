import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { CiHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Realm-wide `Symbol.for` slot, for the reason `plugins/explorer/src/wiring.ts`
 * documents: Next.js can place a server action's module and the module that
 * wired it in different bundles, and two copies of a module-level `let` is a
 * failure that only shows up in a production build.
 *
 * ### Both a `runtime` and a `data`, which is new
 *
 * Previous plugins took one or the other. `explorer` takes both, but for the
 * usual reason (a deletion hook runs outside any scope). This one takes both
 * because it is genuinely entered two ways:
 *
 * - **Server actions** call `runtime.contextFor(ciPlugin)` with **no scope
 *   request at all**. That is the first time a migrated plugin has done so, and
 *   it is the cheapest correct thing available: `resolveScope` falls through to
 *   the app's `requireTeamAccess()`, so `ctx.team.id` is a session-authorized
 *   tenant that no argument influenced. `app-map` and `explorer` pass a
 *   `repositoryId` because their work hangs off a repo; CI configs hang off a
 *   *team*, and the team is the session's. The saving is real — "who is
 *   calling" is not a host method here, only "are they an admin" is.
 * - **The deletion hook and the GitLab webhook gate** have no session to build
 *   a context from — one runs because a tenant was deleted, the other because a
 *   third party posted to a public URL. Both take the `DataCapability` straight
 *   from this slot, the same route every plugin's deletion hook already takes.
 */

export type CiScopeRequest = {
  readonly teamId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface CiRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: CiScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface CiWiring {
  readonly runtime: CiRuntime;
  readonly host: CiHost;
  /** Scoped to this plugin's two tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.ci.wiring");

type Carrier = typeof globalThis & { [SLOT]?: CiWiring };

export function configureCi(wiring: CiWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function ciWiring(): CiWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The ci plugin is not wired. The composition root must call " +
        "configureCi({ runtime, host, data }) before any CI action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isCiConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
