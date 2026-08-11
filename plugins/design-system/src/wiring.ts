import type { DesignSystemHost } from "./host";

/**
 * Same pattern as `plugins/events/src/wiring.ts`: this plugin declares no
 * `capabilities`/`provides` (it needs no `ctx` — every action goes through
 * `DesignSystemHost`), so there is no `runtime`/`data` to carry, just the
 * host. A realm-wide `Symbol.for` slot survives Next.js placing this module
 * and the composition root that wires it in different bundles; a
 * module-level `let` would not.
 */
const SLOT = Symbol.for("lastest.plugin.design-system.host");

type Carrier = typeof globalThis & { [SLOT]?: DesignSystemHost };

export function configureDesignSystem(host: DesignSystemHost): void {
  (globalThis as Carrier)[SLOT] = host;
}

export function designSystemHost(): DesignSystemHost {
  const host = (globalThis as Carrier)[SLOT];
  if (!host) {
    throw new Error(
      "The design-system plugin is not wired. The composition root must " +
        "call configureDesignSystem(host) before any design-system action runs.",
    );
  }
  return host;
}
