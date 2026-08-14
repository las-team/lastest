import "server-only";

import type { Plan } from "@lastest/contracts";
import { createBrowserFactory } from "@lastest/core-browser";
import {
  createDataFactory,
  runDeletionHooks,
  type DataFactory,
  type DeletionReport,
  type DeletionTarget,
} from "@lastest/core-data";
import { createJobsFactory, processDueJobs } from "@lastest/core-jobs";
import { createReposFactory } from "@lastest/core-repos";
import { createStorageFactory } from "@lastest/core-storage";
import { createTestsFactory } from "@lastest/core-tests";
import {
  createRuntime,
  resolveRegistry,
  type ContextScope,
  type PluginRuntime,
  type ResolvedRegistry,
  type ScopeRequest,
} from "@lastest/kernel";
import { sql } from "@lastest/db";
import { configureA11y } from "@lastest/plugin-a11y";
import { configureApiTest } from "@lastest/plugin-api-test";
import { configureAppMap } from "@lastest/plugin-app-map";
import { configureAwards } from "@lastest/plugin-awards";
import { configureCi } from "@lastest/plugin-ci";
import { configureDesignSystem } from "@lastest/plugin-design-system";
import { configureEvents } from "@lastest/plugin-events";
import { configureExplorer } from "@lastest/plugin-explorer";
import { configureGamification } from "@lastest/plugin-gamification";
import { configureLaunch } from "@lastest/plugin-launch";
import { configurePlayground } from "@lastest/plugin-playground";
import { configureRca } from "@lastest/plugin-rca";
import { configureShare } from "@lastest/plugin-share";

import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { setTestCreatedListener } from "@/lib/db/test-hooks";
import { getLogger } from "@/lib/logger";
import { createAiFactory } from "@/lib/core/ai-capability";
import { appApiTestHost } from "@/lib/core/api-test-host";
import { appAppMapHost } from "@/lib/core/app-map-host";
import { appAwardsHost } from "@/lib/core/awards-host";
import { appBrowserHost } from "@/lib/core/browser-host";
import { appCiHost } from "@/lib/core/ci-host";
import { appDesignSystemHost } from "@/lib/core/design-system-host";
import { entitlementsFor } from "@/lib/core/entitlements";
import { appEventsHost } from "@/lib/core/events-host";
import { appExplorerHost } from "@/lib/core/explorer-host";
import { appGamificationHost } from "@/lib/core/gamification-host";
import { createAppJobsHost } from "@/lib/core/jobs-host";
import { MANIFESTS } from "@/lib/core/manifests";
import { appLaunchHost } from "@/lib/core/launch-host";
import { appPlaygroundHost } from "@/lib/core/playground-host";
import { appRcaHost } from "@/lib/core/rca-host";
import { appReposHost } from "@/lib/core/repos-host";
import { appShareHost } from "@/lib/core/share-host";
import { appStorageHost } from "@/lib/core/storage-host";
import { appTestsHost } from "@/lib/core/tests-host";

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

function toTeamRef(team: { id: string; plan: string }): ContextScope["team"] {
  return {
    id: team.id,
    plan: team.plan as Plan,
    entitlements: entitlementsFor(team.plan as Plan),
  };
}

function toRepoRef(
  teamId: string,
  repo: { id: string; name: string; defaultBranch: string | null },
): NonNullable<ContextScope["repo"]> {
  return {
    id: repo.id,
    teamId,
    name: repo.name,
    defaultBranch: repo.defaultBranch ?? null,
  };
}

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

  if (req.repositoryId && req.teamId) {
    // Background path with a repository — a cron trigger firing, or a job
    // handler resuming work. There is no session here, so the session-based
    // branch below would throw on `headers()`; authorization is by *ownership*
    // instead, which is the only thing available and the only thing that
    // matters: the repository must belong to the team the caller claims.
    //
    // SECURITY: same rule as the team-only branch. `teamId` is trusted because
    // core's own scheduler and job worker are the only callers that may set it.
    // The ownership check below is what keeps that trust bounded — a stale or
    // wrong `repositoryId` cannot pull in another tenant's repo.
    const [team, repo] = await Promise.all([
      queries.getTeam(req.teamId),
      queries.getRepository(req.repositoryId),
    ]);
    if (!team) throw new Error(`Unknown team "${req.teamId}"`);
    if (!repo || repo.teamId !== team.id) {
      throw new Error(
        `Repository "${req.repositoryId}" does not belong to team "${req.teamId}"`,
      );
    }
    return {
      team: toTeamRef(team),
      repo: toRepoRef(team.id, repo),
      log,
    };
  }

  if (req.repositoryId) {
    const { team, repo } = await requireRepoAccess(req.repositoryId);
    // `repositories.teamId` is nullable in the schema, but `requireRepoAccess`
    // has already asserted it equals the session's team — so the authorized id
    // is both non-null and the correct one.
    return {
      team: toTeamRef(team),
      repo: toRepoRef(team.id, repo),
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
    return { team: toTeamRef(team), log };
  }

  const { team } = await requireTeamAccess();
  return { team: toTeamRef(team), log };
}

