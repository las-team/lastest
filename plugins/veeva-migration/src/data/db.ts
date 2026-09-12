import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { veevaMigrationWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same shape
 * as `plugins/data-sources/src/data/db.ts` and `plugins/ci/src/data/db.ts`.
 *
 * Two entry points: `orm(ctx.data)` from a server action (context built from
 * the caller's session), and `db()` from the deletion hook and the job handler,
 * neither of which has a session to build a context from.
 */
export type VeevaMigrationSchema = typeof schema;
export type VeevaMigrationDb = ScopedDatabase<VeevaMigrationSchema>["orm"];

export function orm(data: DataCapability): VeevaMigrationDb {
  return (data.db as unknown as ScopedDatabase<VeevaMigrationSchema>).orm;
}

export function db(): VeevaMigrationDb {
  return orm(veevaMigrationWiring().data);
}

export { schema };
