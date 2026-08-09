import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";

/**
 * Getting a typed query surface out of `ctx.data`.
 *
 * ### A gap worth recording
 *
 * `CapabilityMap.data` in `@lastest/contracts` is declared as `DataCapability`,
 * i.e. `DataCapability<unknown>`. `PluginContext` has no type parameter for a
 * plugin's schema, so `ctx.data.db.schema` is `unknown` and the interface
 * offers only `.transaction`. There is no way for a plugin to reach a query
 * builder through the contract as written.
 *
 * `core/data` *does* hand over a properly-typed `ScopedDatabase` at runtime —
 * its own doc comment promises exactly that — so the cast below is sound. But
 * it is a cast, and it is the one place in this plugin where the type system
 * stops helping. The fix belongs in core: either parameterise
 * `PluginContext<C, TSchema>`, or have `definePlugin` infer the schema from the
 * manifest's `schema()` and thread it through. Both are core PRs.
 *
 * Concentrating the cast here rather than at forty call sites is the mitigation
 * available today: when core is fixed, one function changes.
 */
export type ExplorerSchema = typeof schema;
export type ExplorerDb = ScopedDatabase<ExplorerSchema>["orm"];

export function orm(data: DataCapability): ExplorerDb {
  return (data.db as unknown as ScopedDatabase<ExplorerSchema>).orm;
}

export { schema };
