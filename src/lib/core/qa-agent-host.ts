import "server-only";

import { compareBranches, getFileContent, getRepoTree } from "@lastest/github";
import { withAuthoringAiSession } from "@lastest/plugin-authoring-ai/actions";
import type {
  CreateQaSessionInput,
  QaActivityEvent,
  QaAgentHost,
  QaAuthoringSession,
  QaCodebaseIntel,
  QaExistingAuthSetup,
  QaRepoInfo,
  QaSessionPatch,
  QaSourceAccess,
} from "@lastest/plugin-qa-agent/host";
import type { QaSessionRow } from "@lastest/plugin-qa-agent/types";

import { getCurrentSession } from "@/lib/auth";
import { assertAgentRunMinutesAvailable } from "@/lib/billing/agent-eb-usage";
import {
  findExistingAuthSetup,
  type ExistingAuthSetup,
} from "@/lib/core/auth-setup-resolution";
import { captureStorageState } from "@/lib/core/quickstart-storage-shared";
import * as queries from "@/lib/db/queries";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import type {
  ActivityEventType,
  AgentSession,
  AgentStepId,
  AgentStepState,
  PwAgentType,
} from "@/lib/db/schema";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { runTestsCore } from "@/server/actions/runs";

/**
 * The app's fill for `QaAgentHost` — read that file's header first; it
 * carries the 12-group breakdown and each group's honest future. This one is
 * only about how the app satisfies the port today.
 *
 * ### The rules this file lives under
 *
 * - **`host::db`** (`FORBIDDEN_HOST_IMPORTS`): no `@/lib/db`, no drizzle —
 *   every read and write goes through `src/lib/db/queries/*`, which is where
 *   tenancy filters, **encryption-on-write** and activity events live. That
 *   last one is the load-bearing half for this plugin: `createSession`/
 *   `updateSession` delegate to `createAgentSession`/`updateAgentSession`,
 *   whose `encryptSessionMetadata`/`decryptSessionMetadata` pair is what
 *   keeps `quickstartPassword`/`qaAuthContext` AES-256-GCM-encrypted at
 *   rest, by field name, exactly as before the migration —
 *   `scripts/rotate-encryption-key.ts` keeps rotating them untouched.
 * - **The composition root may know every plugin.** `withAuthoringSession`
 *   imports `@lastest/plugin-authoring-ai/actions` directly — the one place
 *   that plugin→plugin call is legal (the `share-reads.ts`/
 *   `quickstart-host.publishShare` shape).
 *
 * ### Type assignments here are load-bearing
 *
 * The plugin narrows core shapes rather than importing them
 * (`QaSessionRow`/`QaStepState`, `QaExistingAuthSetup`, `QaActivityEvent`'s
 * event/agent unions, `QaAuthoringSession`). The typed assignments below are
 * the recipe-§6.1 assertions that keep the copies honest: if core's shape
 * drifts away from the plugin's, this file stops type-checking. The
 * jsonb-boundary casts on session steps/metadata mirror
 * `quickstart-host.ts`'s (its §10 names them as a known, accepted weakness —
 * the field names are identical on both sides by construction).
 */

// ── Session mapping ─────────────────────────────────────────────────────────

function toSessionRow(row: AgentSession): QaSessionRow {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    teamId: row.teamId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: row.status as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentStepId: row.currentStepId as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: row.steps as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: row.metadata as any,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

// ── GitHub access resolution (token never leaves this file) ─────────────────

async function resolveGithubAccess(repositoryId: string): Promise<{
  token: string;
  owner: string;
  name: string;
  branch: string;
  baseBranch: string;
} | null> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo?.teamId || repo.provider !== "github" || !repo.owner) return null;
  const account = await queries
    .getGithubAccountByTeam(repo.teamId)
    .catch(() => undefined);
  if (!account?.accessToken) return null;
  return {
    token: account.accessToken,
    owner: repo.owner,
    name: repo.name ?? "",
    branch: repo.selectedBranch || repo.defaultBranch || "main",
    baseBranch: repo.defaultBranch || "main",
  };
}

