"use server";

import { revalidatePath } from "next/cache";
import { getNextRunTime, isValidCron } from "@lastest/cron";

import { orm } from "./data/db";
import * as q from "./data/queries";
import { parseStyleRotation } from "./domain/styles";
import type { ExplorerHost } from "./host";
import { explorerPlugin } from "./index";
import {
  abortSession,
  buildSteps,
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_CAP,
  runPipeline,
  type ExplorerContext,
} from "./pipeline";
import type { ExplorerFinding, ExplorerSession } from "./schema";
import type {
  ExplorerFindingStatus,
  ExplorerSessionTrigger,
  ExplorerStyle,
  KnowledgePageAutomationStep,
} from "./types";
import { explorerWiring } from "./wiring";

/**
 * Explorer's server actions.
 *
 * Spike S1 proved a `"use server"` module inside a `transpilePackages`
 * workspace package produces real, dispatchable action ids — verified against
 * `server-reference-manifest.json` in an actual build — so these live in the
 * package with no codegen and no shim. Note the trap S1 also found: an
 * `export { x } from "…"` re-export inside a `"use server"` file compiles to a
 * module with *no exports at all*. Every action here is declared locally for
 * that reason.
 *
 * ### Where authorization went
 *
 * Every one of these used to open with `requireRepoAccess(repositoryId)` or
 * `requireTeamAccess()`. None of them do now, and that is not a regression —
 * it is the point of `contextFor()`. The runtime's `resolveScope` runs the
 * app's auth guard and returns a team and repo the caller is *proven* to have;
 * every capability on the resulting context is bound to them. A plugin cannot
 * widen its own scope because there is no `setTeam` and no unscoped handle.
 *
 * The practical effect on this file: a forgotten guard is no longer possible,
 * because there is no path that reaches data without one.
 */

async function context(repositoryId?: string): Promise<{
  ctx: ExplorerContext;
  host: ExplorerHost;
}> {
  const { runtime, host } = explorerWiring();
  const ctx = await runtime.contextFor(explorerPlugin, { repositoryId });
  return { ctx, host };
}

function dataOf(ctx: ExplorerContext, host: ExplorerHost) {
  return { db: orm(ctx.data), host };
}

/** Entitlement gate. The plugin asks for a capability name, never a plan. */
function assertEntitled(ctx: ExplorerContext): void {
  if (!ctx.team.entitlements.has("qa-agent")) {
    throw new Error(
      "The Explorer is not included in this plan. Upgrade to run autonomous exploration.",
    );
  }
}

// ── starting and controlling a run ───────────────────────────────────────────

export interface StartExplorerInput {
  repositoryId: string;
  targetUrl: string;
  maxIterations?: number;
  styleRotation?: ExplorerStyle[];
  email?: string;
  password?: string;
}

