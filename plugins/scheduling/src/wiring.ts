import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { SchedulingHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * Copies `plugins/ranger/src/wiring.ts` exactly, including the reasoning: a
 * plugin's `"use server"` module is imported by Next.js, not constructed, so
 * `configureScheduling()` is called once by the composition root
 * (`src/lib/core/runtime.ts`) and the actions read what it left. The slot is
 * a realm-wide `Symbol.for` key rather than a module-level `let` because
 * Next.js can place a server action's module and the module that wired it in
 * different bundles.
 */

export type SchedulingScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/** Structural, not imported, so this plugin does not depend on the kernel's
 *  concrete runtime type just to be handed a context. */
export interface SchedulingRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: SchedulingScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface SchedulingWiring {
  readonly runtime: SchedulingRuntime;
  readonly host: SchedulingHost;
  /**
   * The same handle `ctx.data` carries. Duplicated here for two callers with
   * no session and so no scope to build a context from: the deletion hook
   * (a repo was just deleted) and `dispatchDueSchedules` (a cron tick, not a
   * request) — the same shape `explorer`'s `dispatchDueExplorerTriggers`
   * uses, except that one still calls `contextFor` per-trigger with the
   * trigger's own `teamId`. This plugin does not need to: triggering a build
   * needs no `ctx.team`/`ctx.repo`, only the schedule row's own
   * `repositoryId`, which was already authorized when the schedule was
   * created.
   */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.scheduling.wiring");

type Carrier = typeof globalThis & { [SLOT]?: SchedulingWiring };

export function configureScheduling(wiring: SchedulingWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function schedulingWiring(): SchedulingWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The scheduling plugin is not wired. The composition root must call " +
        "configureScheduling({ runtime, host, data }) before any scheduling call.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isSchedulingConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
