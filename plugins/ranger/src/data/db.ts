import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";

/**
 * Getting a typed query surface out of `ctx.data`.
 *
 * Same gap `plugins/explorer/src/data/db.ts` documents: `CapabilityMap.data`
 * is `DataCapability<unknown>`, so `ctx.data.db.schema` is `unknown` and the
 * cast below is the mitigation available today. Concentrated here rather than
 * at every call site so the fix (parameterising `PluginContext`, a core PR)
 * only has to change one function.
 */
export type RangerSchema = typeof schema;
export type RangerDb = ScopedDatabase<RangerSchema>["orm"];

export function orm(data: DataCapability): RangerDb {
  return (data.db as unknown as ScopedDatabase<RangerSchema>).orm;
}

export { schema };
