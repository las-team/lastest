import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { launchWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * cast, same reason as `plugins/explorer/src/data/db.ts` — read that file's
 * comment for the gap in `CapabilityMap.data` this works around.
 *
 * `db()` takes no argument because launch has no `ctx`: there is no team to
 * scope a context to (see `../wiring.ts`), so the handle comes straight from
 * the wiring slot. The scoping that matters is still done — `core/data` bound
 * this handle to the seven `launch_`-prefixed tables and nothing else.
 */
export type LaunchSchema = typeof schema;
export type LaunchDb = ScopedDatabase<LaunchSchema>["orm"];

export function orm(data: DataCapability): LaunchDb {
  return (data.db as unknown as ScopedDatabase<LaunchSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): LaunchDb {
  return orm(launchWiring().data);
}

export { schema };
