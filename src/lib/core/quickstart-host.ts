import "server-only";

import { eq } from "drizzle-orm";

import type {
  QuickstartCaptureStorageStateInput,
  QuickstartCaptureStorageStateResult,
  QuickstartCreateTestInput,
  QuickstartHost,
  QuickstartRepoGateInfo,
  QuickstartRunFacts,
  QuickstartScoutClaim,
} from "@lastest/plugin-quickstart/host";
import { publishBuildShare } from "@lastest/plugin-share";

import * as queries from "@/lib/db/queries";
import { db } from "@/lib/db";
import { embeddedSessions } from "@/lib/db/schema";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { getLogger } from "@/lib/logger";
import { computeDiffClusters } from "@/lib/diff/diff-clusters";
import { resolveStoragePath } from "@/lib/storage/paths";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import {
  runQuickstartScoutPublic,
  runQuickstartScoutAuthed,
} from "@/lib/playwright/quickstart-scout";
import { captureStorageState as captureStorageStateShared } from "@/lib/core/quickstart-storage-shared";
import { generateDemoNotes as generateDemoNotesShared } from "@/lib/core/quickstart-notes-shared";
import { claimEmbeddedBrowserForAgent } from "@/server/actions/ai";
import {
  releasePoolEB,
  getEbPoolHealth,
} from "@/server/actions/embedded-sessions";
import {
  createAndRunBuildCore,
  getBuildSummary as getBuildSummaryCore,
} from "@/server/actions/builds";
import { approveAllDiffs } from "@/server/actions/diffs";
import { saveBranchBaseUrl } from "@/server/actions/environment";
import { readFile } from "fs/promises";

const log = getLogger("quickstart-host");

/**
 * The app's fill for `QuickstartHost`. See `plugins/quickstart/src/host.ts`
 * for the grouping and the reasoning behind each group — this file is the
 * implementation, not the design.
 */

// ---- 1. Gating / settings -------------------------------------------------

const DEFAULT_EMAIL_TEMPLATE = "viktor+{slug}{stamp}@lastest.cloud";

async function getRepoGateInfo(
  repositoryId: string,
): Promise<QuickstartRepoGateInfo | null> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo) return null;
  return {
    id: repo.id,
    name: repo.name,
    teamId: repo.teamId,
    defaultBranch: repo.defaultBranch,
    comparisonBaselineBranch: repo.comparisonBaselineBranch,
    branchBaseUrls: (repo.branchBaseUrls as Record<string, string>) ?? null,
  };
}

async function getTeamEmailTemplate(teamId: string): Promise<string> {
  const team = await queries.getTeam(teamId);
  return team?.quickstartEmailTemplate ?? DEFAULT_EMAIL_TEMPLATE;
}

async function setTeamEmailTemplate(
  teamId: string,
  template: string,
): Promise<void> {
  await queries.updateTeam(teamId, { quickstartEmailTemplate: template });
}

async function hasAiProvider(repositoryId: string): Promise<boolean> {
  const settings = await queries.getAISettings(repositoryId);
  return !!settings.provider;
}

async function relaxErrorModesForDemo(repositoryId: string): Promise<boolean> {
  // Founder sites almost always emit benign console/network noise (analytics
  // 401s, third-party scripts); with the default "fail" mode every clean
  // screenshot reds the walk. Also switches a11y + perf to log mode: the
  // share's "Checks run" grid advertises them, and a "—" tile is dead weight.
  try {
    await queries.upsertPlaywrightSettings(repositoryId, {
      consoleErrorMode: "warn",
      networkErrorMode: "warn",
      a11yMode: "log",
      perfMode: "log",
    });
    return true;
  } catch (err) {
    log.warn({ err, repositoryId }, "could not relax error modes for demo");
    return false;
  }
}

// ---- 2. Session CRUD (agent_sessions, kind: "quickstart") -----------------

