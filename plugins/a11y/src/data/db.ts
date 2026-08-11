import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";

/**
 * Getting a typed query surface out of `ctx.data`. Same cast, same reason as
 * `plugins/explorer/src/data/db.ts` — read that file's comment for the gap in
 * `CapabilityMap.data` this works around, and why concentrating the cast in
 * one function is the mitigation available until core is fixed.
 */
export type A11ySchema = typeof schema;
export type A11yDb = ScopedDatabase<A11ySchema>["orm"];

export function orm(data: DataCapability): A11yDb {
  return (data.db as unknown as ScopedDatabase<A11ySchema>).orm;
}

export { schema };
