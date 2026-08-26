import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { QaAgentHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * Copies `plugins/explorer/src/wiring.ts`'s shape exactly — host + runtime +
 * data — because qa-agent has all three of explorer's needs: actions that
 * resolve a scope through `contextFor`, a host port, and callers with no
 * session at all (the deletion hook, the scheduler-tick trigger dispatcher,
 * and the server-component reads in `reads.ts`) that take the data handle
 * straight from the slot.
 *
 * The slot lives on `globalThis` behind a `Symbol.for` key rather than in a
 * module-level `let`. Next.js can place a server action's module and the
 * module that wired it in different bundles, and two copies of a module-level
 * binding is a failure that only shows up in a production build. A realm-wide
 * symbol has exactly one copy.
 */

export type QaAgentScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/**
 * The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses.
 * Structural rather than imported so the plugin does not depend on the
 * kernel's concrete runtime type just to be handed a context.
 */
export interface QaAgentRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: QaAgentScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface QaAgentWiring {
  readonly runtime: QaAgentRuntime;
  readonly host: QaAgentHost;
  /**
   * The same handle `ctx.data` carries. Duplicated here for the callers that
   * run with no session to build a context from: the deletion hook (the team
   * it would scope to has just been deleted), `dispatchDueQaTriggers` (a
   * scheduler tick), and the `reads.ts` server-component reads (authorized by
   * the page/route that calls them, same as `share-reads.ts`).
   */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.qa-agent.wiring");

type Carrier = typeof globalThis & { [SLOT]?: QaAgentWiring };

export function configureQaAgent(wiring: QaAgentWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function qaAgentWiring(): QaAgentWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The qa-agent plugin is not wired. The composition root must call " +
        "configureQaAgent({ runtime, host, data }) before any qa-agent action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isQaAgentConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
