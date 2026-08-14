/**
 * Vitest stub for the `server-only` package.
 *
 * `server-only` has no Node-resolvable entry point — it exists to make a build
 * FAIL when a server module is pulled into a client bundle. Under vitest
 * (plain Node, no bundler conditions) importing it throws, which would force us
 * to drop the guard from modules that legitimately need it just to keep them
 * testable. Aliasing it to this empty module in `vitest.config.ts` keeps the
 * real guard in the app build while letting tests import those modules.
 */
export {};
