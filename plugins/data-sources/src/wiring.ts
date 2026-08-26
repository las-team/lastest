import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";
import type { StorageHost } from "@lastest/core-storage";

import type { DataSourcesHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Realm-wide `Symbol.for` slot — same reason as every other plugin's wiring
 * (`plugins/explorer/src/wiring.ts`): a server action's module and the module
 * that wired it can land in different bundles.
 *
 * Three things, not two. Server actions call `runtime.contextFor(
 * dataSourcesPlugin, { repositoryId })` for repo-scoped operations (CSV
 * upload/sync, sheet import), or with no scope request for team-scoped ones
 * (list/connect/disconnect the Google account) — the same `contextFor`
 * pattern `ci`/`explorer` use, see `host.ts`. The deletion hook has no
 * session, so it takes `data` straight from this slot, same as every other
 * plugin's hook. `storageHost` is the odd one out: this is the **first**
 * plugin to declare `capabilities: ["storage"]`, and nothing yet reaps a
 * team's storage prefix when the team is deleted (`ctx.storage` is
 * team-scoped only inside a built `PluginContext`, and the deletion hook has
 * none). `deletion.ts` builds a scoped `StorageCapability` from this raw host
 * on demand, once it knows the team id it is deleting for — see the note
 * there.
 */

export type DataSourcesScopeRequest = {
  readonly repositoryId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface DataSourcesRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: DataSourcesScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface DataSourcesWiring {
  readonly runtime: DataSourcesRuntime;
  readonly host: DataSourcesHost;
  /** Scoped to this plugin's two tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
  /** Raw storage host, for the deletion hook's team-scoped cleanup. */
  readonly storageHost: StorageHost;
}

const SLOT = Symbol.for("lastest.plugin.data-sources.wiring");

type Carrier = typeof globalThis & { [SLOT]?: DataSourcesWiring };

export function configureDataSources(wiring: DataSourcesWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function dataSourcesWiring(): DataSourcesWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The data-sources plugin is not wired. The composition root must call " +
        "configureDataSources({ runtime, host, data, storageHost }) before any " +
        "data-sources action runs.",
    );
  }
  return wiring;
}
