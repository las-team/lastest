import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a build-time guard with no Node entry point — stub it
      // so server modules that use it stay importable under test.
      "server-only": path.resolve(__dirname, "./test-stubs/server-only.ts"),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      ".next/**",
      "playwright-visual-tests/**",
      "scripts/**",
      "tests/**",
      "seed.spec.*",
      // Claude agent worktrees are full repo copies. Without this, `pnpm test`
      // runs every suite once per worktree — inflating the count (1546 → 6428
      // with three present) and reporting failures from unfinished work in
      // another branch as if they were failures here. `eslint.config.mjs`
      // already carries the same guard for the same reason.
      ".claude/**",
      // Integration suites need real infrastructure (postgres, the EB pool
      // service, a Chromium install) and would fail on a laptop with none of
      // it running. Run them explicitly with `pnpm test:integration`.
      "**/*.integration.test.ts",
    ],
  },
});
