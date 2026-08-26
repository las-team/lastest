import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { awardsWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * cast, same reason as `plugins/gamification/src/data/db.ts`.
 */
export type AwardsSchema = typeof schema;
export type AwardsDb = ScopedDatabase<AwardsSchema>["orm"];

export function orm(data: DataCapability): AwardsDb {
  return (data.db as unknown as ScopedDatabase<AwardsSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): AwardsDb {
  return orm(awardsWiring().data);
}

export { schema };
