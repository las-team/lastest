"use server";

import * as queries from "@/lib/db/queries";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { claimEmbeddedBrowserForAgent } from "./ai";
import { releasePoolEB } from "./embedded-sessions";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { appendStreamToken } from "@/lib/eb/stream-token";
import { browsePageMap } from "@/lib/playwright/ranger";
import type {
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepState,
  ActivityEventType,
} from "@/lib/db/schema";

/**
 * Ranger — an MCP-triggered, EB-backed live page scout. Unlike `scout` (static,
 * no browser), ranger provisions an Embedded Browser, drives it over CDP, and is
 * watchable online: the EB screencast streams to the activity feed while it
 * browses, exactly like the play/quickstart agents. It runs deterministically
 * (no in-product AI) and persists a rendered page map for the calling agent.
 */

function proxiedStream(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const proxied = toProxyStreamUrl(raw);
  if (!proxied) return undefined;
  return appendStreamToken(proxied, process.env.STREAM_AUTH_TOKEN) || undefined;
}

function emit(
  teamId: string,
  repositoryId: string,
  sessionId: string,
  eventType: ActivityEventType,
  summary: string,
  opts?: { stepId?: string; detail?: Record<string, unknown> },
) {
  emitAndPersistActivityEvent({
    teamId,
    repositoryId,
    sessionId,
    sourceType: "play_agent",
    eventType,
    summary,
    stepId: opts?.stepId ?? null,
    agentType: "ranger",
    detail: opts?.detail ?? null,
    artifactType: null,
    artifactId: null,
    artifactLabel: null,
    durationMs: null,
    promptLogId: null,
  }).catch((err) => console.error("[Ranger] activity emit error:", err));
}

const RANGER_STEPS: Array<{
  id: AgentStepId;
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

async function patchStep(
  sessionId: string,
  stepId: AgentStepId,
  patch: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...patch };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId:
      patch.status === "active" ? stepId : (session.currentStepId ?? undefined),
  });
}

async function mergeMetadata(
  sessionId: string,
  patch: Partial<AgentSessionMetadata>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  await queries.updateAgentSession(sessionId, {
    metadata: { ...session.metadata, ...patch },
  });
}

async function executeRanger(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  url: string,
  viewport?: { width: number; height: number },
) {
  let runnerId: string | undefined;
  try {
    // Step 1: provision EB
    await patchStep(sessionId, "ranger_provision", {
      status: "active",
      startedAt: new Date().toISOString(),
    });
    emit(
      teamId,
      repositoryId,
      sessionId,
      "step:start",
      "Provisioning browser",
      {
        stepId: "ranger_provision",
      },
    );

    const eb = await claimEmbeddedBrowserForAgent(5 * 60 * 1000, () => {
      mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
    });
    if (!eb) {
      await patchStep(sessionId, "ranger_provision", {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: "No embedded browser available",
      });
      await queries.updateAgentSession(sessionId, {
        status: "failed",
        completedAt: new Date(),
      });
      emit(
        teamId,
        repositoryId,
        sessionId,
        "step:error",
        "No embedded browser available",
        { stepId: "ranger_provision" },
      );
      return;
    }
    runnerId = eb.runnerId;
    await mergeMetadata(sessionId, {
      queuedForBrowser: false,
      streamUrl: proxiedStream(eb.streamUrl),
    });
    await patchStep(sessionId, "ranger_provision", {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    emit(teamId, repositoryId, sessionId, "step:complete", "Browser ready", {
      stepId: "ranger_provision",
    });

    // Step 2: browse + extract
    await patchStep(sessionId, "ranger_browse", {
      status: "active",
      startedAt: new Date().toISOString(),
    });
    emit(teamId, repositoryId, sessionId, "step:start", `Browsing ${url}`, {
      stepId: "ranger_browse",
    });

    const pageMap = await browsePageMap(eb.cdpUrl, url, viewport);

    await mergeMetadata(sessionId, {
      rangerPageMap: pageMap as unknown as Record<string, unknown>,
    });
    await patchStep(sessionId, "ranger_browse", {
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
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Mapped ${url}: ${pageMap.links.length} links, ${pageMap.forms.length} forms, ${pageMap.buttons.length} buttons`,
      { stepId: "ranger_browse" },
    );

    await queries.updateAgentSession(sessionId, {
      status: "completed",
      completedAt: new Date(),
    });
    emit(
      teamId,
      repositoryId,
      sessionId,
      "session:complete",
      "Ranger complete",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await patchStep(sessionId, "ranger_browse", {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: msg,
    }).catch(() => {});
    await queries
      .updateAgentSession(sessionId, {
        status: "failed",
        completedAt: new Date(),
      })
      .catch(() => {});
    emit(teamId, repositoryId, sessionId, "session:error", `Failed: ${msg}`);
  } finally {
    // Clear the live stream pointer (EB is being released) and release the EB.
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    if (runnerId) await releasePoolEB(runnerId).catch(() => {});
  }
}

/**
 * Start an async ranger session. Returns immediately with a sessionId; poll
 * getRangerSession for status, the live streamUrl, and the final page map.
 */
export async function startRanger(
  repositoryId: string,
  opts: { url?: string; viewport?: { width: number; height: number } },
): Promise<{ sessionId: string }> {
  const { team, repo } = await requireRepoAccess(repositoryId);

  // Resolve target: explicit url, else the repo's base URL.
  const branchBaseUrls = (repo.branchBaseUrls ?? {}) as Record<string, string>;
  const fallback =
    (repo.defaultBranch ? branchBaseUrls[repo.defaultBranch] : undefined) ??
    branchBaseUrls.main ??
    Object.values(branchBaseUrls)[0];
  const url = opts.url || fallback;
  if (!url) {
    throw new Error("No url provided and the repo has no base URL set");
  }
  try {
    await assertSafeOutboundUrl(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new Error(`URL rejected: ${err.message}`);
    }
    throw err;
  }

  const steps: AgentStepState[] = RANGER_STEPS.map((s, i) => ({
    id: s.id,
    status: i === 0 ? "active" : "pending",
    label: s.label,
    description: s.description,
  }));

  const session = await queries.createAgentSession({
    repositoryId,
    teamId: team.id,
    kind: "ranger",
    status: "active",
    currentStepId: "ranger_provision",
    steps,
    metadata: { rangerUrl: url },
  });

  emit(
    team.id,
    repositoryId,
    session.id,
    "session:start",
    `Ranger started on ${url}`,
  );

  executeRanger(session.id, team.id, repositoryId, url, opts.viewport).catch(
    (err) => {
      console.error("[Ranger] unhandled:", err);
    },
  );

  return { sessionId: session.id };
}

export async function getRangerSession(
  sessionId: string,
): Promise<AgentSession | null> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session || session.kind !== "ranger") return null;
  if (session.teamId && session.teamId !== team.id) return null;
  return session;
}

export async function cancelRanger(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session || session.kind !== "ranger") return { success: false };
  if (session.teamId && session.teamId !== team.id) return { success: false };
  await queries.updateAgentSession(sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  return { success: true };
}
