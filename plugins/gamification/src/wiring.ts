import type { DataCapability } from "@lastest/contracts";

import type { GamificationHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it.
 *
 * Same realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under Next.js
 * bundling.
 *
 * ### No `runtime`, but this plugin *is* tenanted
 *
 * `launch` and `playground` take this route because they have no tenant at all
 * (`tenancy: "none"`). Beat-the-Bot is the opposite: every one of its six
 * tables carries a `team_id`, and every read and write is scoped by one. It
 * still takes its `DataCapability` straight from the slot rather than building
 * a `PluginContext`, for a reason specific to how it is called.
 *
 * `awardScore()` is invoked from six app call sites that have *already*
 * authorized a team and pass its id in — a diff being approved, a review todo
 * being resolved, a build finishing. Building a `ctx` for those would mean
 * handing `contextFor({ teamId })` a request-supplied id, and
 * `core/kernel/src/runtime.ts` documents that field as background-paths-only
 * for exactly the reason it would be wrong here: "honouring it from a user
 * request would be a tenancy escape".
 *
 * So the tenancy guarantee stays where it already was — with the caller that
 * did `requireTeamAccess()` — and this plugin receives a team id it treats as
 * authorized, which is precisely what the pre-migration `awardScore(input)`
 * did. That is a preserved arrangement, not a new one, and `host.ts` says what
 * it costs: no `ctx.events`.
 */

export interface GamificationWiring {
  readonly host: GamificationHost;
  /** Scoped to this plugin's six tables by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.gamification.wiring");

type Carrier = typeof globalThis & { [SLOT]?: GamificationWiring };

export function configureGamification(wiring: GamificationWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function gamificationWiring(): GamificationWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The gamification plugin is not wired. The composition root must call " +
        "configureGamification({ host, data }) before any scoring call.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isGamificationConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