export const appQaAgentHost: QaAgentHost = {
  // ---- 1. Session CRUD -----------------------------------------------------

  async createSession(input: CreateQaSessionInput) {
    const row = await queries.createAgentSession({
      repositoryId: input.repositoryId,
      teamId: input.teamId,
      kind: "qa",
      status: "active",
      // The `satisfies` is the assertion that the plugin's QaStepId union
      // stays inside core's AgentStepId.
      currentStepId: input.currentStepId satisfies AgentStepId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: input.steps as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: input.metadata as any,
    });
    return { id: row.id };
  },

  async getSession(sessionId) {
    const row = await queries.getAgentSession(sessionId);
    if (!row || row.kind !== "qa") return null;
    return toSessionRow(row);
  },

  async updateSession(sessionId, patch: QaSessionPatch) {
    await queries.updateAgentSession(sessionId, {
      status: patch.status,
      currentStepId: patch.currentStepId satisfies AgentStepId | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: patch.steps as any as AgentStepState[] | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: patch.metadata as any,
      completedAt: patch.completedAt,
    });
  },

  async getActiveSession(repositoryId) {
    const row = await queries.getActiveAgentSession(repositoryId, "qa");
    return row ? { id: row.id } : null;
  },

  async getRecentSessions(repositoryId, limit) {
    const rows = await queries.getRecentAgentSessions(
      repositoryId,
      "qa",
      limit,
    );
    return rows.map(toSessionRow);
  },

  // ---- 2. Run-minute quota -------------------------------------------------

  async assertRunMinutesAvailable(teamId) {
    await assertAgentRunMinutesAvailable(teamId);
  },

  // ---- 3. SSRF guard -------------------------------------------------------

  async checkOutboundUrl(url) {
    try {
      await assertSafeOutboundUrl(url);
      return { ok: true as const };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return { ok: false as const, reason: err.message };
      }
      // DNS failures and other unexpected errors keep throwing — the plugin's
      // call sites never treated those as a policy rejection.
      throw err;
    }
  },

  // ---- 4. Test CRUD --------------------------------------------------------

  async createTest(input) {
    const row = await queries.createTest(
      {
        repositoryId: input.repositoryId,
        name: input.name,
        code: input.code,
        targetUrl: input.targetUrl,
        functionalAreaId: input.functionalAreaId,
        testType: input.testType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiDefinition: input.apiDefinition as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playwrightOverrides: input.playwrightOverrides as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setupOverrides: input.setupOverrides as any,
      },
      undefined,
      undefined,
      // Attribution is core's decision, made here rather than accepted from
      // the plugin: every QA-generated test is authored by the play_agent
      // bot, whose row belongs to @lastest/plugin-gamification — its
      // test-created listener resolves and stamps the id. See
      // src/lib/db/test-hooks.ts.
      "play_agent",
    );
    return { id: row.id };
  },

  async updateTestCode(testId, code) {
    await queries.updateTest(testId, { code });
  },

  async listTests(repositoryId) {
    const [tests, areas] = await Promise.all([
      queries.getTestsByRepo(repositoryId),
      queries.getFunctionalAreasByRepo(repositoryId).catch(() => []),
    ]);
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    return tests.map((t) => ({
      id: t.id,
      name: t.name,
      testType: t.testType ?? null,
      functionalAreaName: t.functionalAreaId
        ? (areaName.get(t.functionalAreaId) ?? null)
        : null,
    }));
  },

  async getOrCreateFunctionalArea(repositoryId, name) {
    const area = await queries.getOrCreateFunctionalAreaByRepo(
      repositoryId,
      name,
    );
    return { id: area.id };
  },

  async getAuthSetupCode(ref) {
    if (ref.testId) {
      const test = await queries.getTest(ref.testId).catch(() => null);
      return test?.code ?? null;
    }
    if (ref.scriptId) {
      const script = await queries
        .getSetupScript(ref.scriptId)
        .catch(() => null);
      return script?.code ?? null;
    }
    return null;
  },

  // ---- 5. Execution --------------------------------------------------------

  async startRun(repositoryId, testIds) {
    const run = await runTestsCore(testIds, repositoryId, true);
    return { runId: run.runId ?? null, jobId: run.jobId };
  },

  async isRunSettled(ref) {
    if (ref.runId) {
      // A missing run row keeps polling (bounded by the plugin's own
      // deadline) — the pre-migration loop's exact semantics.
      const runRow = await queries.getTestRun(ref.runId);
      return Boolean(runRow?.status && runRow.status !== "running");
    }
    if (ref.jobId) {
      const job = await queries.getBackgroundJob(ref.jobId);
      if (!job) return true;
      return job.status !== "pending" && job.status !== "running";
    }
    return true;
  },

  async getLatestResultStatus(testId) {
    const results = await queries.getTestResultsByTest(testId);
    const latest = results[0];
    if (!latest) return null;
    return latest.status === "passed" ? "passed" : "failed";
  },

  // ---- 6. Storage states / auth resolution ---------------------------------

  async persistStorageState(input) {
    const row = await queries.createStorageState({
      repositoryId: input.repositoryId,
      name: input.name,
      storageStateJson: input.storageStateJson,
    });
    return { id: row.id };
  },

  async captureStorageState(input) {
    return captureStorageState({
      repositoryId: input.repositoryId,
      baseUrl: input.baseUrl,
      testCode: input.testCode,
      name: input.name,
    });
  },

  async resolveExistingAuth(repositoryId) {
    // The assignment is the assertion: the plugin's narrowed
    // `QaExistingAuthSetup` must remain satisfied by core's shape.
    const existing: ExistingAuthSetup =
      await findExistingAuthSetup(repositoryId);
    return existing satisfies QaExistingAuthSetup;
  },

  // ---- 7. Repo / source facts ----------------------------------------------

  async getRepoInfo(repositoryId): Promise<QaRepoInfo | null> {
    const repo = await queries.getRepository(repositoryId);
    if (!repo) return null;
    const account = repo.teamId
      ? await queries.getGithubAccountByTeam(repo.teamId).catch(() => undefined)
      : undefined;
    return {
      id: repo.id,
      teamId: repo.teamId ?? null,
      name: repo.name ?? null,
      provider: repo.provider ?? null,
      owner: repo.owner ?? null,
      selectedBranch: repo.selectedBranch ?? null,
      defaultBranch: repo.defaultBranch ?? null,
      githubConnected: Boolean(
        account?.accessToken && repo.provider === "github" && repo.owner,
      ),
    };
  },

  async getStaticRoutes(repositoryId) {
    const existing = await queries.getRoutesByRepo(repositoryId);
    if (existing.length > 0) {
      return {
        routes: existing.map((r) => ({ path: r.path, type: r.type })),
        framework: existing[0]?.framework ?? undefined,
      };
    }
    const access = await resolveGithubAccess(repositoryId);
    if (!access) return null;
    const { RemoteRouteScanner } = await import("@lastest/route-scan");
    const scanner = new RemoteRouteScanner({
      accessToken: access.token,
      owner: access.owner,
      repo: access.name,
      branch: access.branch,
    });
    const result = await scanner.scan();
    return {
      routes: result.routes.map((r) => ({ path: r.path, type: r.type })),
      framework: result.framework,
    };
  },

  async getSourceAccess(repositoryId): Promise<QaSourceAccess | null> {
    const access = await resolveGithubAccess(repositoryId);
    if (!access) return null;
    const { token, owner, name, branch, baseBranch } = access;
    return {
      branch,
      baseBranch,
      async gatherIntelligence(): Promise<QaCodebaseIntel> {
        const { gatherCodebaseIntelligence } =
          await import("@/lib/ai/codebase-intelligence");
        const intel = await gatherCodebaseIntelligence(
          token,
          owner,
          name,
          branch,
        );
        // Narrowing assertion: core's CodebaseIntelligence must keep
        // satisfying the plugin's QaCodebaseIntel slice.
        return intel satisfies QaCodebaseIntel;
      },
      async getRepoTree() {
        const result = await getRepoTree(token, owner, name, branch);
        // A null result throws so the plugin's `.catch(() => null)` treats it
        // exactly as the pre-migration `getRepoTree(...).catch(() => null)`.
        if (!result) throw new Error("repo tree unavailable");
        return result.tree;
      },
      getFileContent(path: string) {
        return getFileContent(token, owner, name, path, branch);
      },
      async compareBranches() {
        if (branch === baseBranch) return null;
        return compareBranches(token, owner, name, baseBranch, branch);
      },
    };
  },

  async getEnvironmentBaseUrl(repositoryId) {
    const env = await queries.getEnvironmentConfig(repositoryId);
    return env?.baseUrl || null;
  },

  async getUserAgentOverride(repositoryId) {
    const settings = await queries.getPlaywrightSettings(repositoryId);
    return settings.userAgentOverride ?? null;
  },

  async getAiProviderName(repositoryId) {
    const settings = await queries.getAISettings(repositoryId);
    if (!settings.provider || settings.provider === "none") return null;
    return settings.provider;
  },

  // ---- 8. Team settings ----------------------------------------------------

  async getTeamEmailTemplate(teamId) {
    const team = await queries.getTeam(teamId);
    // Same default as quickstart's registration flow — the two agents share
    // the template column by design.
    return (
      team?.quickstartEmailTemplate ?? "viktor+{slug}{stamp}@lastest.cloud"
    );
  },

  // ---- 9. Pool headroom ----------------------------------------------------

  async getEbPoolMax() {
    const limits = await queries.getGlobalPoolLimits();
    return limits?.ebPoolMax ?? null;
  },

  // ---- 10. Activity --------------------------------------------------------

  emitActivity(evt: QaActivityEvent): void {
    // The two assignments are the recipe-§6.1 assertions that the plugin's
    // narrowed unions stay inside core's.
    const eventType: ActivityEventType = evt.eventType;
    const agentType: PwAgentType | null = evt.agentType ?? null;
    emitAndPersistActivityEvent({
      teamId: evt.teamId,
      repositoryId: evt.repositoryId,
      sessionId: evt.sessionId,
      sourceType: "qa_agent",
      eventType,
      summary: evt.summary,
      stepId: evt.stepId ?? null,
      agentType,
      detail: evt.detail ?? null,
      artifactType: evt.artifactType ?? null,
      artifactId: evt.artifactId ?? null,
      artifactLabel: evt.artifactLabel ?? null,
      durationMs: evt.durationMs ?? null,
      promptLogId: evt.promptLogId ?? null,
    }).catch((err) => console.error("[QaAgent] activity emit error:", err));
  },

  // ---- 11. Authoring sessions ----------------------------------------------

  withAuthoringSession<T>(
    repositoryId: string,
    claimOptions:
      | {
          storageStateId?: string;
          onQueued?: () => void;
          onSessionReady?: (streamUrl: string | null) => void;
        }
      | undefined,
    fn: (session: QaAuthoringSession) => Promise<T>,
  ): Promise<T> {
    // The pass-through is the assertion: authoring-ai's real
    // `AuthoringAiSession` must keep satisfying the plugin's narrowed
    // `QaAuthoringSession` (createTest/healTest slices).
    return withAuthoringAiSession(repositoryId, claimOptions, (session) =>
      fn(session satisfies QaAuthoringSession),
    );
  },

  // ---- 12. Identity --------------------------------------------------------

  async currentActor() {
    const session = await getCurrentSession();
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    };
  },
};
