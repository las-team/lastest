import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The two data-source tables — moved out of `packages/db/src/schema/settings.ts`,
 * where they sat next to `googleSheetsAccounts` (the OAuth credential row, which
 * stays core — see `src/lib/core/data-sources-host.ts`).
 *
 * ### Renamed for the `<id>_` prefix
 *
 * | Was | Now |
 * | --- | --- |
 * | `csv_data_sources` | `data_sources_csv_sources` |
 * | `google_sheets_data_sources` | `data_sources_google_sheets` |
 *
 * `core/data`'s `validateSchemaNamespace` requires both. `scripts/migrate.js`
 * does the two `ALTER TABLE … RENAME TO` before `drizzle-kit push`, because push
 * cannot see a rename — it would drop and recreate under `--force`, taking every
 * team's cached CSV/sheet data with it (recipe §2.4).
 *
 * ### Two foreign keys to core tables, dropped
 *
 * Both tables carried `repository_id -> repositories.id` and
 * `team_id -> teams.id`, neither `.notNull()` at the column and neither declared
 * with `onDelete` (a plain FK — restrict is Postgres's default). Per
 * `core-scope.md` §6 both go; see `deletion.ts` for what replaces them.
 * `google_sheets_data_sources.google_sheets_account_id` also pointed at core's
 * `googleSheetsAccounts` — dropped the same way, convention-only from here.
 *
 * `team_id` is made `.notNull()` here (it was not before): with the FK gone,
 * the `team_id` filter is the only tenancy boundary these tables have, the same
 * tightening `plugins/ci/src/schema.ts` made for the same reason.
 *
 * ### `storage_path` did not move
 *
 * The pre-migration `csv_data_sources.storage_path` was a raw filesystem path
 * under `STORAGE_DIRS["csv-sources"]`, written with `fs.writeFile`. A plugin
 * cannot import `fs`/`path`/`@/lib/storage/paths` (rule 1), and more to the
 * point should not want to: `ctx.storage` (declared in `capabilities` below)
 * is tenant-quota-checked, namespaced-by-plugin blob storage that this feature
 * gets for free. The upload/sync/delete actions key each file by the row's own
 * `id` (`data-sources-host` derives `csv/<id>`) rather than persisting a path,
 * so there is nothing to store or to go stale.
 */

export const dataSourcesCsvSources = pgTable(
  "data_sources_csv_sources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Convention-only references to core tables, per core-scope.md §6.
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    alias: text("alias").notNull(),
    filename: text("filename").notNull(),
    cachedHeaders: jsonb("cached_headers").$type<string[]>().notNull(),
    cachedData: jsonb("cached_data").$type<string[][]>().notNull(),
    rowCount: integer("row_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_data_sources_csv_repo").on(table.repositoryId),
    index("idx_data_sources_csv_team").on(table.teamId),
  ],
);

export type CsvDataSource = typeof dataSourcesCsvSources.$inferSelect;
export type NewCsvDataSource = typeof dataSourcesCsvSources.$inferInsert;

export const dataSourcesGoogleSheets = pgTable(
  "data_sources_google_sheets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Convention-only references to core tables, per core-scope.md §6.
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    googleSheetsAccountId: text("google_sheets_account_id"),
    spreadsheetId: text("spreadsheet_id").notNull(),
    spreadsheetName: text("spreadsheet_name").notNull(),
    sheetName: text("sheet_name").notNull(),
    sheetGid: integer("sheet_gid"),
    alias: text("alias").notNull(),
    headerRow: integer("header_row").default(1),
    dataRange: text("data_range"),
    cachedHeaders: jsonb("cached_headers").$type<string[]>(),
    cachedData: jsonb("cached_data").$type<string[][]>(),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_data_sources_gsheet_repo").on(table.repositoryId),
    index("idx_data_sources_gsheet_team").on(table.teamId),
  ],
);

export type GoogleSheetsDataSource =
  typeof dataSourcesGoogleSheets.$inferSelect;
export type NewGoogleSheetsDataSource =
  typeof dataSourcesGoogleSheets.$inferInsert;
