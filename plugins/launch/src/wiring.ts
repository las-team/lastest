import type { DataCapability } from "@lastest/contracts";

import type { LaunchHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Same realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under Next.js
 * bundling.
 *
 * ### No `runtime` here, and that is the interesting part
 *
 * Every other plugin's wiring carries a `runtime` so it can call
 * `contextFor(manifest, { repositoryId })` and be handed a `ctx` scoped to a
 * team. Launch cannot: there is no team anywhere in this feature. The board is
 * a public directory, its readers are anonymous, and its writers are
 * identified by a user id and an OAuth scope — never by a tenant.
 *
 * So launch takes the `DataCapability` directly, the way every plugin's
 * *deletion hook* already does (a hook runs because a team was deleted, so it
 * too has no scope to build a context from). The precedent existed; this is
 * the first plugin where it is the only path rather than the exception.
 *
 * What that costs is stated plainly in `index.ts`: `ctx.team` would have been
 * a lie here, so the plugin does not get one, and nothing in core is checking
 * a tenant on its behalf. What it does *not* cost is the data boundary — the
 * handle below is still the schema-scoped one `core/data` built after
 * validating the `launch_` prefix on all seven tables, so this plugin can
 * reach its own tables and nothing else.
 *
 * The missing `runtime` used to be the *only* record of any of this. It is not
 * any more: the manifest declares `tenancy: "none"`, `resolveRegistry`
 * enforces what that implies, and `buildContext` throws if a context is ever
 * built for this plugin anyway. That core change landed with the second
 * untenanted plugin (`@lastest/plugin-playground`), which is what this file
 * used to ask for.
 */

export interface LaunchWiring {
  readonly host: LaunchHost;
  /** Scoped to this plugin's tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.launch.wiring");

type Carrier = typeof globalThis & { [SLOT]?: LaunchWiring };

export function configureLaunch(wiring: LaunchWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function launchWiring(): LaunchWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The launch plugin is not wired. The composition root must call " +
        "configureLaunch({ host, data }) before any launch request is served.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isLaunchConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
