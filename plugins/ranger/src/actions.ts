import type { PluginContext } from "@lastest/contracts";

import { browsePageMap } from "./browse";
import { orm } from "./data/db";
import * as q from "./data/queries";
import { RangerSessionNotFoundError } from "./errors";
import type { RangerHost } from "./host";
import { rangerPlugin } from "./index";
import type { RangerSession } from "./schema";
import type { RangerStepId, RangerStepState } from "./types";
import { rangerWiring } from "./wiring";

/**
 * Ranger has no UI of its own (MCP-driven, polled over `/api/v1/ranger/*`
 * — see the migration result doc §3), so nothing here is called from a
 * client component. **Deliberately not `"use server"`.**
 *
 * That directive marks a function as invokable through Next.js's client
 * action-dispatch protocol; a file that carries it but is only ever reached
 * by a server-side `import()` (the app's `/api/v1/[...slug]/route.ts`, in
 * this case) mints zero action ids and does nothing useful with the
 * directive — the recipe's §8 warns against exactly that shape: "a
 * `"use server"` export nobody dispatches is not neutral". `launch` is the
 * precedent for dropping it outright when a plugin's only surface is a
 * route, not a page; the difference here is the route lives in the app
 * rather than the plugin (see host.ts's sibling note in the result doc),
 * not in whether the directive belongs.
 *
 * The auth story is unchanged either way: every function opens with
 * `contextFor()`, which runs the app's guard through `resolveScope` and
 * returns a team (and, when a `repositoryId` is passed, a repo) the caller
 * is *proven* to have — the same shape `plugins/explorer/src/actions.ts`
 * uses for its own, actually-dispatched actions.
 */

type RangerCtx = PluginContext<"browser" | "repos" | "events" | "data">;

async function context(
  repositoryId?: string,
): Promise<{ ctx: RangerCtx; host: RangerHost }> {
  const { runtime, host } = rangerWiring();
  const ctx = await runtime.contextFor(rangerPlugin, { repositoryId });
  return { ctx, host };
}

const RANGER_STEPS: Array<{
  id: RangerStepId;
  label: string;
  description: string;
}> = [
  {
    id: "ranger_provision",
    label: "Provision browser",
    description: "Claim an Embedded Browser and start the live stream",
  },
  {
    id: "ranger_browse",
    label: "Browse & map",
    description: "Navigate the URL and extract a rendered page map",
  },
];

function emit(
  ctx: RangerCtx,
  sessionId: string,
  type: string,
  summary: string,
  extra?: { stepId?: string; detail?: Record<string, unknown> },
) {
  void ctx.events
    .emit(type, { sessionId, summary, ...extra })
    .catch((err) => ctx.log.warn({ err, type }, "ranger activity emit failed"));
}

async function executeRanger(
  ctx: RangerCtx,
  sessionId: string,
  url: string,
  viewport?: { width: number; height: number },
): Promise<void> {
  const db = orm(ctx.data);
  let provisioned = false;

  try {
    await q.patchStep(db, sessionId, "ranger_provision", {
      status: "active",
      startedAt: new Date().toISOString(),
    });
    emit(ctx, sessionId, "step:start", "Provisioning browser", {
      stepId: "ranger_provision",
    });

    const pageMap = await ctx.browser.withBrowser(
      {
        purpose: "interactive",
        onQueued: () => {
          void q
            .mergeMetadata(db, sessionId, { queuedForBrowser: true })
            .catch(() => {});
        },
      },
      async (browserSession) => {
        provisioned = true;
        await q.mergeMetadata(db, sessionId, {
          queuedForBrowser: false,
          streamUrl: browserSession.streamUrl ?? undefined,
        });
        await q.patchStep(db, sessionId, "ranger_provision", {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        emit(ctx, sessionId, "step:complete", "Browser ready", {
          stepId: "ranger_provision",
        });

        await q.patchStep(db, sessionId, "ranger_browse", {
          status: "active",
          startedAt: new Date().toISOString(),
        });
        emit(ctx, sessionId, "step:start", `Browsing ${url}`, {
          stepId: "ranger_browse",
        });

        return browsePageMap(browserSession.page, url, viewport);
      },
    );

    await q.mergeMetadata(db, sessionId, { rangerPageMap: pageMap });
    await q.patchStep(db, sessionId, "ranger_browse", {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        links: pageMap.links.length,
        forms: pageMap.forms.length,
        buttons: pageMap.buttons.length,
        testIds: pageMap.testIds.length,
      },
    });
    emit(
      ctx,
      sessionId,
      "step:complete",
      `Mapped ${url}: ${pageMap.links.length} links, ${pageMap.forms.length} forms, ${pageMap.buttons.length} buttons`,
      { stepId: "ranger_browse" },
    );

    await q.completeSession(db, sessionId, "completed");
    emit(ctx, sessionId, "session:complete", "Ranger complete");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failedStep: RangerStepId = provisioned
      ? "ranger_browse"
      : "ranger_provision";
    await q
      .patchStep(db, sessionId, failedStep, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: msg,
      })
      .catch(() => {});
    await q.completeSession(db, sessionId, "failed").catch(() => {});
    emit(ctx, sessionId, "session:error", `Failed: ${msg}`);
  } finally {
    // The stream grant dies with the `withBrowser` scope; clear the pointer
    // so a completed session does not advertise a stream that no longer
    // resolves.
    await q
      .mergeMetadata(db, sessionId, { streamUrl: undefined })
      .catch(() => {});
  }
}

/**
 * Start an async ranger session. Returns immediately with a sessionId; poll
 * `getRangerSession` for status, the live streamUrl, and the final page map.
 */
export async function startRanger(
  repositoryId: string,
  opts: { url?: string; viewport?: { width: number; height: number } },
): Promise<{ sessionId: string }> {
  const { ctx, host } = await context(repositoryId);

  const url = opts.url || (await ctx.repos.baseUrl(repositoryId)) || undefined;
  if (!url) {
    throw new Error("No url provided and the repo has no base URL set");
  }
  await host.assertSafeOutboundUrl(url);

  const steps: RangerStepState[] = RANGER_STEPS.map((s, i) => ({
    id: s.id,
    status: i === 0 ? "active" : "pending",
    label: s.label,
    description: s.description,
  }));

  const db = orm(ctx.data);
  const session = await q.createSession(db, {
    repositoryId,
    teamId: ctx.team.id,
    steps,
    metadata: { rangerUrl: url },
  });

  emit(ctx, session.id, "session:start", `Ranger started on ${url}`);

  executeRanger(ctx, session.id, url, opts.viewport).catch((err) => {
    ctx.log.error({ err }, "ranger session crashed outside its own guard");
  });

  return { sessionId: session.id };
}

export async function getRangerSession(
  sessionId: string,
): Promise<RangerSession | null> {
  const { ctx } = await context();
  const db = orm(ctx.data);
  const session = await q.getSession(db, sessionId);
  if (!session || session.teamId !== ctx.team.id) return null;
  return session;
}

export async function cancelRanger(
  sessionId: string,
): Promise<{ success: true }> {
  const { ctx } = await context();
  const db = orm(ctx.data);
  const session = await q.getSession(db, sessionId);
  if (!session || session.teamId !== ctx.team.id) {
    throw new RangerSessionNotFoundError();
  }
  await q.completeSession(db, sessionId, "cancelled");
  return { success: true };
}
