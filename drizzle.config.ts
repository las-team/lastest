import type { Config } from "drizzle-kit";

/**
 * Core schema plus every plugin's own schema.
 *
 * Spike S2 verified the glob: `drizzle-kit` picks up plugin tables from a
 * second path and emits them alongside core's. What has changed since is that
 * plugin tables no longer declare foreign keys back to core
 * (`docs/architecture/core-scope.md` §6), so nothing here has to resolve a
 * cross-package reference — each plugin's file stands alone.
 *
 * The glob is what makes `pnpm db:push` create `explorer_*`. Without it the
 * plugin boots, validates its namespace, and then fails on the first query
 * against a table that was never created.
 */
export default {
  schema: ["./packages/db/src/schema.ts", "./plugins/*/src/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://lastest:lastest@localhost:5432/lastest",
  },
} satisfies Config;
