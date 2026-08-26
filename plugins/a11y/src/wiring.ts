import type {
  CapabilityName,
  DataCapability,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

/**
 * How the plugin reaches the runtime it was wired into. Same realm-wide
 * `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read that file's
 * comment for why a module-level `let` is not enough under Next.js bundling.
 */

export type A11yScopeRequest = {
  readonly repositoryId?: string;
  readonly teamId?: string;
};

/** The slice of `@lastest/kernel`'s `PluginRuntime` this plugin uses. */
export interface A11yRuntime {
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: A11yScopeRequest,
  ): Promise<PluginContext<C>>;
}

export interface A11yWiring {
  readonly runtime: A11yRuntime;
  /**
   * The same handle `ctx.data` carries, duplicated for the deletion hook —
   * it runs *because* a team was deleted, so there is no scope left to build
   * a context from. See `plugins/explorer/src/wiring.ts`.
   */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.a11y.wiring");

type Carrier = typeof globalThis & { [SLOT]?: A11yWiring };

export function configureA11y(wiring: A11yWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function a11yWiring(): A11yWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The a11y plugin is not wired. The composition root must call " +
        "configureA11y({ runtime, data }) before any a11y action runs.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isA11yConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