function toSessionRow(
  row: NonNullable<Awaited<ReturnType<typeof queries.getAgentSession>>>,
): ReturnType<QuickstartHost["getSession"]> extends Promise<infer T>
  ? T
  : never {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    teamId: row.teamId,
    status: row.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentStepId: row.currentStepId as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: row.steps as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: row.metadata as any,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

// ---- 5. Scout ----------------------------------------------------------

/**
 * Build an actionable failure message for a scout step that couldn't get an
 * Embedded Browser. `claimErr` is the error the claim path threw (usually
 * swallowed); when the claim merely timed out it's undefined, so we probe
 * pool health to explain WHY. The most common dev cause is the EB image not
 * being imported into the k3d cluster.
 */
async function describeEbClaimFailure(claimErr: unknown): Promise<string> {
  if (claimErr instanceof Error && claimErr.message) {
    return `Couldn't get a browser for the scout: ${claimErr.message}`;
  }
  const health = await getEbPoolHealth().catch(() => null);
  if (!health) {
    return "Couldn't get a browser for the scout: no Embedded Browser became available, and pool health could not be read.";
  }
  if (health.size > health.online) {
    const unready = health.size - health.online;
    return `Couldn't get a browser for the scout: ${health.online} ready, ${unready} provisioned but not ready (cap ${health.max}). EB pods are likely unhealthy — stuck pulling the image (ImagePullBackOff) or pending on resources. An operator may need to restart the EB pool (pnpm stack:refresh:eb).`;
  }
  if (health.size >= health.max) {
    return `Couldn't get a browser for the scout: all ${health.max} browsers are busy and the pool is at capacity. Try again once a run finishes.`;
  }
  return `Couldn't get a browser for the scout: no Embedded Browser became ready (${health.online} ready, pool ${health.size}/${health.max}). The EB pool may be unhealthy — an operator may need to restart it (pnpm stack:refresh:eb).`;
}

function proxiedStream(
  raw: string | null | undefined,
  instanceId?: string | null,
): string | undefined {
  if (!raw) return undefined;
  return toProxyStreamUrl(raw, "", instanceId) || undefined;
}

async function claimScoutBrowser(
  onQueued: () => void,
): Promise<QuickstartScoutClaim> {
  let claimErr: unknown;
  const eb = await claimEmbeddedBrowserForAgent(5 * 60 * 1000, onQueued).catch(
    (e) => {
      claimErr = e;
      return undefined;
    },
  );
  if (!eb) {
    return {
      claimed: false,
      failureReason: await describeEbClaimFailure(claimErr),
    };
  }
  return {
    claimed: true,
    runnerId: eb.runnerId,
    cdpUrl: eb.cdpUrl,
    streamUrl: proxiedStream(eb.streamUrl, eb.instanceId),
  };
}

// ---- 6. Build orchestration + notes evidence -------------------------------

async function resolveBuildStreamUrl(
  buildId: string,
): Promise<string | undefined> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return undefined;
  const testRun = await queries.getTestRun(build.testRunId);
  if (!testRun?.runnerId) return undefined;
  const [sess] = await db
    .select({
      streamUrl: embeddedSessions.streamUrl,
      instanceId: embeddedSessions.instanceId,
    })
    .from(embeddedSessions)
    .where(eq(embeddedSessions.runnerId, testRun.runnerId));
  return proxiedStream(sess?.streamUrl, sess?.instanceId);
}

// Pixel-difference floor above which a demo diff is worth clustering into
// ignore regions — below this it's sub-visual jitter not worth masking.
const DEMO_NOISE_PX = 500;

