import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { ciWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same cast,
 * same reason as `plugins/explorer/src/data/db.ts`.
 *
 * Two entry points, because this plugin is reached two ways:
 *
 * - `orm(ctx.data)` — from a server action, where the context was built from
 *   the caller's session and `ctx.team.id` is the authorized tenant.
 * - `db()` — from the deletion hook and the GitLab webhook gate, neither of
 *   which has a session to build a context from. Same handle, taken straight
 *   from the wiring slot.
 *
 * The scoping that matters is identical on both paths: `core/data` bound this
 * handle to the two `ci_`-prefixed tables and nothing else. Tenancy inside
 * those tables is this plugin's own `team_id` filter, and every query module
 * function below takes the team id as a required argument for that reason.
 */
export type CiSchema = typeof schema;
export type CiDb = ScopedDatabase<CiSchema>["orm"];

export function orm(data: DataCapability): CiDb {
  return (data.db as unknown as ScopedDatabase<CiSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): CiDb {
  return orm(ciWiring().data);
}

export { schema };
