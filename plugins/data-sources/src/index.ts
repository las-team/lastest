import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-data-sources` — cached, alias-keyed tabular test data:
 * uploaded CSV files and linked Google Sheets, referenced from test code via
 * `{{csv:alias...}}` / `{{sheet:alias...}}`. The twelfth plugin of RFC §9
 * phase 4.
 *
 * ### The map was wrong again — three ways this time, not two
 *
 * RFC §6.3's `data-sources` entry lists `lib/csv`, `lib/google-sheets` **and**
 * `actions/spec-import.ts`. Reading import lists (recipe §1.6) split it three
 * ways, not two:
 *
 * - **CSV/Sheets parsing and the Sheets REST client** — pure, caller-supplied
 *   token or in-memory bytes, zero `@/…` imports. Promoted to `libs/csv` and
 *   `libs/google-sheets` (recipe §5), *before* this migration, in the same
 *   commit that repointed `src/lib/execution/executor.ts` and
 *   `src/lib/vars/resolver.ts` at them — those two are core, and importing
 *   `src/lib/google-sheets/resolver` was a core→feature edge (§1.6) hiding
 *   inside a pseudo-plugin nobody had graphed yet.
 * - **The Google Sheets OAuth token refresh** — a credential boundary (reads
 *   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), stayed core. It moved from
 *   `src/lib/google-sheets/api.ts` into `src/lib/core/data-sources-host.ts`
 *   rather than becoming its own `CORE_SRC_PATHS` entry, because it has
 *   exactly one caller (this plugin's host) — unlike `github`/`gitlab`
 *   OAuth, which `ci`'s split found imported from three other places.
 * - **`spec-import.ts` was never this feature.** It shares no table, no
 *   type and no import with csv/google-sheets in either direction — the
 *   only thing it shares is the word "data" in a directory name. Its own
 *   port would run past recipe §1.5's stop line (~20+ distinct core calls:
 *   `tests`, `test_specs`, `functional_areas`, `routes`, `agent_sessions`,
 *   background jobs, an embedded-browser claim, `@lastest/github`, AI
 *   generation). Left as its own `PSEUDO_PLUGINS["spec-import"]` entry,
 *   uncosted, for a future migration — see `tools/architecture/boundaries.mjs`.
 *
 * ### The host port is three methods, one credential boundary
 *
 * `googleSheetsAccessToken`/`googleSheetsAccountInfo`/`disconnectGoogleSheets`
 * — the `CiHost.scmCredentials` shape applied to a different provider and
 * split into the three things the old `getValidAccessToken`/
 * `getGoogleSheetsAccountInfo`/`disconnectGoogleSheets` each did against the
 * core `googleSheetsAccounts` table. Everything else is a capability:
 * `ctx.data` (its own two tables) and `ctx.storage` (uploaded CSV bytes —
 * this is the **first** plugin to declare it). See `host.ts`.
 *
 * ### `storage` surfaced a real gap: nothing reaps a deleted team's blobs
 *
 * Every capability but `data` and `storage` is unavailable outside a built
 * `PluginContext`, and a `PluginContext` needs a `ContextScope`, which a
 * deletion hook does not have. `data` already has an answer (`ctx.data` is
 * scoped by plugin id only, so the wiring slot can hand over the same handle
 * unscoped). `storage` did not — `StorageCapability` is scoped by
 * *(teamId, pluginId)* at construction, and until now no plugin owned both a
 * table and a blob, so the gap was invisible. `deletion.ts` closes it by
 * building a `StorageCapability` from the raw `StorageHost` at hook-call
 * time, once the team id being deleted is known. That is a real, if small,
 * capability gap worth carrying into a future storage-owning plugin's result
 * doc rather than re-solving from scratch.
 */
export const dataSourcesPlugin = definePlugin({
  id: "data-sources",
  title: "Data sources",

  capabilities: ["data", "storage"],

  schema: () => import("./schema"),

  deletion: createDeletionHook(),
});

export default dataSourcesPlugin;

export type { DataSourcesHost } from "./host";
export type {
  CsvDataSource,
  GoogleSheetsDataSource,
  NewCsvDataSource,
  NewGoogleSheetsDataSource,
} from "./schema";
export { configureDataSources, type DataSourcesWiring } from "./wiring";
