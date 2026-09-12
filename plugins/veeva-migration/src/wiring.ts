import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { ConnectorApiDefaults } from "./connector-shapes";
import type { VeevaMigrationHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Realm-wide `Symbol.for` slot — same reason as every other plugin's wiring
 * (`plugins/explorer/src/wiring.ts`): a server action's module and the module
 * that wired it can land in different bundles.
 *
 * Server actions call `runtime.contextFor(veevaMigrationPlugin, { repositoryId })`
 * for repo-scoped work. The deletion hook and the job handler have no session
 * to build a context from and take `data` straight from this slot, the same
 * route every other plugin's hook takes.
 */

export type VeevaMigrationScopeRequest = {
  readonly repositoryId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface VeevaMigrationRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: VeevaMigrationScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface VeevaMigrationWiring {
  readonly runtime: VeevaMigrationRuntime;
  readonly host: VeevaMigrationHost;
  /** Scoped to this plugin's own tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
  /**
   * Fallback connector API versions, from core's own constants.
   *
   * Injected rather than duplicated in the package or fetched through a port
   * method — see the note in `connector-shapes.ts`.
   */
  readonly connectorDefaults: ConnectorApiDefaults;
}

const SLOT = Symbol.for("lastest.plugin.veeva-migration.wiring");

type Carrier = typeof globalThis & { [SLOT]?: VeevaMigrationWiring };

export function configureVeevaMigration(wiring: VeevaMigrationWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function veevaMigrationWiring(): VeevaMigrationWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The veeva-migration plugin is not wired. The composition root must call " +
        "configureVeevaMigration({ runtime, host, data, connectorDefaults }) " +
        "before any " +
        "veeva-migration action runs.",
    );
  }
  return wiring;
}
