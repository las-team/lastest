import { getTableName, is, Table } from "drizzle-orm";

/**
 * Table namespacing — the one rule in `core/data` with actual teeth.
 *
 * `core-scope.md` §6 says a plugin reaches only its own tables. The import ban
 * (`pnpm arch`) is what stops a plugin *importing* `@lastest/db`, but it cannot
 * stop a plugin re-exporting a core table object from its own `schema()` and
 * then querying it through the handle core handed over. That is the one hole
 * the import graph does not close, and this closes it: every table a plugin
 * declares must be prefixed with the plugin's own id, so `repositories` cannot
 * be smuggled in as `explorer`'s table.
 *
 * The prefix doubles as collision avoidance — two plugins cannot both claim a
 * table called `sessions`, which matters because plugin schemas are resolved
 * into one physical database.
 */

/** `"qa-agent"` → `"qa_agent_"`. Plugin ids are kebab-case; table names snake. */
export function tablePrefix(pluginId: string): string {
  return `${pluginId.replace(/-/g, "_")}_`;
}

export interface SchemaProblem {
  readonly table: string;
  readonly reason: string;
}

/**
 * Pull the drizzle tables out of a schema module.
 *
 * A schema module also exports types, enums and relations; `is(x, Table)` is
 * how drizzle itself distinguishes a table object, so we use that rather than
 * duck-typing on a property name that could change under us.
 */
export function tablesOf(schema: unknown): Map<string, unknown> {
  const tables = new Map<string, unknown>();
  if (!schema || typeof schema !== "object") return tables;
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (is(value, Table)) tables.set(getTableName(value), value);
  }
  return tables;
}

/**
 * Check every table in a plugin's schema is namespaced to that plugin.
 *
 * Returns problems rather than throwing so the kernel can report all of them at
 * once at boot — the same reason `resolveRegistry` accumulates. A boot failure
 * listing one problem at a time turns a five-minute fix into five deploys.
 */
export function validateSchemaNamespace(
  pluginId: string,
  schema: unknown,
): SchemaProblem[] {
  const prefix = tablePrefix(pluginId);
  const problems: SchemaProblem[] = [];
  for (const name of tablesOf(schema).keys()) {
    if (!name.startsWith(prefix)) {
      problems.push({
        table: name,
        reason:
          `plugin "${pluginId}" declares table "${name}", which is not prefixed ` +
          `"${prefix}" — a plugin may only own tables in its own namespace ` +
          `(core-scope.md §6)`,
      });
    }
  }
  return problems;
}
