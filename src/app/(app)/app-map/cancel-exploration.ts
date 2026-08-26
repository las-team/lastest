"use server";

import { cancelQaAgent } from "@lastest/plugin-qa-agent/actions";

/**
 * Stop a running exploration.
 *
 * A one-line wrapper, and it exists for a specific reason: `@lastest/plugin-
 * app-map` may not import another plugin's actions, so the *app* has to be
 * the one holding that reference and hand the function down. Declared as a
 * wrapper rather than `export { cancelQaAgent } from "…"` because a re-export
 * inside a `"use server"` module compiles to a module with no exports at all
 * (spike S1).
 *
 * Its lifetime is tied to `AppMapHost`'s three qa-agent seams: if those ever
 * become a `ctx.jobs` dispatch (see the note in `app-map-host.ts`), this
 * file goes with them.
 */
export async function cancelExploration(sessionId: string): Promise<void> {
  await cancelQaAgent(sessionId);
}
