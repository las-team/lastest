import type { EventsHost } from "./host";

/**
 * Same pattern as `plugins/explorer/src/wiring.ts`, for the same reason: the
 * kernel calls `implement.events(scope)` directly — there is no constructor
 * call site to hand a host to — so the host has to live somewhere the
 * capability factory can reach at call time. A realm-wide `Symbol.for` slot
 * survives Next.js placing this module and the composition root that wires it
 * in different bundles; a module-level `let` would not.
 */
const SLOT = Symbol.for("lastest.plugin.events.host");

type Carrier = typeof globalThis & { [SLOT]?: EventsHost };

export function configureEvents(host: EventsHost): void {
  (globalThis as Carrier)[SLOT] = host;
}

export function eventsHost(): EventsHost {
  const host = (globalThis as Carrier)[SLOT];
  if (!host) {
    throw new Error(
      "The events plugin is not wired. The composition root must call " +
        "configureEvents(host) before any consumer's context is built.",
    );
  }
  return host;
}
