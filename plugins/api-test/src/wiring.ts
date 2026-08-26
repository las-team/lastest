import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import type { ApiTestHost } from "./host";

/**
 * How the plugin reaches the runtime it was wired into.
 *
 * A plugin's `"use server"` module is imported by Next.js, not constructed by
 * anyone, so there is nowhere to pass constructor arguments. `configureApiTest`
 * is called once by the composition root (`src/lib/core/runtime.ts`) and the
 * actions read what it left.
 *
 * The slot is a realm-wide `Symbol.for` key on `globalThis` rather than a
 * module-level `let` — see `plugins/explorer/src/wiring.ts` for why (Next.js
 * can place a server action's module and the module that wired it in different
 * bundles, and two copies of a module-level binding is a failure that only
 * appears in a production build).
 *
 * No `data` field: API tests are rows in the core `tests` table, so this plugin
 * owns no storage, has no `schema` and therefore no deletion hook.
 *
 * ### The runner does not use this
 *
 * `runApiTest` takes its `ApiTestHost` as an *argument*, the way
 * `plugins/app-map`'s `buildAppMap` does, and never touches the slot. That is
 * not a stylistic preference: its only caller is core's executor
 * (`src/lib/execution/executor.ts`), on the hot path of every build, and
 * reading the slot would have made a test run depend on the plugin runtime
 * having been booted. Injection keeps the executor's dependency a plain import
 * of `src/lib/core/api-test-host.ts`.
 */

export type ApiTestScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface ApiTestRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: ApiTestScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface ApiTestWiring {
  readonly runtime: ApiTestRuntime;
  readonly host: ApiTestHost;
}

const SLOT = Symbol.for("lastest.plugin.api-test.wiring");

type Carrier = typeof globalThis & { [SLOT]?: ApiTestWiring };

export function configureApiTest(wiring: ApiTestWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function apiTestWiring(): ApiTestWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The api-test plugin is not wired. The composition root must call " +
        "configureApiTest({ runtime, host }) before any api-test action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isApiTestConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