let cached:
  | { runtime: PluginRuntime; data: DataFactory; registry: ResolvedRegistry }
  | undefined;

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
  const jobsHost = createAppJobsHost((type) => registry.jobTypes.has(type));
  const runtime = createRuntime({
    registry,
    resolveScope,
    factories: {
      browser: createBrowserFactory(appBrowserHost, { maxSwarm }),
      data: (pluginId) => data.capability(pluginId),
      ai: createAiFactory(),
      repos: createReposFactory({ host: appReposHost }),
      tests: createTestsFactory({ host: appTestsHost }),
      jobs: createJobsFactory({ host: jobsHost }),
      storage: createStorageFactory({ host: appStorageHost }),
    },
  });

  // Hand each provider and each plugin its runtime. A plugin's `"use server"`
  // module is imported by Next.js rather than constructed, so there is no
  // other moment at which to pass one — see `plugins/explorer/src/wiring.ts`
  // for why the slots are realm-wide rather than module-level bindings.
  configureEvents(appEventsHost);
  configureExplorer({
    runtime,
    host: appExplorerHost,
    data: data.capability("explorer"),
  });
  configureDesignSystem(appDesignSystemHost);
  configureA11y({ runtime, data: data.capability("a11y") });
  configureRca({ runtime, host: appRcaHost });
  configureAppMap({ runtime, host: appAppMapHost });
  configureApiTest({ runtime, host: appApiTestHost });
  // No `runtime` — the launch board has no tenant, so there is no scope to
  // build a `ctx` from and nothing to build one for. See
  // `plugins/launch/src/wiring.ts`.
  configureLaunch({ host: appLaunchHost, data: data.capability("launch") });
  // Likewise untenanted, and now saying so: `tenancy: "none"` in its manifest
  // is what makes the missing `runtime` here a declared fact rather than an
  // omission — `buildContext` would refuse to give it a `ctx` at all.
  configurePlayground({
    host: appPlaygroundHost,
    data: data.capability("playground"),
  });
  // Tenanted, but likewise no `runtime`: every caller of `awardScore` supplies
  // a team it has already authorized, and `resolveScope` is documented not to
  // accept a request-supplied `teamId`. See `plugins/gamification/src/wiring.ts`.
  configureGamification({
    host: appGamificationHost,
    data: data.capability("gamification"),
  });
  // Tenanted *and* wired with a `runtime`, which no plugin before it needed
  // both of alongside a `data`. Its actions call `contextFor(ciPlugin)` with no
  // scope request at all — `resolveScope` falls through to `requireTeamAccess()`
  // — while its deletion hook and its GitLab webhook gate run with no session
  // and take the handle straight from the slot. See `plugins/ci/src/wiring.ts`.
  configureCi({ runtime, host: appCiHost, data: data.capability("ci") });
  // Tenanted (every row carries an ownerTeamId), but no `runtime`: every
  // action authorizes through `ShareHost.requireRepoAccess`/
  // `requireTeamAccess`, which return more than `PluginContext` carries
  // (user id, user email, team name, repo name) — a `contextFor()` call
  // would still need a second host call to fill that gap, so the host does
  // both in one. See `plugins/share/src/wiring.ts`.
  configureShare({ host: appShareHost, data: data.capability("share") });
  // Tenanted (every row hangs off a repo), but no `runtime`, for the same
  // reason as `gamification`: none of its three call paths (a build-
  // completion trigger, an already-authorized team read, an anonymous slug
  // lookup) would benefit from a `PluginContext`. See
  // `plugins/awards/src/wiring.ts`.
  configureAwards({ host: appAwardsHost, data: data.capability("awards") });

  // Core raises `tests` domain notifications through a port it owns; this is
  // where the feature that listens gets attached. `createTest` used to
  // `import("@/lib/gamification/hooks")` directly, which is core reaching into
  // a feature — see `src/lib/db/test-hooks.ts` for why that had to invert and
  // why the registration belongs here rather than in the query layer.
  //
  // Boot-time registration is what makes this equivalent to the old dynamic
  // import: `src/instrumentation.ts` awaits `getPluginRuntime()` before the
  // server handles a request, so no `createTest` can outrun it.
  const { onTestCreated } =
    await import("@lastest/plugin-gamification/actions");
  setTestCreatedListener(onTestCreated);

  cached = { runtime, data, registry };
  return runtime;
}

