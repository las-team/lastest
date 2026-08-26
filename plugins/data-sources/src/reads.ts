import { db } from "./data/db";
import { getCsvDataSources, getGoogleSheetsDataSources } from "./data/queries";
import type { CsvDataSource, GoogleSheetsDataSource } from "./schema";

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