async function maskDemoNoiseRegions(buildId: string): Promise<number> {
  const diffs = await queries.getVisualDiffsByBuild(buildId);
  let created = 0;
  for (const d of diffs) {
    if (!d.testId || (d.pixelDifference ?? 0) <= DEMO_NOISE_PX) continue;
    if (!d.baselineImagePath || !d.currentImagePath) continue;
    const existing = await queries.getIgnoreRegions(
      d.testId,
      d.stepLabel ?? null,
    );
    if (existing.length > 0) continue;
    const baseAbs = resolveStoragePath(
      d.baselineImagePath.startsWith("/")
        ? d.baselineImagePath
        : `/${d.baselineImagePath}`,
    );
    const curAbs = resolveStoragePath(
      d.currentImagePath.startsWith("/")
        ? d.currentImagePath
        : `/${d.currentImagePath}`,
    );
    if (!baseAbs || !curAbs) continue;
    let baseBuf: Buffer;
    let curBuf: Buffer;
    try {
      [baseBuf, curBuf] = await Promise.all([
        readFile(baseAbs),
        readFile(curAbs),
      ]);
    } catch {
      continue;
    }
    for (const r of computeDiffClusters(baseBuf, curBuf)) {
      await queries.createIgnoreRegion({
        testId: d.testId,
        stepLabel: d.stepLabel ?? null,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        reason: "auto: demo run-to-run noise",
      });
      created += 1;
    }
  }
  return created;
}

async function getRunFactsForBuild(
  buildId: string,
): Promise<QuickstartRunFacts> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) {
    return { testResults: [], a11yTopRules: [] };
  }
  const [withInfo, byRun, a11yRows] = await Promise.all([
    queries.getTestResultsWithTestInfo(build.testRunId).catch(() => []),
    queries.getTestResultsByRun(build.testRunId).catch(() => []),
    queries.getBuildA11yViolations(buildId).catch(() => []),
  ]);
  const videoByResultId = new Map(
    byRun.map((r) => [
      r.id,
      { hasVideo: !!r.videoPath, screenshotCount: r.screenshots?.length ?? 0 },
    ]),
  );
  return {
    testResults: withInfo.map((r) => ({
      testId: r.testId,
      testName: r.testName,
      status: r.status,
      errorMessage: r.errorMessage,
      consoleErrors: r.consoleErrors as string[] | null,
      hasVideo: videoByResultId.get(r.id)?.hasVideo ?? false,
      screenshotCount: videoByResultId.get(r.id)?.screenshotCount ?? 0,
    })),
    a11yTopRules: a11yRows.slice(0, 3).map((r) => `${r.id} (${r.totalNodes})`),
  };
}

// ---- host object ------------------------------------------------------------

