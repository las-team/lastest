import type { DataCapability } from "@lastest/contracts";

import type { PlaygroundHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Same realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under Next.js
 * bundling.
 *
 * ### No `runtime`, and now that is a declared fact rather than an omission
 *
 * Like `launch`, the playground takes its `DataCapability` straight from this
 * slot and never calls `contextFor`. There is no team in the feature: the
 * leaderboard is public, writers are identified by a user id and an OAuth
 * scope, and `playground_achievements` has no `team_id` column to scope by.
 *
 * What changed between the two plugins is that this is no longer signalled
 * only by the *absence* of a `runtime` here. The manifest says
 * `tenancy: "none"`, `resolveRegistry` refuses any capability beyond `data`
 * for such a plugin, and `buildContext` throws `UntenantedPluginError` if
 * anything ever hands one a scope anyway. Launch's migration noted that the
 * missing `runtime` was the only signal and that a second untenanted plugin
 * should make it explicit in the kernel first; that core change landed ahead
 * of this one.
 *
 * The data boundary is unaffected either way: the handle below is the
 * schema-scoped one `core/data` built after validating the `playground_`
 * prefix, so this plugin can reach its own table and nothing else.
 */

export interface PlaygroundWiring {
  readonly host: PlaygroundHost;
  /** Scoped to this plugin's table by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.playground.wiring");

type Carrier = typeof globalThis & { [SLOT]?: PlaygroundWiring };

export function configurePlayground(wiring: PlaygroundWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function playgroundWiring(): PlaygroundWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The playground plugin is not wired. The composition root must call " +
        "configurePlayground({ host, data }) before any playground request is served.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isPlaygroundConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
