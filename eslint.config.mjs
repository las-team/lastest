import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { architectureBoundaryRules } from "./tools/architecture/eslint-rules.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Core/plugin import boundaries — see docs/architecture/core-plugin-refactor.md
  // §7.3. Generated from tools/architecture/boundaries.mjs, the same map the
  // graph test asserts against.
  ...architectureBoundaryRules(),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ignore compiled output
    "**/dist/**",
    "packages/runner/dist/**",
    "packages/vscode-extension/dist/**",
    "scripts/**",
    "migration-work/**",
    "tests/**",
    ".recovery/**",
    // Claude agent worktrees are full repo copies; root-relative ignores don't match inside them
    ".claude/**",
  ]),
]);

export default eslintConfig;
