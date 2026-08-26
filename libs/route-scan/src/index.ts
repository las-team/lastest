/**
 * `@lastest/route-scan` — route discovery over a GitHub repository tree.
 *
 * Detects the framework, walks the tree for route files and turns them into
 * `RouteInfo[]`, plus a smoke-test generator for the result. Reads through
 * `@lastest/github`, so it never resolves a credential of its own: the caller
 * hands it an access token, exactly as it hands one to the client underneath.
 *
 * ### Why this is a library and not core, and not part of `scheduling`
 *
 * `core-scope.md` §3: it guards nothing — no tenancy decision, no capacity, no
 * money, no credential. RFC §6.3 filed `src/lib/scanner` under the
 * `scheduling` plugin, which was a grouping of convenience: scanning is not
 * scheduling, and *two* features consume it (`scheduling`'s own
 * `src/server/actions/scanner.ts` and `qa-agent`). RFC §4.3's first answer to
 * that is "promote the shared part", which is this package.
 */
export { RemoteRouteScanner } from "./remote-scanner";
export type { RemoteScannerConfig } from "./remote-scanner";
export { generateSmokeTest, generateSmokeTestCode } from "./test-generator";
export type { RouteInfo, ScanProgress, ScanResult } from "./types";
