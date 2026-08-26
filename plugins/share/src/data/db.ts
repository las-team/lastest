import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { shareWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * cast, same reason as `plugins/explorer/src/data/db.ts` — read that file's
 * comment for the gap in `CapabilityMap.data` this works around.
 */
export type ShareSchema = typeof schema;
export type ShareDb = ScopedDatabase<ShareSchema>["orm"];

export function orm(data: DataCapability): ShareDb {
  return (data.db as unknown as ScopedDatabase<ShareSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): ShareDb {
  return orm(shareWiring().data);
}

export { schema };
