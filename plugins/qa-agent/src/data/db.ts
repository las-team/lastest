import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";

/**
 * Getting a typed query surface out of `ctx.data` (or the wiring slot's
 * handle — they are the same object).
 *
 * Same cast, same reasoning, same concentration-in-one-function as
 * `plugins/explorer/src/data/db.ts` — read the gap it records there:
 * `CapabilityMap.data` is `DataCapability<unknown>`, so the properly-typed
 * `ScopedDatabase` `core/data` hands over at runtime has to be asserted back.
 * When `PluginContext` grows a schema parameter, one function changes.
 */
export type QaAgentSchema = typeof schema;
export type QaAgentDb = ScopedDatabase<QaAgentSchema>["orm"];

export function orm(data: DataCapability): QaAgentDb {
  return (data.db as unknown as ScopedDatabase<QaAgentSchema>).orm;
}

export { schema };
