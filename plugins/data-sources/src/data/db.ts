import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { dataSourcesWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * shape as `plugins/ci/src/data/db.ts`.
 *
 * Two entry points: `orm(ctx.data)` from a server action (context built from
 * the caller's session), and `db()` from the deletion hook, which has no
 * session to build a context from and takes the handle straight from the
 * wiring slot.
 */
export type DataSourcesSchema = typeof schema;
export type DataSourcesDb = ScopedDatabase<DataSourcesSchema>["orm"];

export function orm(data: DataCapability): DataSourcesDb {
  return (data.db as unknown as ScopedDatabase<DataSourcesSchema>).orm;
}

export function db(): DataSourcesDb {
  return orm(dataSourcesWiring().data);
}

export { schema };
