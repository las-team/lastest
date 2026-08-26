import type { RecorderHost } from "./host";

/**
 * Same pattern as `plugins/design-system/src/wiring.ts`: this plugin declares
 * no `capabilities` (every action goes through `RecorderHost`, which itself
 * carries the auth guard — see `host.ts`), so there is no `runtime`/`data` to
 * carry, just the host. A realm-wide `Symbol.for` slot survives Next.js
 * placing this module and the composition root that wires it in different
 * bundles; a module-level `let` would not.
 */
const SLOT = Symbol.for("lastest.plugin.recorder.host");

type Carrier = typeof globalThis & { [SLOT]?: RecorderHost };

export function configureRecorder(host: RecorderHost): void {
  (globalThis as Carrier)[SLOT] = host;
}

export function recorderHost(): RecorderHost {
  const host = (globalThis as Carrier)[SLOT];
  if (!host) {
    throw new Error(
      "The recorder plugin is not wired. The composition root must call " +
        "configureRecorder(host) before any recorder action runs.",
    );
  }
  return host;
}

/** True when wiring is present. Lets a UI path degrade instead of throwing. */
export function isRecorderConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