export const appQuickstartHost: QuickstartHost = {
  getRepoGateInfo,
  getTeamEmailTemplate,
  setTeamEmailTemplate,
  hasAiProvider,
  relaxErrorModesForDemo,
  async saveBranchBaseUrl(repositoryId, branch, baseUrl) {
    await saveBranchBaseUrl(repositoryId, branch, baseUrl);
  },

  async createSession(input) {
    const row = await queries.createAgentSession({
      repositoryId: input.repositoryId,
      teamId: input.teamId,
      kind: "quickstart",
      status: "active",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentStepId: input.currentStepId as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: input.steps as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: input.metadata as any,
    });
    return { id: row.id };
  },
  async getSession(sessionId, teamId) {
    const row = await queries.getAgentSession(sessionId);
    if (!row) return null;
    if (teamId && row.teamId && row.teamId !== teamId) return null;
    return toSessionRow(row);
  },
  async updateSession(sessionId, patch) {
    await queries.updateAgentSession(sessionId, {
      status: patch.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentStepId: patch.currentStepId as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: patch.steps as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: patch.metadata as any,
      completedAt: patch.completedAt,
    });
  },
  async getActiveSession(repositoryId) {
    const row = await queries.getActiveAgentSession(repositoryId, "quickstart");
    return row ? { id: row.id } : null;
  },

  async createTest(input: QuickstartCreateTestInput) {
    const row = await queries.createTest({
      repositoryId: input.repositoryId,
      name: input.name,
      code: input.code,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setupOverrides: input.setupOverrides as any,
    });
    return { id: row.id };
  },
  async getTest(testId) {
    const row = await queries.getTest(testId);
    return row ? { id: row.id, code: row.code ?? null } : null;
  },
  async updateTest(testId, patch) {
    await queries.updateTest(testId, {
      code: patch.code,
      setupOverrides: patch.setupOverrides,
    });
  },

  async listStorageStates(repositoryId) {
    const rows = await queries.getStorageStates(repositoryId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt ?? null,
      expiresAt: r.expiresAt ?? null,
    }));
  },
  async getStorageStateJson(storageStateId) {
    const row = await queries.getStorageState(storageStateId);
    return row?.storageStateJson ?? null;
  },
  async captureStorageState(
    input: QuickstartCaptureStorageStateInput,
  ): Promise<QuickstartCaptureStorageStateResult> {
    return captureStorageStateShared(input);
  },

  claimScoutBrowser,
  async releaseScoutBrowser(runnerId) {
    await releasePoolEB(runnerId);
  },
  async injectStorageState(cdpUrl, storageStateJson) {
    return injectStorageStateIntoEb(cdpUrl, storageStateJson);
  },
  async runPublicScout(repositoryId, baseUrl, cdpUrl) {
    return runQuickstartScoutPublic(repositoryId, baseUrl, {
      cdpEndpoint: cdpUrl,
    });
  },
  async runAuthedScout(repositoryId, baseUrl, authTestCode, opts) {
    return runQuickstartScoutAuthed(repositoryId, baseUrl, authTestCode, {
      cdpEndpoint: opts.cdpUrl,
      preAuthenticated: opts.preAuthenticated,
    });
  },

  async startBuild(repositoryId, testIds) {
    try {
      const result = await createAndRunBuildCore(
        "manual",
        testIds,
        repositoryId,
        undefined,
        undefined,
        undefined,
        true,
      );
      if (!result.buildId) {
        const jobId = (result as { jobId?: string }).jobId ?? "unknown";
        return {
          started: false,
          error: `Build was queued (EB pool busy). Job ID: ${jobId}.`,
        };
      }
      return { started: true, buildId: result.buildId };
    } catch (err) {
      return {
        started: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async getBuildSummary(buildId) {
    const summary = await getBuildSummaryCore(buildId);
    if (!summary) return null;
    return {
      completedAt: summary.completedAt,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
      changesDetected: summary.changesDetected,
    };
  },
  async getBuildStreamUrl(buildId) {
    return resolveBuildStreamUrl(buildId);
  },
  async approveAllDiffs(buildId, actor) {
    return approveAllDiffs(buildId, actor);
  },
  maskDemoNoiseRegions,
  getRunFactsForBuild,

  async generateNotes(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return generateDemoNotesShared(input as any);
  },
  async getBuildDemoNotes(buildId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await queries.getBuildDemoNotes(buildId)) as any;
  },
  async upsertBuildDemoNotes(buildId, notes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await queries.upsertBuildDemoNotes(buildId, notes as any);
  },
  async getLatestDemoNotesForRepo(repositoryId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await queries.getLatestDemoNotesForRepo(repositoryId)) as any;
  },

  emitActivity(evt) {
    emitAndPersistActivityEvent({
      teamId: evt.teamId,
      repositoryId: evt.repositoryId,
      sessionId: evt.sessionId,
      sourceType: "play_agent",
      eventType: evt.eventType,
      summary: evt.summary,
      stepId: evt.stepId ?? null,
      agentType: "quickstart",
      detail: evt.detail ?? null,
      artifactType: evt.artifactType ?? null,
      artifactId: evt.artifactId ?? null,
      artifactLabel: evt.artifactLabel ?? null,
      durationMs: evt.durationMs ?? null,
      promptLogId: null,
    }).catch((err) => log.warn({ err }, "quickstart activity emit failed"));
  },

  async publishShare(buildId, opts) {
    return publishBuildShare(buildId, opts);
  },
};
