import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration suites — the ones that need real infrastructure.
 *
 * Kept out of `pnpm test` (see the exclude in `vitest.config.ts`) because they
 * require host postgres, the EB pool service and a Chromium install, and a
 * suite that fails when the laptop is idle teaches people to ignore red.
 *
 * Prerequisites:
 *   docker compose up -d     # host postgres
 *   pnpm dev:pool            # EB pool service (process provisioner)
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./test-stubs/server-only.ts"),
    },
  },
  test: {
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