async function startCore(
  ctx: ExplorerContext,
  host: ExplorerHost,
  input: StartExplorerInput,
  trigger: ExplorerSessionTrigger,
): Promise<{ sessionId: string }> {
  const db = dataOf(ctx, host);

  const targetUrl = input.targetUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error("Target URL must start with http(s)://");
  }
  // SSRF guard. Core's, not the plugin's — a feature that forgets this one
  // hands a tenant the metadata service.
  await host.assertSafeOutboundUrl(targetUrl);

  // One active explorer session per repo: two agents driving the same app at
  // once produce findings neither can attribute.
  const existing = await q.getActiveSession(db, input.repositoryId);
  if (existing) {
    abortSession(existing.id);
    await q.updateSession(db, existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const settings = await host.getSettings(input.repositoryId).catch(() => ({
    maxIterations: DEFAULT_MAX_ITERATIONS,
    styleRotation: null,
  }));

  const maxIterations = Math.max(
    1,
    Math.min(
      input.maxIterations ?? settings.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      MAX_ITERATIONS_CAP,
    ),
  );
  const styleRotation =
    input.styleRotation && input.styleRotation.length > 0
      ? input.styleRotation
      : parseStyleRotation(settings.styleRotation);
  const credsProvided = Boolean(input.email?.trim() && input.password);

  const session = await q.createSession(db, {
    repositoryId: input.repositoryId,
    teamId: ctx.team.id,
    currentStepId: "explorer_setup",
    steps: buildSteps(maxIterations),
    metadata: {
      targetUrl,
      maxIterations,
      iteration: 0,
      styleRotation,
      trigger,
      credsProvided,
      ...(credsProvided
        ? { email: input.email!.trim(), password: input.password! }
        : {}),
    },
  });

  void ctx.events.emit("session:start", {
    sessionId: session.id,
    summary: `Explorer started on ${targetUrl} (${maxIterations} iterations, ${styleRotation.join("→")})`,
  });

  // Detached: the UI polls. An unhandled rejection here would surface as a
  // process-level warning long after the request that started it returned,
  // which is why the catch is not optional.
  void runPipeline(ctx, host, session.id).catch((err) =>
    ctx.log.error({ err, sessionId: session.id }, "explorer pipeline crashed"),
  );

  return { sessionId: session.id };
}

export async function startExplorerAgent(
  input: StartExplorerInput,
): Promise<{ sessionId: string }> {
  const { ctx, host } = await context(input.repositoryId);
  assertEntitled(ctx);
  const result = await startCore(ctx, host, input, "manual");
  revalidatePath("/explorer");
  return result;
}

/** Load a session and prove it belongs to the caller's team. */
async function ownedSession(sessionId: string): Promise<{
  ctx: ExplorerContext;
  host: ExplorerHost;
  session: ExplorerSession;
}> {
  const { ctx, host } = await context();
  const session = await q.getSession(dataOf(ctx, host), sessionId);
  // Same message for "missing" and "someone else's" — the difference is itself
  // information about another team's data.
  if (!session || session.teamId !== ctx.team.id) {
    throw new Error("Explorer session not found");
  }
  return { ctx, host, session };
}

export async function getExplorerSession(
  sessionId: string,
): Promise<ExplorerSession | null> {
  try {
    const { session } = await ownedSession(sessionId);
    return session;
  } catch {
    return null;
  }
}

export async function getLatestExplorerSession(
  repositoryId: string,
): Promise<ExplorerSession | null> {
  const { ctx, host } = await context(repositoryId);
  const session = await q.getLatestSession(dataOf(ctx, host), repositoryId);
  return session ?? null;
}

export async function getRecentExplorerSessions(
  repositoryId: string,
  limit = 10,
): Promise<ExplorerSession[]> {
  const { ctx, host } = await context(repositoryId);
  return q.getRecentSessions(dataOf(ctx, host), repositoryId, limit);
}

export async function pauseExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { ctx, host, session } = await ownedSession(sessionId);
  if (session.status !== "active") return { success: false };
  abortSession(sessionId);
  await q.updateSession(dataOf(ctx, host), sessionId, { status: "paused" });
  revalidatePath("/explorer");
  return { success: true };
}

export async function resumeExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { ctx, host, session } = await ownedSession(sessionId);
  if (session.status !== "paused") return { success: false };
  // Re-open the interrupted step so the resume-safe driver re-runs it.
  await q.updateSession(dataOf(ctx, host), sessionId, {
    status: "active",
    steps: session.steps.map((s) =>
      s.status === "active" ? { ...s, status: "pending" as const } : s,
    ),
  });
  // Re-scoped to the session's repo: the resume request only proved team
  // access, and the pipeline needs a repo-scoped context to run under.
  const scoped = (await explorerWiring().runtime.contextFor(explorerPlugin, {
    repositoryId: session.repositoryId,
  })) as ExplorerContext;
  void runPipeline(scoped, host, sessionId).catch((err) =>
    ctx.log.error({ err, sessionId }, "explorer resume crashed"),
  );
  revalidatePath("/explorer");
  return { success: true };
}

export async function cancelExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { ctx, host, session } = await ownedSession(sessionId);
  abortSession(sessionId);
  await q.updateSession(dataOf(ctx, host), sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  // `ownedSession` only proves team access; `ctx.events.emit` attributes the
  // event to `ctx.repo.id`, so cancellation needs a repo-scoped context to
  // carry that attribution at all — same reason `resumeExplorerAgent` above
  // re-scopes before it needs a repo-bound capability.
  const scoped = (await explorerWiring().runtime.contextFor(explorerPlugin, {
    repositoryId: session.repositoryId,
  })) as ExplorerContext;
  void scoped.events.emit("session:error", {
    sessionId,
    summary: "Explorer cancelled by user",
  });
  revalidatePath("/explorer");
  return { success: true };
}

// ── findings ─────────────────────────────────────────────────────────────────

export async function listExplorerFindings(
  sessionId: string,
): Promise<ExplorerFinding[]> {
  const { ctx, host, session } = await ownedSession(sessionId);
  return q.listFindingsBySession(dataOf(ctx, host), session.id);
}

