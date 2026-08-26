import { parseCsvBuffer } from "@lastest/csv";
import { createStorageCapability } from "@lastest/core-storage";

import { db } from "./data/db";
import { getCsvDataSources, getGoogleSheetsDataSources } from "./data/queries";
import type { CsvDataSource, GoogleSheetsDataSource } from "./schema";
import { dataSourcesWiring } from "./wiring";

/**
 * Server-component reads, for `/settings`, `/tests/[id]` and anywhere else
 * that already resolved a repository server-side. Deliberately **not**
 * actions — same reasoning as `plugins/ci/src/reads.ts`: routing a read
 * through `"use server"` mints an action id nothing dispatches and adds a
 * second authorization pass over a repository the caller already resolved.
 *
 * The caller passes the repository id it authorized; this module treats it
 * as already authorized, exactly what `queries.getCsvDataSources(
 * repositoryId)` / `queries.getGoogleSheetsDataSources(repositoryId)` did
 * before the move. The handle comes straight from the wiring slot because a
 * server component has no `ctx` to hand down.
 */

export async function listCsvDataSources(
  repositoryId?: string | null,
): Promise<CsvDataSource[]> {
  return getCsvDataSources(db(), repositoryId);
}

export async function listGoogleSheetsDataSources(
  repositoryId?: string | null,
): Promise<GoogleSheetsDataSource[]> {
  return getGoogleSheetsDataSources(db(), repositoryId);
}

/** A source's rows, and how many of the source's total they represent. */
export interface CsvSourceTable {
  alias: string;
  headers: string[];
  rows: string[][];
  /** Rows actually returned. */
  profiledRows: number;
  /** Rows the source reports having in total. */
  totalRows: number;
  /** True when `profiledRows < totalRows` — these rows are a sample. */
  truncated: boolean;
}

/**
 * Every CSV source in a repo, resolved to its **full** row set.
 *
 * `cachedData` is capped at `MAX_CACHED_ROWS` (1000) by the upload action
 * because it backs a UI preview and matrix row-walking. That cap is wrong for
 * anything measuring a distribution: profiling a 6,000-row extract off its
 * first 1,000 rows reports a sample as though it were the population, and
 * silently loses every combination occurring past the cap. So this reads the
 * stored file back through `ctx.storage` and parses it, falling back to the
 * cache (flagged `truncated`) when the blob is gone.
 *
 * Shaped as "give me the rows", not "give me the storage key" (recipe §3.1).
 * The blob lives in *this* plugin's `(teamId, pluginId)` storage namespace, so
 * no other package can reach it and none should learn how it is keyed — the
 * caller gets parsed rows and a truthful `truncated` flag, nothing else.
 * Storage is built from the raw `StorageHost` on the wiring slot, scoped to
 * the row's own `teamId`, the same construction `deletion.ts` uses and for the
 * same reason: a plain read has no `ContextScope` to take `ctx.storage` from.
 */
export async function listCsvDataSourceTables(
  repositoryId?: string | null,
): Promise<CsvSourceTable[]> {
  const sources = await getCsvDataSources(db(), repositoryId);

  return Promise.all(
    sources.map(async (source): Promise<CsvSourceTable> => {
      const cachedRows = source.cachedData ?? [];
      const total = source.rowCount ?? cachedRows.length;
      const cached: CsvSourceTable = {
        alias: source.alias,
        headers: source.cachedHeaders ?? [],
        rows: cachedRows,
        profiledRows: cachedRows.length,
        totalRows: total,
        truncated: cachedRows.length < total,
      };
      if (!cached.truncated) return cached;

      try {
        const storage = createStorageCapability(
          dataSourcesWiring().storageHost,
          { pluginId: "data-sources", teamId: source.teamId },
        );
        const stored = await storage.get(`csv/${source.id}`);
        if (!stored) return cached;
        const parsed = parseCsvBuffer(Buffer.from(stored));
        return {
          alias: source.alias,
          headers: parsed.headers,
          rows: parsed.rows,
          profiledRows: parsed.rows.length,
          totalRows: parsed.rowCount ?? parsed.rows.length,
          truncated: false,
        };
      } catch {
        // The blob is unreadable or gone. The cache is still a truthful
        // answer as long as it says so — never a silent downgrade.
        return cached;
      }
    }),
  );
}