/**
 * One tick of the plugin job worker. Call from an interval, the same way
 * `src/lib/scheduling/scheduler.ts` calls `processDueExplorerTriggers` — kept
 * out of that file because nothing depends on it yet (no plugin declares
 * `capabilities: ["jobs"]`), so wiring the interval itself is deferred to
 * whoever registers the first job handler. This function is what they call.
 */
export async function processDuePluginJobs(): Promise<number> {
  const runtime = await getPluginRuntime();
  return processDueJobs({
    host: {
      claimDue: queries.claimDuePluginJobs,
      complete: queries.completePluginJob,
      failAttempt: queries.failPluginJobAttempt,
    },
    dispatch: (type, payload, run, scope) =>
      runtime.dispatch(type, payload, run, scope),
  });
}

/**
 * Stand-in plugin id for "the runtime itself could not be resolved".
 *
 * `PLUGIN_ID_RE` in the kernel requires kebab-case, so no real plugin can ever
 * claim this string and a caller inspecting the report cannot confuse the two.
 */
export const RUNTIME_FAILED = "<runtime>";

/**
 * Drive every plugin's deletion hook for one deleted core entity.
 *
 * This is the second half of `core-scope.md` §6. The first half — plugin tables
 * carry no FK to a core table, so `ON DELETE CASCADE` does not exist for them —
 * shipped with the explorer migration. Without this half, "delete my account"
 * leaves `explorer_knowledge.cred_password` (an encrypted credential belonging
 * to a user who just asked to be forgotten) in the database forever.
 *
 * `runDeletionHooks` owns the *iteration* semantics and documents them:
 * sequential, one failure does not stop the rest, failures returned rather than
 * thrown. This function owns the two decisions that are the *app's* to make:
 *
 * **1. It never throws.** Callers run it after core's own delete has already
 * committed (see `cascadePluginDeletion`), so throwing here would report a
 * failed deletion for an operation that has largely succeeded, and would give a
 * broken plugin a veto over account deletion. Resolving the runtime can throw
 * too — a bad manifest, an unreachable database — and that is caught for the
 * same reason.
 *
 * **2. Every failure is logged at `error` with the plugin id and the target
 * id.** The report is returned for callers that want it, but nothing in the app
 * currently inspects a return value from `deleteTeam`, so a report nobody reads
 * is the same as swallowing the error. The log line is the durable record: the
 * hooks are documented as idempotent, so `{pluginId, kind, id}` is everything
 * an operator needs to re-run one by hand.
 */
export async function runPluginDeletion(
  target: DeletionTarget,
): Promise<DeletionReport> {
  const log = getLogger("plugin-deletion");

  try {
    // Resolving the runtime is what calls `configureExplorer`, and a plugin's
    // deletion hook reaches its data capability through that wiring — so this
    // await is required, not incidental. It is cached after the first call.
    await getPluginRuntime();
  } catch (err) {
    log.error(
      { err, kind: target.kind, targetId: target.id },
      "plugin runtime unavailable — plugin rows for this deleted entity were NOT removed",
    );
    // Reported as a failure rather than an empty success: no hook ran, and a
    // report claiming `failed: []` would read as "nothing to clean up".
    return {
      target,
      ran: [],
      skipped: [],
      failed: [{ pluginId: RUNTIME_FAILED, error: err }],
    };
  }

  const registry = cached!.registry;
  const report = await runDeletionHooks(registry.plugins, target);

  for (const failure of report.failed) {
    log.error(
      {
        err: failure.error,
        pluginId: failure.pluginId,
        kind: target.kind,
        targetId: target.id,
      },
      "plugin deletion hook failed — rows may be orphaned; the hook is idempotent and safe to re-run",
    );
  }

  return report;
}
