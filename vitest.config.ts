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
    ],
  },
});
