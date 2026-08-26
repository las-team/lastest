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
  requireSlot,
  resolveRegistry,
  wiringSlotsFor,
  type ContextScope,
  type PluginRuntime,
  type ResolvedRegistry,
  type ScopeRequest,
  type WiringSlots,
} from "@lastest/kernel";
import type { StorageHost } from "@lastest/core-storage";
import { sql } from "@lastest/db";
import { configureA11y } from "@lastest/plugin-a11y";
import { configureApiTest } from "@lastest/plugin-api-test";
import { configureAppMap } from "@lastest/plugin-app-map";
import { configureAuthoringAi } from "@lastest/plugin-authoring-ai";
import { configureAwards } from "@lastest/plugin-awards";
import { configureCi } from "@lastest/plugin-ci";
import { configureDataSources } from "@lastest/plugin-data-sources";
import { configureDesignSystem } from "@lastest/plugin-design-system";
import { configureEvents } from "@lastest/plugin-events";
import { configureExplorer } from "@lastest/plugin-explorer";
import { configureGamification } from "@lastest/plugin-gamification";
import { configureLaunch } from "@lastest/plugin-launch";
import { configurePlayground } from "@lastest/plugin-playground";
import { configureQaAgent } from "@lastest/plugin-qa-agent";
import { configureQuickstart } from "@lastest/plugin-quickstart";
import { configureRanger } from "@lastest/plugin-ranger";
import { configureRca } from "@lastest/plugin-rca";
import { configureRecorder } from "@lastest/plugin-recorder";
import { configureScheduling } from "@lastest/plugin-scheduling";
import { configureShare } from "@lastest/plugin-share";

import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { setTestCreatedListener } from "@/lib/db/test-hooks";
import { getLogger } from "@/lib/logger";
import { createAiFactory } from "@/lib/core/ai-capability";
import { appApiTestHost } from "@/lib/core/api-test-host";
import { appAppMapHost } from "@/lib/core/app-map-host";
import { appAuthoringAiHost } from "@/lib/core/authoring-ai-host";
import { appAwardsHost } from "@/lib/core/awards-host";
import { appBrowserHost } from "@/lib/core/browser-host";
import { appCiHost } from "@/lib/core/ci-host";
import { appDataSourcesHost } from "@/lib/core/data-sources-host";
import { appDesignSystemHost } from "@/lib/core/design-system-host";
import { entitlementsFor } from "@/lib/core/entitlements";
import { appEventsHost } from "@/lib/core/events-host";
import { appExplorerHost } from "@/lib/core/explorer-host";
import { appGamificationHost } from "@/lib/core/gamification-host";
import { createAppJobsHost } from "@/lib/core/jobs-host";
import { MANIFESTS } from "@/lib/core/manifests";
import { appLaunchHost } from "@/lib/core/launch-host";
import { appPlaygroundHost } from "@/lib/core/playground-host";
import { appQaAgentHost } from "@/lib/core/qa-agent-host";
import { appQuickstartHost } from "@/lib/core/quickstart-host";
import { appRangerHost } from "@/lib/core/ranger-host";
import { appRcaHost } from "@/lib/core/rca-host";
import { appRecorderHost } from "@/lib/core/recorder-host";
import { appReposHost } from "@/lib/core/repos-host";
import { appSchedulingHost } from "@/lib/core/scheduling-host";
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

function toTeamRef(team: {
  id: string;
  name: string;
  slug: string;
  plan: string;
}): ContextScope["team"] {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    plan: team.plan as Plan,
    entitlements: entitlementsFor(team.plan as Plan),
  };
}

function toActorRef(user: {
  id: string;
  email: string;
}): NonNullable<ContextScope["actor"]> {
  return { userId: user.id, email: user.email };
}

function toRepoRef(
  teamId: string,
  repo: {
    id: string;
    name: string;
    fullName: string;
    defaultBranch: string | null;
  },
): NonNullable<ContextScope["repo"]> {
  return {
    id: repo.id,
    teamId,
    name: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch ?? null,
  };
}

