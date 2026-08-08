import { drizzle } from "drizzle-orm/postgres-js";
import type { PluginDatabase } from "@lastest/contracts";

import { validateSchemaNamespace } from "./namespace";

/**
 * The scoped database handle.
 *
 * `PluginDatabase` in `@lastest/contracts` is deliberately thin — contracts
 * carries zero dependencies, so it cannot name a drizzle type. This is the
 * "properly-typed handle" that comment promises: the real query surface, bound
 * to one plugin's schema.
 *
 * What the binding does and does not buy, stated exactly so nobody relies on
 * the wrong half:
 *
 *   - `db.query.*` only knows this plugin's tables, because that is the schema
 *     the instance was built with.
 *   - `db.select().from(t)` works for whatever table object the caller can name
 *     — drizzle takes the table as an argument, so scoping cannot come from the
 *     instance alone. A plugin cannot name a core table because it cannot
 *     import `@lastest/db` (enforced by `pnpm arch`) and cannot declare one in
 *     its own schema (enforced by `validateSchemaNamespace`). Those two
 *     together are the guarantee; the drizzle instance by itself is not.
 *   - Core owns the connection. The plugin never receives the postgres client,
 *     so it cannot open its own pool and exhaust the shared one.
 */
export type DrizzleHandle<TSchema extends Record<string, unknown>> = ReturnType<
  typeof drizzle<TSchema>
>;

export interface ScopedDatabase<
  TSchema extends Record<string, unknown>,
> extends PluginDatabase<TSchema> {
  readonly schema: TSchema;
  /** The drizzle handle, bound to `schema`. */
  readonly orm: DrizzleHandle<TSchema>;
  transaction<T>(fn: (tx: ScopedDatabase<TSchema>) => Promise<T>): Promise<T>;
}

export class PluginSchemaError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Plugin schema is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "PluginSchemaError";
  }
}

/**
 * Minimal shape of the shared postgres client, structurally typed so this
 * package does not depend on `@lastest/db` (and therefore cannot reach a core
 * table even by accident). The app passes the one shared client in at wiring
 * time — see `createDataFactory`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PostgresClient = any;

export function createScopedDatabase<TSchema extends Record<string, unknown>>(
  pluginId: string,
  schema: TSchema,
  client: PostgresClient,
): ScopedDatabase<TSchema> {
  const problems = validateSchemaNamespace(pluginId, schema);
  if (problems.length > 0) {
    throw new PluginSchemaError(problems.map((p) => p.reason));
  }
  return wrap(drizzle(client, { schema }), schema);
}

function wrap<TSchema extends Record<string, unknown>>(
  orm: DrizzleHandle<TSchema>,
  schema: TSchema,
): ScopedDatabase<TSchema> {
  return {
    schema,
    orm,
    transaction: (fn) =>
      // The tx handle carries the same schema binding, so a plugin cannot
      // widen its reach by going through a transaction.
      orm.transaction((tx) =>
        fn(wrap(tx as unknown as DrizzleHandle<TSchema>, schema)),
      ),
  };
}
