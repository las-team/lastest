"use server";

import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import { compareBranches } from "@/lib/github/content";
import { findAffectedTests } from "@/lib/smart-selection/file-matcher";
import { analyzeChangeMap } from "@/lib/ai/change-map-analyzer";
import type {
  ChangeMap,
  ChangeMapArea,
  ChangeMapFile,
  ChangeRisk,
  ChangeSource,
  AIDiffingProvider,
} from "@/lib/db/schema";
import { revalidatePath } from "next/cache";

const SOURCE_PRIORITY: Record<ChangeSource, number> = {
  manual: 4,
  signals: 3,
  code: 2,
  ai: 1,
};

const RISK_RANK: Record<ChangeRisk, number> = { low: 0, medium: 1, high: 2 };

/**
 * Set the manually-scoped areas for a build (developer's "Focus on…" pin).
 * Triggers a change-map recomputation so the panel updates without a re-run.
 */
export async function setBuildManualScope(
  buildId: string,
  areaIds: string[],
): Promise<void> {
  // Auth: verify the user can access the repo this build belongs to.
  const repoId = await resolveRepoIdForBuild(buildId);
  if (repoId) await requireRepoAccess(repoId);

  await queries.updateBuild(buildId, { manuallyScopedAreaIds: areaIds });

  // Recompute the change map so the manual scope is reflected immediately.
  await computeChangeMap(buildId);
  revalidatePath(`/verify/${buildId}`);
}

/**
 * Compute (or recompute) the build's Change Map and persist it.
 * Idempotent — safe to call multiple times for the same build.
 */
