/**
 * `@lastest/core-data` — plugin-owned persistence.
 *
 * Core under `core-scope.md` §2 for **tenancy** and **capacity**: it is the one
 * place that decides which rows a plugin can reach, and it owns the shared
 * connection pool a runaway plugin would otherwise exhaust.
 *
 * What it deliberately is *not*: a view onto core tables. There is no
 * read-only accessor here, by design (§6). A plugin that needs to know
 * something about a repository, a team or a storage state calls a core
 * function — it does not read the row.
 */
import type { DataCapability } from "@lastest/contracts";

import {
  createScopedDatabase,
  PluginSchemaError,
  type PostgresClient,
  type ScopedDatabase,
} from "./scoped-db";

export {
  createScopedDatabase,
  PluginSchemaError,
  type DrizzleHandle,
  type PostgresClient,
  type ScopedDatabase,
} from "./scoped-db";

export {
  runDeletionHooks,
  type DeletablePlugin,
  type DeletionFailure,
  type DeletionReport,
  type DeletionTarget,
} from "./deletion";

export {
  tablePrefix,
  tablesOf,
  validateSchemaNamespace,
  type SchemaProblem,
} from "./namespace";

/** A plugin's schema module, as returned by the manifest's `schema()`. */
export type PluginSchema = Record<string, unknown>;

/** The subset of a manifest this package needs. Avoids a kernel dependency. */
export interface SchemaOwner {
  readonly id: string;
  readonly schema?: () => Promise<unknown>;
}

export interface DataFactoryOptions {
  /**
   * The one shared postgres client. Passed in rather than imported so this
   * package has no path to `@lastest/db` — core/data physically cannot reach a
   * core table, which is a stronger statement than promising not to.
   */
  readonly client: PostgresClient;
}

export interface DataFactory {
  /**
   * Resolve and validate every plugin schema. Call once at boot, before any
   * context is built.
   *
   * Eager on purpose. Schema loading is async but `DataCapability.db` is not,
   * and rather than make every plugin `await` its own database, the cost is
   * paid once at startup — which also means a namespacing mistake is a boot
   * failure alongside `resolveRegistry`'s other checks, not a 500 on the first
   * request that happens to touch that table.
   */
  init(plugins: readonly SchemaOwner[]): Promise<void>;
  /** The capability handed to a plugin as `ctx.data`. Synchronous after `init`. */
  capability(pluginId: string): DataCapability<PluginSchema>;
}

export function createDataFactory(opts: DataFactoryOptions): DataFactory {
  const handles = new Map<string, ScopedDatabase<PluginSchema>>();
  let initialized = false;

  return {
    async init(plugins) {
      const problems: string[] = [];
      for (const plugin of plugins) {
        if (!plugin.schema) continue;
        try {
          const schema = (await plugin.schema()) as PluginSchema;
          handles.set(
            plugin.id,
            createScopedDatabase(plugin.id, schema, opts.client),
          );
        } catch (err) {
          // Collect rather than rethrow: reporting one bad schema at a time
          // turns a five-minute fix into five deploys.
          problems.push(
            err instanceof PluginSchemaError
              ? err.problems.join("\n  - ")
              : `plugin "${plugin.id}" schema failed to load: ${String(err)}`,
          );
        }
      }
      if (problems.length > 0) throw new PluginSchemaError(problems);
      initialized = true;
    },

    capability(pluginId) {
      if (!initialized) {
        throw new Error(
          `core/data was not initialized — call \`init(plugins)\` at boot before building a context (plugin "${pluginId}")`,
        );
      }
      const db = handles.get(pluginId);
      if (!db) {
        throw new Error(
          `plugin "${pluginId}" declared capability "data" but no \`schema()\` in its manifest — ` +
            `there is nothing for ctx.data to point at`,
        );
      }
      return { db };
    },
  };
}