/**
 * Resolve the caller to a team, a repo, a logger — and, on session paths, the
 * acting user (`actor`). Background branches carry no actor, which is how a
 * plugin can tell "a person did this" from "the scheduler did this":
 * `requireActor(ctx)` throws on the latter.
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
    const { team, repo, user } = await requireRepoAccess(req.repositoryId);
    // `repositories.teamId` is nullable in the schema, but `requireRepoAccess`
    // has already asserted it equals the session's team — so the authorized id
    // is both non-null and the correct one.
    return {
      team: toTeamRef(team),
      repo: toRepoRef(team.id, repo),
      actor: toActorRef(user),
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

  const { team, user } = await requireTeamAccess();
  return { team: toTeamRef(team), actor: toActorRef(user), log };
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

  // Hand each plugin what the kernel derived for it. A plugin's `"use server"`
  // module is imported by Next.js rather than constructed, so there is no
  // other moment at which to pass one — see `plugins/explorer/src/wiring.ts`
  // for why the slots are realm-wide rather than module-level bindings.
  //
  // The slots themselves are *data, not decisions*: `wiringSlotsFor` derives
  // them from each manifest (`runtime` iff tenanted, `data` iff it owns a
  // schema, `storageHost` iff it consumes `storage`), so this table only says
  // which host object composes with each plugin and which of its granted
  // slots its wiring takes. `need()` asserts a slot was granted — a wiring
  // that asks for one its manifest does not grant is a boot error here, not a
  // review catch. Two shapes remain, both visible at a glance:
  //
  // - **tenanted** (everything except launch/playground): auth happens in
  //   `resolveScope` for every plugin that takes `need("runtime")`; the bare
  //   `need("data")` handle beside it is for the callers that have no scope
  //   to build a context from (deletion hooks, background dispatchers,
  //   anonymous reads — e.g. awards' public badge, ci's webhook gate). The
  //   host-only rows (events, design-system, recorder) predate `contextFor`
  //   auth and keep their guards on the host — see each plugin's `host.ts`.
  // - **untenanted** (launch, playground — `tenancy: "none"`): no runtime to
  //   take; `buildContext` would refuse them a `ctx` anyway.
  type Slots = WiringSlots<PluginRuntime, StorageHost>;
  type Need = <K extends keyof Slots>(name: K) => NonNullable<Slots[K]>;
  const wire: Readonly<Record<string, (need: Need) => void>> = {
    events: () => configureEvents(appEventsHost),
    "design-system": () => configureDesignSystem(appDesignSystemHost),
    recorder: () => configureRecorder(appRecorderHost),
    explorer: (need) =>
      configureExplorer({
        runtime: need("runtime"),
        host: appExplorerHost,
        data: need("data"),
      }),
    a11y: (need) =>
      configureA11y({ runtime: need("runtime"), data: need("data") }),
    rca: (need) => configureRca({ runtime: need("runtime"), host: appRcaHost }),
    "app-map": (need) =>
      configureAppMap({ runtime: need("runtime"), host: appAppMapHost }),
    "authoring-ai": (need) =>
      configureAuthoringAi({
        runtime: need("runtime"),
        host: appAuthoringAiHost,
      }),
    "api-test": (need) =>
      configureApiTest({ runtime: need("runtime"), host: appApiTestHost }),
    launch: (need) =>
      configureLaunch({ host: appLaunchHost, data: need("data") }),
    playground: (need) =>
      configurePlayground({ host: appPlaygroundHost, data: need("data") }),
    gamification: (need) =>
      configureGamification({
        runtime: need("runtime"),
        host: appGamificationHost,
        data: need("data"),
      }),
    ci: (need) =>
      configureCi({
        runtime: need("runtime"),
        host: appCiHost,
        data: need("data"),
      }),
    share: (need) =>
      configureShare({
        runtime: need("runtime"),
        host: appShareHost,
        data: need("data"),
      }),
    awards: (need) =>
      configureAwards({
        runtime: need("runtime"),
        host: appAwardsHost,
        data: need("data"),
      }),
    ranger: (need) =>
      configureRanger({
        runtime: need("runtime"),
        host: appRangerHost,
        data: need("data"),
      }),
    "data-sources": (need) =>
      configureDataSources({
        runtime: need("runtime"),
        host: appDataSourcesHost,
        data: need("data"),
        storageHost: need("storageHost"),
      }),
    scheduling: (need) =>
      configureScheduling({
        runtime: need("runtime"),
        host: appSchedulingHost,
        data: need("data"),
      }),
    quickstart: (need) =>
      configureQuickstart({
        runtime: need("runtime"),
        host: appQuickstartHost,
      }),
    "qa-agent": (need) =>
      configureQaAgent({
        runtime: need("runtime"),
        host: appQaAgentHost,
        data: need("data"),
      }),
  };

  const registered = new Set(registry.plugins.map((p) => p.id));
  for (const id of Object.keys(wire)) {
    if (!registered.has(id)) {
      throw new Error(
        `runtime.ts wires plugin "${id}", which is not in MANIFESTS — remove ` +
          `the row or register the manifest`,
      );
    }
  }
  for (const manifest of registry.plugins) {
    const entry = wire[manifest.id];
    if (!entry) {
      throw new Error(
        `Plugin "${manifest.id}" is registered in MANIFESTS but has no wiring ` +
          `row in runtime.ts`,
      );
    }
    const slots = wiringSlotsFor(manifest, {
      runtime,
      dataFor: (id) => data.capability(id),
      storageHost: appStorageHost,
    });
    entry((name) => requireSlot(slots[name], manifest.id, name));
  }

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
 * `src/lib/core/scheduler.ts` calls `processDueExplorerTriggers` — kept
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