export async function computeChangeMap(
  buildId: string,
): Promise<ChangeMap | null> {
  const build = await queries.getBuild(buildId);
  if (!build) return null;

  const repoId = await resolveRepoIdForBuild(buildId);
  if (!repoId) return null;

  const repo = await queries.getRepository(repoId);
  if (!repo) return null;

  const branch =
    (build.testRunId
      ? (await queries.getTestRun(build.testRunId))?.gitBranch
      : null) ||
    repo.selectedBranch ||
    repo.defaultBranch ||
    "main";
  const baseBranch = repo.defaultBranch || "main";

  // ── 1. Code signal (git diff vs base branch) ────────────────────────────
  let files: ChangeMapFile[] = [];
  if (repo.provider === "github" && repo.teamId) {
    const account = await queries.getGithubAccountByTeam(repo.teamId);
    if (account?.accessToken && branch !== baseBranch) {
      const compareResult = await compareBranches(
        account.accessToken,
        repo.owner,
        repo.name,
        baseBranch,
        branch,
      ).catch(() => null);
      if (compareResult) {
        files = compareResult.files
          .filter((f) =>
            ["added", "modified", "removed", "renamed", "changed"].includes(
              f.status,
            ),
          )
          .map((f) => ({
            path: f.filename,
            pkg: f.filename.split("/").slice(0, 2).join("/"),
            status:
              f.status === "added" ? "A" : f.status === "removed" ? "D" : "M",
            insertions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
          }));
      }
    }
  }

  const changedPaths = files.map((f) => f.path);

  // Map changed files → tests (route/url/area heuristic) → areas.
  const affectedTests =
    changedPaths.length > 0
      ? await findAffectedTests(changedPaths, repoId)
      : [];

  // Get all areas + tests so we can map test→area.
  const [areas, repoTests] = await Promise.all([
    queries.getFunctionalAreasByRepo(repoId),
    queries.getTestsByRepo(repoId),
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const testToArea = new Map<string, string | null>();
  for (const t of repoTests) testToArea.set(t.id, t.functionalAreaId ?? null);

  const areaSources = new Map<string, Set<ChangeSource>>();
  const ensure = (id: string) => {
    if (!areaSources.has(id)) areaSources.set(id, new Set());
    return areaSources.get(id)!;
  };

  // Code: areas containing affected tests.
  for (const at of affectedTests) {
    const areaId = testToArea.get(at.testId);
    if (areaId) ensure(areaId).add("code");
  }

  // ── 2. Signals (step_comparisons verdicts on this build) ────────────────
  const stepRows = await queries.getStepComparisonsByBuild(buildId);
  const redOrYellowTestIds = new Set(
    stepRows
      .filter((s) => s.verdict === "red" || s.verdict === "yellow")
      .map((s) => s.testId),
  );
  for (const testId of redOrYellowTestIds) {
    const areaId = testToArea.get(testId);
    if (areaId) ensure(areaId).add("signals");
  }

  // ── 3. Manual (developer flag on builds.manuallyScopedAreaIds) ──────────
  const manuallyScopedAreaIds = build.manuallyScopedAreaIds ?? [];
  for (const areaId of manuallyScopedAreaIds) ensure(areaId).add("manual");

  // ── 4. AI narrative + risk per candidate area ───────────────────────────
  const candidateAreaIds = Array.from(areaSources.keys());

  // Build affected-files-per-area for AI context.
  const filesByArea = new Map<string, Set<string>>();
  for (const at of affectedTests) {
    const areaId = testToArea.get(at.testId);
    if (areaId && at.matchedFile) {
      if (!filesByArea.has(areaId)) filesByArea.set(areaId, new Set());
      filesByArea.get(areaId)!.add(at.matchedFile);
    }
  }

  let intentSummary = "";
  let riskSummary = "";
  let modelId = "";
  let aiSkipped = false;
  let aiSkippedReason: string | undefined;
  const areaAINarrative = new Map<
    string,
    { risk: ChangeRisk; aiNarrative: string[] }
  >();

  // Upfront skip reasons — distinguish "not applicable" (no PR context, branch
  // matches base, repo not on GitHub) from "wanted to run but couldn't"
  // (AI call failed, missing API key). Previously every no-diff path emitted
  // the same misleading "No file diff available" — making it look like the
  // analyzer was attempted when it never had inputs to chew on.
  const skipUpfront = (() => {
    if (candidateAreaIds.length === 0) return "No candidate areas";
    if (files.length > 0) return null;
    if (repo.provider !== "github")
      return "AI diff analysis requires a GitHub-connected repo";
    if (branch === baseBranch)
      return `Build ran on the base branch (${baseBranch}) — no diff to analyze`;
    return "No file diff available (compareBranches returned nothing — check GitHub credentials)";
  })();

  if (skipUpfront) {
    aiSkipped = true;
    aiSkippedReason = skipUpfront;
  } else {
    const aiResult = await runChangeMapAI({
      repoId,
      branch,
      baseBranch,
      files,
      candidateAreas: candidateAreaIds.map((id) => ({
        areaId: id,
        areaName: areaById.get(id)?.name ?? "Unknown",
        sourceHints: Array.from(ensure(id)),
        affectedFiles: Array.from(filesByArea.get(id) ?? []),
      })),
    });

    if (aiResult.kind === "ok") {
      intentSummary = aiResult.intentSummary;
      riskSummary = aiResult.riskSummary;
      modelId = aiResult.modelId;
      for (const a of aiResult.areas) {
        areaAINarrative.set(a.areaId, {
          risk: a.risk,
          aiNarrative: a.aiNarrative,
        });
        if (a.aiNarrative.length > 0) ensure(a.areaId).add("ai");
      }
    } else {
      aiSkipped = true;
      aiSkippedReason = aiResult.reason;
    }
  }

  // ── Assemble & rank ─────────────────────────────────────────────────────
  const rankedAreas: ChangeMapArea[] = candidateAreaIds.map(
    (id): ChangeMapArea => {
      const sources = Array.from(ensure(id));
      const ai = areaAINarrative.get(id);
      return {
        areaId: id,
        areaName: areaById.get(id)?.name ?? "Unknown",
        sources,
        risk: ai?.risk ?? "medium",
        aiNarrative: ai?.aiNarrative ?? [],
      };
    },
  );

  rankedAreas.sort((a, b) => {
    // Highest-priority source first (manual > signals > code > ai), then risk, then name.
    const aP = Math.max(...a.sources.map((s) => SOURCE_PRIORITY[s]));
    const bP = Math.max(...b.sources.map((s) => SOURCE_PRIORITY[s]));
    if (aP !== bP) return bP - aP;
    if (RISK_RANK[a.risk] !== RISK_RANK[b.risk])
      return RISK_RANK[b.risk] - RISK_RANK[a.risk];
    return a.areaName.localeCompare(b.areaName);
  });

  const tests = affectedTests.map((at) => ({
    testId: at.testId,
    reason: `${at.matchReason} (${at.confidence}%)`,
    lastStatus: null,
  }));

  const steps = stepRows
    .filter((s) => s.verdict !== "green" && s.stepLabel)
    .map((s) => ({
      testId: s.testId,
      stepLabel: s.stepLabel as string,
      reason:
        s.verdict === "red"
          ? "Red verdict from multi-layer scorer"
          : "Yellow verdict from multi-layer scorer",
    }));

  const payload: ChangeMap = {
    files,
    areas: rankedAreas,
    tests,
    steps,
    intentSummary,
    riskSummary,
    manuallyScopedAreaIds,
    generatedAt: new Date().toISOString(),
    modelId,
    aiSkipped,
    aiSkippedReason,
  };

  await queries.upsertBuildChangeMap(buildId, payload);
  return payload;
}

async function resolveRepoIdForBuild(buildId: string): Promise<string | null> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return null;
  const testRun = await queries.getTestRun(build.testRunId);
  return testRun?.repositoryId ?? null;
}

interface RunAIInput {
  repoId: string;
  branch: string;
  baseBranch: string;
  files: ChangeMapFile[];
  candidateAreas: Array<{
    areaId: string;
    areaName: string;
    sourceHints: string[];
    affectedFiles: string[];
  }>;
}

type AIResult =
  | {
      kind: "ok";
      intentSummary: string;
      riskSummary: string;
      modelId: string;
      areas: Array<Pick<ChangeMapArea, "areaId" | "risk" | "aiNarrative">>;
    }
  | { kind: "skipped"; reason: string };

async function runChangeMapAI(input: RunAIInput): Promise<AIResult> {
  const settings = await queries.getAISettings(input.repoId);
  if (!settings.aiDiffingEnabled)
    return { kind: "skipped", reason: "AI diffing disabled" };

  const rawProvider = (settings.aiDiffingProvider as AIDiffingProvider) || null;
  const rawApiKey = settings.aiDiffingApiKey;
  const rawModel =
    settings.aiDiffingModel || "anthropic/claude-sonnet-4-5-20250929";

  let provider: "openrouter" | "anthropic" | "claude-agent-sdk" | "ollama";
  let apiKey: string;
  let model: string;
  let baseUrl: string | undefined;

  if (rawProvider === "same-as-test-gen") {
    if (settings.provider === "claude-cli")
      return { kind: "skipped", reason: "claude-cli has no JSON-mode chat" };
    if (settings.provider === "ollama") {
      provider = "ollama";
      apiKey = "";
      model = settings.ollamaModel || "";
      baseUrl = settings.ollamaBaseUrl || "http://localhost:11434";
    } else if (settings.provider === "claude-agent-sdk") {
      provider = "claude-agent-sdk";
      apiKey = "";
      model = settings.agentSdkModel || "";
    } else {
      provider = "openrouter";
      apiKey = settings.openrouterApiKey || "";
      model =
        settings.openrouterModel || "anthropic/claude-sonnet-4-5-20250929";
    }
  } else if (rawProvider === "ollama") {
    provider = "ollama";
    apiKey = "";
    model = settings.aiDiffingOllamaModel || "";
    baseUrl = settings.aiDiffingOllamaBaseUrl || "http://localhost:11434";
  } else if (rawProvider === "claude-agent-sdk") {
    provider = "claude-agent-sdk";
    apiKey = "";
    model = rawModel;
  } else if (rawProvider) {
    provider = rawProvider as "openrouter" | "anthropic";
    apiKey = rawApiKey || "";
    model = rawModel;
  } else {
    return { kind: "skipped", reason: "No AI diffing provider configured" };
  }

  if (provider !== "claude-agent-sdk" && provider !== "ollama" && !apiKey) {
    return { kind: "skipped", reason: "Missing API key" };
  }

  try {
    const result = await analyzeChangeMap(
      {
        branch: input.branch,
        baseBranch: input.baseBranch,
        files: input.files,
        candidateAreas: input.candidateAreas,
      },
      { provider, apiKey, model, baseUrl },
    );
    return {
      kind: "ok",
      intentSummary: result.intentSummary,
      riskSummary: result.riskSummary,
      modelId: `${provider}:${model}`,
      areas: result.areas,
    };
  } catch (e) {
    return {
      kind: "skipped",
      reason: `AI call failed: ${(e as Error).message}`,
    };
  }
}
