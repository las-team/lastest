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
import { configureExplorer, explorerPlugin } from "@lastest/plugin-explorer";

import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import { createAiFactory } from "@/lib/core/ai-capability";
import { appBrowserHost } from "@/lib/core/browser-host";
import { entitlementsFor } from "@/lib/core/entitlements";
import { appExplorerHost } from "@/lib/core/explorer-host";

/**
 * The composition root: where core's ports meet this app's implementations.
 *
 * Nothing above this file knows about Next.js, and nothing below it knows about
 * plugins. That is the whole arrangement — `core/**` stays free of `@/…`
 * imports (which `pnpm arch` enforces) and plugins stay free of everything
 * except `ctx`.
 *
 * `explorer` is the first plugin through it (RFC §9 phase 2). The seam held:
 * everything explorer needs that *is* a boundary — a browser, a model, its own
 * tables — arrives as a capability. Everything it needs that core does not
 * offer yet arrives through `appExplorerHost`, which is deliberately ugly so it
 * stays visible. See `plugins/explorer/src/host.ts`.
 */

/**
 * Registered plugins. `resolveRegistry` validates the whole set at boot — ids,
 * job-type namespacing, capability providers, and that every plugin with
 * storage can also delete it.
 */
const MANIFESTS: Parameters<typeof resolveRegistry>[0] = [explorerPlugin];

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
      ai: createAiFactory(),
    },
  });

  // Hand each plugin its runtime. A plugin's `"use server"` module is imported
  // by Next.js rather than constructed, so there is no other moment at which to
  // pass it one — see `plugins/explorer/src/wiring.ts` for why the slot is
  // realm-wide rather than a module-level binding.
  configureExplorer({
    runtime,
    host: appExplorerHost,
    data: data.capability("explorer"),
  });

  cached = { runtime, data };
  return runtime;
}
