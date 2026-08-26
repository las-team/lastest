/**
 * `@lastest/core-repos` — the `repos` capability.
 *
 * Core under `docs/architecture/core-scope.md` §6 for the same reason as
 * `core/tests`: `repositories` is a tenancy anchor (36 inbound FKs, §7), and a
 * plugin does not get to read it, not even for a URL.
 */
import type { TeamRef } from "@lastest/contracts";

import { createReposCapability } from "./repos";
import type { ReposHost } from "./host";

export { createReposCapability } from "./repos";
export type { RepoUrlLookup, ReposHost } from "./host";

export interface ReposScope {
  readonly team: TeamRef;
}

export interface ReposFactoryOptions {
  readonly host: ReposHost;
}

/**
 * Build the `repos` entry for `createRuntime`'s `factories`. Mirrors
 * `createBrowserFactory`'s shape exactly: one function taking the host,
 * returning the per-context factory the kernel calls with `(pluginId, scope)`.
 */
export function createReposFactory(opts: ReposFactoryOptions) {
  return (_pluginId: string, scope: ReposScope) =>
    createReposCapability(opts.host, scope.team);
}
