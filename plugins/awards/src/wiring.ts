import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { AwardsHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it. Same
 * realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under
 * Next.js bundling.
 *
 * ### The standard tenanted shape: `runtime` + `host` + `data`
 *
 * `awards_repo_awards` rows genuinely belong to a tenant (`repositoryId`,
 * cascading from a team-owned repo). The `runtime` serves the one session
 * path — `getTeamTrophyRoom` resolves its own scope through
 * `contextFor(awardsPlugin)` instead of trusting a caller-passed team id.
 * The bare `data` handle serves the two paths that have no session to build
 * a context from, the same route every plugin's deletion hook takes:
 *
 * - `recomputeRepoAward(repositoryId)` runs from `builds.ts` after a build
 *   completes, with a `repositoryId` the executor already resolved.
 * - `getRepoAwardBySlug(slug)` runs from the public badge route and from
 *   `ShareHost.getRepoAward` — both deliberately anonymous. A `ctx` would
 *   have nothing to authorize against.
 */
export interface AwardsWiring {
  readonly runtime: AwardsRuntime;
  readonly host: AwardsHost;
  /** Scoped to this plugin's one table by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface AwardsRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
  ): Promise<PluginContext<C>>;
}

const SLOT = Symbol.for("lastest.plugin.awards.wiring");

type Carrier = typeof globalThis & { [SLOT]?: AwardsWiring };

export function configureAwards(wiring: AwardsWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function awardsWiring(): AwardsWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The awards plugin is not wired. The composition root must call " +
        "configureAwards({ runtime, host, data }) before any awards call.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isAwardsConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
