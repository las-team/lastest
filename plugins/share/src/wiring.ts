import type { DataCapability } from "@lastest/contracts";

import type { ShareHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it. Same
 * realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under
 * Next.js bundling.
 *
 * ### `data`, no `runtime` — despite this plugin being team-tenanted
 *
 * Every prior tenanted-with-storage plugin (`a11y`, `explorer`, `ci`) wires
 * both a `runtime` (for `contextFor()`) and `data`. This one wires only
 * `data`, and that is a deliberate divergence, not an oversight:
 * `PluginContext` carries `team: TeamRef` (id, plan, entitlements) and
 * `repo?: RepoRef` (id, teamId, name, defaultBranch) — no user id, no team
 * name, no repo full name. Every write this plugin does
 * (`publishBuildShare`'s Discord ping, `claimPublicShare`'s idempotent-repo
 * lookup by name) needs at least one of those missing fields, so
 * `contextFor()` would still have to be followed by a second host call to
 * fill the gap. `ShareHost.requireRepoAccess` / `requireTeamAccess` do the
 * authorization AND the enrichment in that one call instead — see `host.ts`.
 *
 * The tenancy is real (`index.ts` does not declare `tenancy: "none"`; this
 * plugin's rows carry an `ownerTeamId`), so `deletion.ts` still gets
 * `onTeamDeleted`/`onRepoDeleted`, not `onUserDeleted`. What differs from
 * `a11y` is only *how* an action gets authorized — through the host, not
 * through the kernel's `resolveScope` — because the host already has to
 * exist for the actor-enrichment gap above.
 */
export interface ShareWiring {
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
        "configureShare({ host, data }) before any share action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isShareConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
