import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { ShareHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it. Same
 * realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under
 * Next.js bundling.
 *
 * ### The standard tenanted shape: `runtime` + `host` + `data`
 *
 * This plugin used to wire only `host` + `data` and authorize through host
 * methods (`ShareHost.requireRepoAccess`/`requireTeamAccess`) because
 * `PluginContext` carried less than those returned — no user id or email, no
 * team name or slug. `ctx.actor` and the enriched `TeamRef` closed that gap,
 * so its actions now authorize the same way `ci`/`explorer` do: through
 * `runtime.contextFor()`, with `requireActor(ctx)` asserting the session.
 * The `data` handle beside it is for the callers with no scope to build a
 * context from — the deletion hook and the anonymous `/r/<slug>` reads.
 */

export type ShareScopeRequest = {
  readonly repositoryId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface ShareRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: ShareScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface ShareWiring {
  readonly runtime: ShareRuntime;
  readonly host: ShareHost;
  /** Scoped to this plugin's table by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.share.wiring");

type Carrier = typeof globalThis & { [SLOT]?: ShareWiring };

export function configureShare(wiring: ShareWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function shareWiring(): ShareWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The share plugin is not wired. The composition root must call " +
        "configureShare({ runtime, host, data }) before any share action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isShareConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
