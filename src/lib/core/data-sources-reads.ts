import "server-only";

import {
  listCsvDataSourceTables,
  listCsvDataSources,
  listGoogleSheetsDataSources,
} from "@lastest/plugin-data-sources/reads";
import type { CsvSourceLike } from "@lastest/csv";
import type { SheetSourceLike } from "@lastest/google-sheets";
import type { SourceTable } from "@lastest/coverage-model";

/**
 * Reverse reads into the `data-sources` plugin's own tables, for
 * `src/lib/execution/executor.ts`.
 *
 * The executor resolves `{{csv:...}}`/`{{sheet:...}}` references in test code
 * before sending it to the runner — it used to `queries.getCsvDataSources(
 * repositoryId)` / `queries.getGoogleSheetsDataSources(repositoryId)` straight
 * off the shared `db` handle. Once those tables moved into
 * `plugins/data-sources/src/schema.ts`, that stopped being reachable
 * (`core-scope.md` §6), and the executor has no `PluginContext` to pull
 * `ctx.data` from — it is core's own execution substrate, called from many
 * places that were never authorizing a specific plugin's scope.
 *
 * Same shape as `share-reads.ts`: `plugins/data-sources/src/reads.ts` already
 * exposes plain, unscoped read functions (they take the handle straight from
 * the wiring slot, the same route the plugin's own deletion hook takes), and
 * this file — living in `src/lib/core/`, the one place in `src/` that
 * legitimately imports plugins — re-exports them for the executor to call.
 * The return type is narrowed to `libs/csv`'s `CsvSourceLike` and
 * `libs/google-sheets`'s `SheetSourceLike` rather than the plugin's own
 * `CsvDataSource`/`GoogleSheetsDataSource`, because that is the only shape
 * the executor's resolvers actually need — no `id`/`teamId` — and it keeps
 * the executor's own import graph pointed at libs rather than the plugin.
 *
 * Deliberately does NOT import `./runtime` / call `getPluginRuntime()` — same
 * reasoning as `share-reads.ts`: `src/instrumentation.ts` already awaits
 * `getPluginRuntime()` before the server handles a request, so the plugin's
 * wiring is in place by the time the executor runs, and importing `./runtime`
 * from here would pull the entire composition root into the execution
 * substrate's import graph for no reason.
 */

export async function csvDataSourcesForRepo(
  repositoryId: string | null | undefined,
): Promise<CsvSourceLike[]> {
  return listCsvDataSources(repositoryId);
}

export async function googleSheetsDataSourcesForRepo(
  repositoryId: string | null | undefined,
): Promise<SheetSourceLike[]> {
  return listGoogleSheetsDataSources(repositoryId);
}

/**
 * The same two reads, resolved into tables for `src/lib/coverage`.
 *
 * Coverage measures a distribution, so it cannot profile the capped
 * `cachedData` preview the executor is happy with — it needs the whole file,
 * and the file lives in the `data-sources` plugin's own `(teamId, pluginId)`
 * storage namespace. `listCsvDataSourceTables` resolves that inside the plugin
 * and returns parsed rows plus a truthful `truncated` flag (recipe §3.1 — "do
 * the thing", not "give me the storage key"); nothing outside that package
 * learns how the blob is keyed.
 *
 * Sheets cache their whole range and track no separate total, so the cache IS
 * the full table and no blob read is involved.
 *
 * When coverage becomes `plugins/coverage`, these two are its host port's
 * data-source methods rather than a direct import.
 */
export async function csvDataSourceTablesForRepo(
  repositoryId: string | null | undefined,
): Promise<SourceTable[]> {
  return listCsvDataSourceTables(repositoryId);
}

export async function sheetDataSourceTablesForRepo(
  repositoryId: string | null | undefined,
): Promise<SourceTable[]> {
  const rows = await listGoogleSheetsDataSources(repositoryId);
  return rows.map((r) => {
    const data = r.cachedData ?? [];
    return {
      alias: r.alias,
      headers: r.cachedHeaders ?? [],
      rows: data,
      profiledRows: data.length,
      totalRows: data.length,
      truncated: false,
    };
  });
}
