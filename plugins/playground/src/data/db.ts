import type { DataCapability } from "@lastest/contracts";
import type { ScopedDatabase } from "@lastest/core-data";

import * as schema from "../schema";
import { playgroundWiring } from "../wiring";

/**
 * Getting a typed query surface out of the injected data capability. Same
 * cast, same reason as `plugins/explorer/src/data/db.ts` — read that file's
 * comment for the gap in `CapabilityMap.data` this works around.
 *
 * `db()` takes no argument because the playground has no `ctx`: it declares
 * `tenancy: "none"`, so there is no scope to build one from (see
 * `../wiring.ts`) and the kernel would refuse to build one anyway. The scoping
 * that matters is still done — `core/data` bound this handle to the
 * `playground_`-prefixed table and nothing else.
 */
export type PlaygroundSchema = typeof schema;
export type PlaygroundDb = ScopedDatabase<PlaygroundSchema>["orm"];

export function orm(data: DataCapability): PlaygroundDb {
  return (data.db as unknown as ScopedDatabase<PlaygroundSchema>).orm;
}

/** The plugin's own query surface, resolved from the wiring slot. */
export function db(): PlaygroundDb {
  return orm(playgroundWiring().data);
}

export { schema };