export async function listRepoFindings(
  repositoryId: string,
): Promise<ExplorerFinding[]> {
  const { ctx, host } = await context(repositoryId);
  return q.listFindingsByRepo(dataOf(ctx, host), repositoryId);
}

export async function setFindingStatus(
  findingId: string,
  status: ExplorerFindingStatus,
): Promise<{ success: boolean }> {
  const { ctx, host } = await context();
  const db = dataOf(ctx, host);
  const finding = await q.getFinding(db, findingId);
  if (!finding || finding.teamId !== ctx.team.id) return { success: false };
  await q.updateFindingStatus(db, findingId, status);
  revalidatePath("/explorer");
  return { success: true };
}

// ── knowledge ────────────────────────────────────────────────────────────────

export interface ExplorerKnowledgeView {
  id: string;
  title: string;
  urlPattern: string;
  matchKind: "exact" | "prefix" | "regex";
  body: string;
  credEmail: string | null;
  hasCredentials: boolean;
  enabled: boolean;
}

export async function listExplorerKnowledge(
  repositoryId: string,
): Promise<ExplorerKnowledgeView[]> {
  const { ctx, host } = await context(repositoryId);
  const rows = await q.listKnowledgeByRepo(dataOf(ctx, host), repositoryId);
  // Presence flag only. A password that reaches the client has left the server,
  // and no UI here needs it.
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    urlPattern: r.urlPattern,
    matchKind: r.matchKind,
    body: r.body,
    credEmail: r.credEmail,
    hasCredentials: Boolean(r.credPassword),
    enabled: r.enabled,
  }));
}

export interface UpsertKnowledgeInput {
  id?: string;
  repositoryId: string;
  title: string;
  urlPattern: string;
  matchKind: "exact" | "prefix" | "regex";
  body: string;
  credEmail?: string;
  /** Only sent when (re)setting the password; omitted = keep existing. */
  credPassword?: string;
  pageAutomation?: KnowledgePageAutomationStep[];
  enabled?: boolean;
}

export async function upsertExplorerKnowledge(
  input: UpsertKnowledgeInput,
): Promise<{ id: string }> {
  const { ctx, host } = await context(input.repositoryId);
  const db = dataOf(ctx, host);
  if (!input.title.trim() || !input.urlPattern.trim() || !input.body.trim()) {
    throw new Error("Title, URL pattern, and body are required");
  }
  const patch = {
    title: input.title.trim().slice(0, 200),
    urlPattern: input.urlPattern.trim().slice(0, 300),
    matchKind: input.matchKind,
    body: input.body.slice(0, 20_000),
    credEmail: input.credEmail?.trim() || null,
    ...(input.credPassword !== undefined
      ? { credPassword: input.credPassword || null }
      : {}),
    pageAutomation: input.pageAutomation ?? null,
    enabled: input.enabled ?? true,
  };

  if (input.id) {
    const existing = await q.getKnowledge(db, input.id);
    if (!existing || existing.repositoryId !== input.repositoryId) {
      throw new Error("Knowledge note not found");
    }
    await q.updateKnowledge(db, input.id, patch);
    revalidatePath("/explorer");
    return { id: input.id };
  }
  const created = await q.createKnowledge(db, {
    ...patch,
    repositoryId: input.repositoryId,
    teamId: ctx.team.id,
    credPassword: input.credPassword || null,
  });
  revalidatePath("/explorer");
  return { id: created.id };
}

export async function deleteExplorerKnowledge(
  id: string,
  repositoryId: string,
): Promise<{ success: boolean }> {
  const { ctx, host } = await context(repositoryId);
  const db = dataOf(ctx, host);
  const existing = await q.getKnowledge(db, id);
  if (!existing || existing.repositoryId !== repositoryId) {
    return { success: false };
  }
  await q.deleteKnowledge(db, id);
  revalidatePath("/explorer");
  return { success: true };
}

export async function listExplorerExperience(repositoryId: string) {
  const { ctx, host } = await context(repositoryId);
  return q.listExperienceByRepo(dataOf(ctx, host), repositoryId);
}

// ── trigger config + scheduled dispatch ──────────────────────────────────────

export interface ExplorerTriggerConfigInput {
  repositoryId: string;
  scheduleEnabled: boolean;
  cronExpression?: string | null;
  maxIterations?: number;
  /** Where a scheduled run should point. See `ctx.repos.baseUrl`. */
  targetUrl?: string | null;
}

