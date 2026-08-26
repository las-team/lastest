import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Parse `.env.local` into a plain record for `test.env`.
 *
 * Deliberately hand-rolled rather than Vite's `loadEnv`: that lives in `vite`,
 * which is not a direct dependency here (vitest 4's `vitest/config` does not
 * re-export it), so importing it resolves at runtime under pnpm but fails
 * `tsc --noEmit` with "Cannot find module 'vite'". Adding `vite` to the root
 * devDependencies to satisfy one config import is a bigger change than the
 * eight lines below. Same rules as
 * `packages/pool-service/src/env.ts`: skip blanks and `#` comments, strip one
 * layer of matching quotes.
 */
function envLocal(): Record<string, string> {
  const file = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Integration suites — the ones that need real infrastructure.
 *
 * Kept out of `pnpm test` (see the exclude in `vitest.config.ts`) because they
 * require host postgres, the EB pool service and a Chromium install, and a
 * suite that fails when the laptop is idle teaches people to ignore red.
 *
 * Prerequisites:
 *   docker compose up -d     # host postgres
 *   pnpm db:push             # schema in the DB must match packages/db
 *   pnpm dev                 # BOTH the Next app on :3000 and the EB pool
 *                            # service — `pnpm dev:pool` alone is not enough
 *
 * The app matters because process-mode EBs register back to it at
 * 127.0.0.1:3000 on startup; with the pool up but the app down, every EB
 * spawns and then fails registration with ECONNREFUSED, so anything needing a
 * *registered runner* (build dispatch) is unreliable. Note this does NOT stop
 * a pool claim or MCP browsing — `quickstart.integration.test.ts` was observed
 * completing its scout steps against a live site with the app down. Do not
 * treat "the scout worked" as evidence the app is running.
 *
 * `.env.local` is loaded into the test process's env (see `envLocal` below).
 * Vitest does not do this on its own, and Next.js — which normally loads it —
 * isn't in the picture here, so without it every suite that touches an
 * encrypted column or the DB dies on `ENCRYPTION_KEY env var is not set`
 * before reaching anything it meant to verify. The pool service already loads
 * the same file itself (`packages/pool-service/src/env.ts`), which is why it
 * comes up fine while the tests driving it do not.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./test-stubs/server-only.ts"),
    },
  },
  test: {
    env: envLocal(),
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", ".next/**", ".claude/**"],
    // A browser claim can wait on a cold EB spawn (~2-5s in process mode) and
    // the deadline case deliberately burns wall-clock.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // These share one pool of EBs and one database; running files in parallel
    // makes them fight over both.
    fileParallelism: false,
  },
});
