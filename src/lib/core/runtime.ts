import "server-only";

import type { Plan } from "@lastest/contracts";
import { createBrowserFactory } from "@lastest/core-browser";
import { createDataFactory, type DataFactory } from "@lastest/core-data";
import {
  createRuntime,
  resolveRegistry,
  type ContextScope,
  type PluginRuntime,
  type ScopeRequest,
} from "@lastest/kernel";
import { sql } from "@lastest/db";

import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import { appBrowserHost } from "@/lib/core/browser-host";
import { entitlementsFor } from "@/lib/core/entitlements";

/**
 * The composition root: where core's ports meet this app's implementations.
 *
 * Nothing above this file knows about Next.js, and nothing below it knows about
 * plugins. That is the whole arrangement — `core/**` stays free of `@/…`
 * imports (which `pnpm arch` enforces) and plugins stay free of everything
 * except `ctx`.
 *
 * **Status: compile-verified, not runtime-verified.** No plugin exists yet, so
 * nothing calls this in production. It is here because a capability with no
 * possible implementation is not a prerequisite that has been met — the first
 * plugin should find the seam already fitted, not have to invent it.
 */

/**
 * Registered plugins. Empty until the first migration lands; `resolveRegistry`
 * validates whatever appears here at boot.
 */
const MANIFESTS: Parameters<typeof resolveRegistry>[0] = [];

/**
 * Resolve the caller to a team, a repo and a logger.
 *
 * This is the answer to "how does a plugin's `"use server"` action get its
 * `ctx`" — it does not resolve its own scope, it is handed one. There is no
 * `setTeam` anywhere on the plugin side, so a plugin cannot widen what it was
 * given.
 */
async function resolveScope(req: ScopeRequest): Promise<ContextScope> {
  const log = getLogger(req.pluginId);

  if (req.repositoryId) {
    const { team, repo } = await requireRepoAccess(req.repositoryId);
    return {
      team: {
        id: team.id,
        plan: team.plan as Plan,
        entitlements: entitlementsFor(team.plan as Plan),
      },
      repo: {
        id: repo.id,
        // `repositories.teamId` is nullable in the schema, but
        // `requireRepoAccess` has already asserted it equals the session's
        // team — so the authorized id is both non-null and the correct one.
        teamId: team.id,
        name: repo.name,
        defaultBranch: repo.defaultBranch ?? null,
      },
      log,
    };
  }

  if (req.teamId) {
    // Background paths only — a cron trigger firing, or a job resuming work
    // enqueued hours ago, where there is no session to derive a team from.
    //
    // SECURITY: `teamId` is trusted here because the only callers are core's
    // own job worker and scheduler. It must never be threaded through from a
    // user request; that would be a tenancy escape, which is the single thing
    // this whole arrangement exists to prevent.
    const team = await queries.getTeam(req.teamId);
    if (!team) throw new Error(`Unknown team "${req.teamId}"`);
    return {
      team: {
        id: team.id,
        plan: team.plan as Plan,
        entitlements: entitlementsFor(team.plan as Plan),
      },
      log,
    };
  }

  const { team } = await requireTeamAccess();
  return {
    team: {
      id: team.id,
      plan: team.plan as Plan,
      entitlements: entitlementsFor(team.plan as Plan),
    },
    log,
  };
}

let cached: { runtime: PluginRuntime; data: DataFactory } | undefined;

/**
 * Build (once) and return the plugin runtime.
 *
 * Schema validation runs here rather than lazily so a namespacing mistake is a
 * startup failure next to the registry's other checks. `EB_PROCESS_POOL_MAX`
 * bounds a swarm because the pool cap lives in the pool service, not in core —
 * core clamps to what it is told rather than trusting a plugin's `count`.
 */
export async function getPluginRuntime(): Promise<PluginRuntime> {
  if (cached) return cached.runtime;

  const registry = resolveRegistry(MANIFESTS);
  const data = createDataFactory({ client: sql });
  await data.init(registry.plugins);

  const maxSwarm = Number(process.env.EB_PROCESS_POOL_MAX ?? 4);
  const runtime = createRuntime({
    registry,
    resolveScope,
    factories: {
      browser: createBrowserFactory(appBrowserHost, { maxSwarm }),
      data: (pluginId) => data.capability(pluginId),
    },
  });

  cached = { runtime, data };
  return runtime;
}
