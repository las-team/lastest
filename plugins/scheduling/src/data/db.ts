import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { schedulingWiring } from "../wiring";

/**
 * Getting a typed query surface out of `ctx.data`. Same cast, same reason as
 * `plugins/ranger/src/data/db.ts`: `CapabilityMap.data` is
 * `DataCapability<unknown>`, so `ctx.data.db.schema` is `unknown` and this is
 * the mitigation available today.
 */
export type SchedulingSchema = typeof schema;
export type SchedulingDb = ScopedDatabase<SchedulingSchema>["orm"];

export function orm(data: DataCapability): SchedulingDb {
  return (data.db as unknown as ScopedDatabase<SchedulingSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. Used by
 *  the deletion hook and by `dispatchDueSchedules`, neither of which has a
 *  `ctx` to pull a `DataCapability` from. */
export function db(): SchedulingDb {
  return orm(schedulingWiring().data);
}

export { schema };
