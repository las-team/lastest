import "server-only";

import type {
  AuthoringAiArea,
  AuthoringAiCodeScanResult,
  AuthoringAiHost,
  AuthoringAiIntelligence,
  AuthoringAiRepoSpecFiles,
  AuthoringAiRoute,
  AuthoringAiSeedFixture,
  AuthoringAiSpecExtractionResult,
  AuthoringAiTest,
  AuthoringAiTestResult,
  AuthoringAiValidation,
} from "@lastest/plugin-authoring-ai/host";
import { getFileContent, getRepoTree } from "@lastest/github";

import { buildSeedFixture } from "@/lib/playwright/agent-context";
import { computeDomDiff, summarizeDomDiff } from "@/lib/diff/dom-diff";
import { runValidation } from "@/lib/ai/validation-retry";
import { getCurrentBranchForRepo } from "@/lib/git-utils";
import * as queries from "@/lib/db/queries";
import type { DomSnapshotData } from "@/lib/db/schema";

/**
 * The app's fill for `AuthoringAiHost`.
 *
 * Mostly thin adapters over the existing query layer — see `host.ts`'s
 * header for the grouping. Two methods are not pass-throughs and are the
 * point of the exercise:
 *
 *   - `getRepoSpecFiles` keeps GitHub credential custody (`account.
 *     accessToken`) out of the plugin entirely — it resolves the repo, the
 *     account, the tree, and every file's content here, and hands back
 *     content only.
 *   - `aiScanRoutes` / `extractUserStoriesFromFiles` / `syncAreaPlanAndSpecs`
 *     are sideways calls into `ai-routes.ts` / `spec-import.ts` / `specs.ts`
 *     — three still-unmigrated, unclassified features, not core. A host
 *     method here does not make them migratable (recipe §1.6.2).
 */