export async function getExplorerTriggerConfig(repositoryId: string) {
  const { ctx, host } = await context(repositoryId);
  return (await q.getTrigger(dataOf(ctx, host), repositoryId)) ?? null;
}

export async function updateExplorerTriggerConfig(
  input: ExplorerTriggerConfigInput,
): Promise<{ success: boolean }> {
  const { ctx, host } = await context(input.repositoryId);
  assertEntitled(ctx);

  let nextRunAt: Date | null = null;
  if (input.scheduleEnabled) {
    if (!input.cronExpression || !isValidCron(input.cronExpression)) {
      throw new Error(
        "A valid cron expression is required to enable the schedule",
      );
    }
    nextRunAt = getNextRunTime(input.cronExpression);
  }

  await q.upsertTrigger(dataOf(ctx, host), input.repositoryId, ctx.team.id, {
    scheduleEnabled: input.scheduleEnabled,
    cronExpression: input.cronExpression ?? null,
    maxIterations: Math.max(
      1,
      Math.min(input.maxIterations ?? 4, MAX_ITERATIONS_CAP),
    ),
    ...(input.targetUrl === undefined ? {} : { targetUrl: input.targetUrl }),
    nextRunAt,
  });
  revalidatePath("/explorer");
  return { success: true };
}

/**
 * Fire due explorer cron triggers. Called from the scheduler tick.
 *
 * There is no user session here, so scope comes from the trigger's own
 * `teamId`. `ScopeRequest.teamId` is documented as trusted only when the caller
 * is core itself — this is one of those callers, and it must never become
 * reachable from a request path.
 */
export async function dispatchDueExplorerTriggers(): Promise<number> {
  const { runtime, host, data } = explorerWiring();
  const systemDb = { db: orm(data), host };
  const due = await q.getDueTriggers(systemDb).catch(() => []);
  let fired = 0;

  for (const trigger of due) {
    const nextRunAt = trigger.cronExpression
      ? getNextRunTime(trigger.cronExpression)
      : null;
    // Every path below re-arms, including the ones that decline to fire: a
    // trigger that stops advancing `nextRunAt` is permanently due and gets
    // re-examined on every scheduler tick forever.
    let ctx: ExplorerContext | undefined;
    try {
      ctx = (await runtime.contextFor(explorerPlugin, {
        repositoryId: trigger.repositoryId,
        teamId: trigger.teamId,
      })) as ExplorerContext;
      const db = dataOf(ctx, host);

      const active = await q.getActiveSession(db, trigger.repositoryId);
      if (active) {
        await q.markTriggerFired(db, trigger.id, { nextRunAt });
        continue;
      }

      // Triggers respect the same gate as the UI. A team that armed one on Pro
      // must stop getting scheduled runs after downgrading — re-armed rather
      // than disabled, so it resumes if they upgrade again.
      if (!ctx.team.entitlements.has("qa-agent")) {
        await q.markTriggerFired(db, trigger.id, { nextRunAt });
        continue;
      }

      const targetUrl =
        trigger.targetUrl ??
        (await ctx.repos
          .baseUrl(trigger.repositoryId, ctx.repo?.defaultBranch)
          .catch(() => null));
      if (!targetUrl) {
        await q.markTriggerFired(db, trigger.id, { nextRunAt });
        continue;
      }

      const { sessionId } = await startCore(
        ctx,
        host,
        {
          repositoryId: trigger.repositoryId,
          targetUrl,
          maxIterations: trigger.maxIterations,
        },
        "schedule",
      );
      await q.markTriggerFired(db, trigger.id, {
        nextRunAt,
        lastRunAt: new Date(),
        lastSessionId: sessionId,
      });
      fired++;
    } catch (err) {
      // Never silent. A bare `catch {}` here made a broken scheduled run
      // indistinguishable from "nothing was due": the trigger re-arms, the next
      // tick fails the same way, and the operator sees an explorer that simply
      // never runs on schedule with nothing in the logs to explain it.
      //
      // `ctx.log` when the context was built, `console` when building it is
      // what failed — a plugin has no logger of its own, and the app's
      // console bridge lifts the `[explorer]` prefix into a scope in
      // production.
      const detail = {
        err,
        triggerId: trigger.id,
        repositoryId: trigger.repositoryId,
      };
      const message = "scheduled explorer trigger failed — re-armed, not run";
      if (ctx) ctx.log.error(detail, message);
      else console.error(`[explorer] ${message}`, detail);

      await q
        .markTriggerFired(systemDb, trigger.id, { nextRunAt })
        .catch(() => {});
    }
  }
  return fired;
}
