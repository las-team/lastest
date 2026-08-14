import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { gamificationWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * cast, same reason as `plugins/explorer/src/data/db.ts`.
 *
 * `db()` takes no argument because this plugin never builds a `ctx` — see
 * `../wiring.ts`. The scoping that matters is still done: `core/data` bound
 * this handle to the six `gamification_`-prefixed tables and nothing else, so
 * even though the feature is team-scoped in its own columns, it cannot reach a
 * core table to widen that.
 */
export type GamificationSchema = typeof schema;
export type GamificationDb = ScopedDatabase<GamificationSchema>["orm"];

export function orm(data: DataCapability): GamificationDb {
  return (data.db as unknown as ScopedDatabase<GamificationSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): GamificationDb {
  return orm(gamificationWiring().data);
}

export { schema };