export const appAuthoringAiHost: AuthoringAiHost = {
  async buildSeedFixture(repositoryId): Promise<AuthoringAiSeedFixture> {
    return buildSeedFixture(repositoryId);
  },

  async getCodebaseIntelligence(
    repositoryId,
  ): Promise<AuthoringAiIntelligence | undefined> {
    const activeSession = await queries.getActiveAgentSession(repositoryId);
    return activeSession?.metadata?.codebaseIntelligence as
      | AuthoringAiIntelligence
      | undefined;
  },

  async getTestForHealing(testId): Promise<AuthoringAiTest | null> {
    const test = await queries.getTest(testId);
    if (!test) return null;
    return { code: test.code, domSnapshot: test.domSnapshot };
  },

  async getLatestTestResult(testId): Promise<AuthoringAiTestResult | null> {
    // Ordered newest-first, so results[0] is the most recent failure — NOT
    // results.at(-1), which is the oldest run and would make the healer
    // diagnose a stale error/DOM snapshot.
    const results = await queries.getTestResultsByTest(testId);
    const latest = results[0];
    if (!latest) return null;
    return {
      errorMessage: latest.errorMessage ?? null,
      domSnapshot: latest.domSnapshot,
    };
  },

  async updateTestCode(testId, code, branch): Promise<void> {
    await queries.updateTestWithVersion(testId, { code }, "ai_fix", branch);
  },

  async getFunctionalAreaPlan(functionalAreaId): Promise<string | null> {
    const area = await queries.getFunctionalArea(functionalAreaId);
    return area?.agentPlan ?? null;
  },

  async getFunctionalAreasByRepo(repositoryId): Promise<AuthoringAiArea[]> {
    const areas = await queries.getFunctionalAreasByRepo(repositoryId);
    return areas.map((a) => ({
      id: a.id,
      name: a.name,
      agentPlan: a.agentPlan ?? null,
    }));
  },

  async getOrCreateFunctionalArea(
    repositoryId,
    name,
    description,
  ): Promise<{ id: string }> {
    const area = await queries.getOrCreateFunctionalAreaByRepo(
      repositoryId,
      name,
      description,
    );
    return { id: area.id };
  },

  async saveAreaPlan(functionalAreaId, plan): Promise<void> {
    await queries.updateFunctionalArea(functionalAreaId, {
      agentPlan: plan,
      planGeneratedAt: new Date(),
    });
  },

  async getRoutesByRepo(repositoryId): Promise<AuthoringAiRoute[]> {
    const routes = await queries.getRoutesByRepo(repositoryId);
    return routes.map((r) => ({
      path: r.path,
      functionalAreaId: r.functionalAreaId,
    }));
  },

  async getRepoSpecFiles(
    repositoryId,
    branch,
  ): Promise<AuthoringAiRepoSpecFiles> {
    const repo = await queries.getRepository(repositoryId);
    if (!repo) return { ok: false, reason: "no-repository" };

    const account = repo.teamId
      ? await queries.getGithubAccountByTeam(repo.teamId)
      : await queries.getGithubAccount();
    if (!account) return { ok: false, reason: "no-github-account" };

    const repoTree = await getRepoTree(
      account.accessToken,
      repo.owner,
      repo.name,
      branch,
    );
    if (!repoTree || repoTree.tree.length === 0) {
      return { ok: false, reason: "no-spec-files" };
    }

    const specEntries = repoTree.tree.filter(
      (entry) => entry.type === "blob" && isSpecFile(entry.path),
    );
    if (specEntries.length === 0) {
      return { ok: false, reason: "no-spec-files" };
    }

    const files: { path: string; content: string }[] = [];
    for (const entry of specEntries) {
      const content = await getFileContent(
        account.accessToken,
        repo.owner,
        repo.name,
        entry.path,
        branch,
      );
      if (content) files.push({ path: entry.path, content });
    }

    return { ok: true, files };
  },

  async summarizeDomChanges(baseline, current): Promise<string | null> {
    const diff = computeDomDiff(
      baseline as DomSnapshotData,
      current as DomSnapshotData,
    );
    if (
      diff.added.length === 0 &&
      diff.removed.length === 0 &&
      diff.changed.length === 0
    ) {
      return null;
    }
    return summarizeDomDiff(diff);
  },

  async getCurrentBranchForRepo(repositoryId): Promise<string | null> {
    return getCurrentBranchForRepo(repositoryId);
  },

  async validateGeneratedTest(code): Promise<AuthoringAiValidation> {
    const result = await runValidation(code);
    if (result.valid) return { valid: true };
    return { valid: false, feedback: result.feedback };
  },

  async aiScanRoutes(
    repositoryId,
    branch,
    intelligence,
  ): Promise<AuthoringAiCodeScanResult> {
    const { aiScanRoutes } = await import("@/server/actions/ai-routes");
    return aiScanRoutes(repositoryId, branch, intelligence);
  },

  async extractUserStoriesFromFiles(
    repositoryId,
    branch,
    filePaths,
  ): Promise<AuthoringAiSpecExtractionResult> {
    const { extractUserStoriesFromFiles } =
      await import("@/server/actions/spec-import");
    return extractUserStoriesFromFiles(repositoryId, branch, filePaths);
  },

  async syncAreaPlanAndSpecs(
    functionalAreaId,
    repositoryId,
  ): Promise<{ specsCreated: number; planCreated: boolean }> {
    const { syncAreaPlanAndSpecs } = await import("@/server/actions/specs");
    return syncAreaPlanAndSpecs(functionalAreaId, repositoryId);
  },
};

const SPEC_PATTERNS = [
  "docs/",
  "specs/",
  "specifications/",
  "requirements/",
  "stories/",
  "features/",
];
const SPEC_FILES = [
  "README.md",
  "SPEC.md",
  "PRD.md",
  "SPECIFICATION.md",
  "REQUIREMENTS.md",
  "USER_STORIES.md",
];

function isSpecFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (SPEC_FILES.some((f) => lower === f.toLowerCase())) return true;
  if (SPEC_PATTERNS.some((p) => lower.startsWith(p))) {
    return (
      lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".pdf")
    );
  }
  return false;
}
