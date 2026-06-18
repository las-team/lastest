"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Filter,
  GitBranch,
  Play,
  ChevronDown,
  X,
  Loader2,
  Sparkles,
  AlertTriangle,
  AlertOctagon,
} from "lucide-react";
import { toast } from "sonner";
import { runVerifyBuild } from "@/server/actions/smart-run";
import { decideLayer } from "@/server/actions/layer-feedback";
import { confirmCase, type ConfirmKind } from "@/server/actions/verify-issues";
import { coverArea } from "@/server/actions/cover-area";
import { updateRepoSelectedBranch } from "@/server/actions/repos";
import type {
  Build,
  ChangeMap,
  EvidenceLayer,
  StepComparison,
  StepLayerFeedback,
} from "@/lib/db/schema";
import { deriveCaseStatus } from "@/lib/verify/case-status";
import {
  effectiveVerdict,
  mergeWithTestOverrides,
} from "@/lib/verify/check-modes";
import { IssuePickerDialog } from "@/components/verify/issue-picker-dialog";
import { BoardView, type CaseStatus } from "./board-view";
import { FocusView } from "./focus-view";
import "../verify-design.css";

interface AreaLite {
  id: string;
  name: string;
}
interface TestLite {
  id: string;
  name: string;
  functionalAreaId: string | null;
}

export interface VisualDiffLite {
  id: string;
  testId: string;
  stepLabel: string | null;
  baselineImagePath: string | null;
  currentImagePath: string | null;
  diffImagePath: string | null;
  pixelDifference: number | null;
  percentageDifference: string | null;
  classification: string | null;
  /** DomDiffResult written into the visual-diff metadata by the legacy DOM
   *  diff pipeline (builds.ts). The multi-layer scorer doesn't populate
   *  step.layers.dom yet, so the DOM pane falls back to this when present. */
  domDiff: import("@/lib/db/schema").DomDiffResult | null;
  /** Per-region rectangles (added/removed/changed/etc.) — drawn on the
   *  current screenshot in the visual pane "Regions" overlay. */
  changedRegions:
    | import("@/lib/db/schema").DiffMetadata["changedRegions"]
    | null;
  /** innerText diff status — populated when textDiffEnabled in
   *  diffSensitivitySettings. Surfaces the Text tab on the focus view. */
  textDiffStatus: import("@/lib/db/schema").TextDiffStatus | null;
  baselineTextPath: string | null;
  currentTextPath: string | null;
  /** Line-count summary computed during the diff run; lets the Text tab
   *  render +/− deltas without re-fetching the text files. */
  textDiffSummary: {
    added: number;
    removed: number;
    sameAsBaseline: boolean;
  } | null;
  /** When the diff used a baseline from a different branch than the build's
   *  (current branch had none → fell back to repo default), this is the
   *  source branch. UI labels the comparison so the user knows it's a
   *  cross-branch baseline. */
  baselineSourceBranch: string | null;
  /** When NO baseline existed on the current branch and no default-branch
   *  fallback was available, points the user at where an approved baseline
   *  does exist (or null when there is none anywhere). Prevents the
   *  "baseline is gone" panic — the data hasn't been lost, it just hasn't
   *  been promoted to this branch yet. */
  baselineExistsOn: { branch: string; createdAt: string } | null;
}

export interface TestResultLite {
  id: string;
  testId: string | null;
  status: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  browser: string | null;
  isFlaky: boolean | null;
  retryOf: string | null;
  lastReachedStep: number | null;
  totalSteps: number | null;
  consoleErrors: string[] | null;
  networkRequests: import("@/lib/db/schema").NetworkRequest[] | null;
  // Request/response headers + bodies are stripped from `networkRequests` and
  // saved to this file; the focus view lazily re-hydrates from it.
  networkBodiesPath: string | null;
  a11yViolations: import("@/lib/db/schema").A11yViolation[] | null;
  a11yPassesCount: number | null;
  designSystemViolations:
    | import("@/lib/db/schema").DesignSystemViolation[]
    | null;
  designSystemRulesChecked: number | null;
  urlTrajectory: import("@/lib/db/schema").UrlTrajectoryStep[] | null;
  webVitals: import("@/lib/db/schema").WebVitalsSample[] | null;
  extractedVariables: Record<string, string> | null;
  assignedVariables: Record<string, string> | null;
  domSnapshot: import("@/lib/db/schema").DomSnapshotData | null;
  // E1: headless API results (null for browser tests).
  apiResult: import("@/lib/db/schema").ApiTestResultData | null;
}

export interface VerifyFilters {
  /** Restrict to specific case statuses. Empty = all. */
  statuses: Set<CaseStatus>;
  /** Restrict to specific area ids. Empty = all. */
  areaIds: Set<string>;
  /** Issue state filter. 'any' = no filter. */
  issueFilter: "any" | "with" | "without";
  /** Free-text search against test name + step label. */
  query: string;
}

export function emptyFilters(): VerifyFilters {
  return {
    statuses: new Set(),
    areaIds: new Set(),
    issueFilter: "any",
    query: "",
  };
}

interface BoardFocusClientProps {
  build: Build;
  branch: string | null;
  changeMap: ChangeMap | null;
  stepComparisons: StepComparison[];
  areas: AreaLite[];
  tests: TestLite[];
  layerFeedback: StepLayerFeedback[];
  visualDiffs: VisualDiffLite[];
  testResults: TestResultLite[];
  repositoryId: string | null;
  branches: string[];
  defaultBranch: string | null;
  /** Per-repo a11y score history (most recent N builds) used to render the
   *  Recent-trend sparkline inside the focus view's A11y pane. Mirrors the
   *  data shape consumed by `<A11yComplianceCard>` on the build detail page. */
  a11yTrend: Array<{
    id: string;
    a11yScore: number | null;
    createdAt: Date | null;
  }>;
  /** Per-rule drill-in feeding `<A11yViolationsCard>` inside the focus A11y
   *  pane. Server-fetched once with the page so the pane can render without
   *  a client-side waterfall. Empty when the build has no violations. */
  a11yViolations: import("@/lib/db/queries/builds").BuildA11yViolationRow[];
  /** Per-repo design-system score history. Used to render the Recent-trend
   *  sparkline inside the focus view's Design pane. */
  designSystemTrend: Array<{
    id: string;
    designSystemScore: number | null;
    createdAt: Date | null;
  }>;
  /** Per-off-token-rule drill-in feeding `<DesignSystemViolationsCard>`
   *  inside the focus Design pane. */
  designSystemViolations: import("@/lib/db/queries/builds").BuildDesignSystemViolationRow[];
  /** Repo-level design-system config (the uploaded token bundle) so the
   *  review panel can render every token tile, not just those that
   *  appear in violations. */
  repoDesignSystem: import("@/lib/db/schema").DesignSystemConfig | null;
}

type Mode = "board" | "focus";

// Drop targets map to per-layer feedback statuses. `unknown` is special-
// cased in handleDropCase to clear feedback outright (no decision). The
// `fullySnoozed → missed` rule in deriveCaseStatus lets the snoozed status
// double as "reviewer flagged this as missed".
const STATUS_TO_DECISION: Record<
  CaseStatus,
  "approved" | "rejected" | "snoozed" | null
> = {
  done: "approved",
  regression: "rejected",
  missed: "snoozed",
  unknown: null,
};

// Drop targets that produce a typed ticket. `unknown` clears feedback and
// has no ticket side-effect, so it's omitted.
const STATUS_TO_CONFIRM_KIND: Record<
  Exclude<CaseStatus, "unknown">,
  ConfirmKind
> = {
  done: "done",
  regression: "regression",
  missed: "improvement",
};

// Outer component remounts the inner one on buildId change via the React
// `key` prop — that resets all internal polling state cleanly without an
// effect-driven prop-sync (which lints as `setState in effect`).
export function BoardFocusClient(props: BoardFocusClientProps) {
  return <BoardFocusInner key={props.build.id} {...props} />;
}

function BoardFocusInner(props: BoardFocusClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Mode + selected-step are URL-driven so browser back/forward & shareable
  // links work. We pushState on changes (vs replaceState) so each transition
  // becomes its own history entry.
  const [popVersion, setPopVersion] = useState(0);
  useEffect(() => {
    const handler = () => setPopVersion((v) => v + 1);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  const mode: Mode = ((): Mode => {
    const raw = searchParams.get("mode");
    return raw === "focus" ? "focus" : "board";
  })();
  const selectedStepId = searchParams.get("step");

  const updateUrl = useCallback(
    (next: { mode?: Mode; step?: string | null }, replace = false) => {
      const url = new URL(window.location.href);
      if (next.mode !== undefined) {
        if (next.mode === "board") url.searchParams.delete("mode");
        else url.searchParams.set("mode", next.mode);
      }
      if (next.step !== undefined) {
        if (next.step === null) url.searchParams.delete("step");
        else url.searchParams.set("step", next.step);
      }
      const fn = replace ? "replaceState" : "pushState";
      window.history[fn](null, "", url.toString());
      setPopVersion((v) => v + 1);
    },
    [],
  );
  // Reference popVersion so the closure-captured re-render fires on browser nav.
  void popVersion;
  const setMode = useCallback(
    (m: Mode) => {
      updateUrl({ mode: m, step: m === "board" ? null : undefined });
    },
    [updateUrl],
  );
  const setSelectedStepId = useCallback(
    (id: string | null) => {
      updateUrl({ step: id });
    },
    [updateUrl],
  );

  const [refreshing, startRefresh] = useTransition();
  const [, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [filters, setFilters] = useState<VerifyFilters>(emptyFilters());
  const [issuePickerStepId, setIssuePickerStepId] = useState<string | null>(
    null,
  );

  // Live polling state — server passes empty initial arrays so the frame
  // renders instantly; the first refreshFromServer on mount hydrates real
  // data. Polling every 2s while the build is running; once `completedAt`
  // is set, polling stops.
  const [stepComparisons, setStepComparisons] = useState<StepComparison[]>(
    props.stepComparisons,
  );
  const [layerFeedback, setLayerFeedback] = useState<StepLayerFeedback[]>(
    props.layerFeedback,
  );
  const [visualDiffs, setVisualDiffs] = useState<VisualDiffLite[]>(
    props.visualDiffs,
  );
  const [testResults, setTestResults] = useState<TestResultLite[]>(
    props.testResults,
  );
  const [changeMap, setChangeMap] = useState<ChangeMap | null>(props.changeMap);
  const [completedAt, setCompletedAt] = useState<string | null>(
    props.build.completedAt ? props.build.completedAt.toISOString() : null,
  );
  // Per-check 3-way modes driving the cogwheel modal + toolbar pills for
  // all 9 layers. Default mirrors deriveCheckModes() on an empty settings
  // row so the toolbar reads identically to "nothing configured yet"
  // until the first poll lands.
  type CheckModeT = "enforce" | "log" | "disable";
  type CheckModeMapT = {
    visual: CheckModeT;
    text: CheckModeT;
    dom: CheckModeT;
    network: CheckModeT;
    console: CheckModeT;
    a11y: CheckModeT;
    design: CheckModeT;
    perf: CheckModeT;
    url: CheckModeT;
    api: CheckModeT;
  };
  const DEFAULT_CHECK_MODES: CheckModeMapT = {
    visual: "enforce",
    text: "disable",
    dom: "disable",
    network: "enforce",
    console: "enforce",
    a11y: "disable",
    design: "disable",
    perf: "log",
    url: "log",
    api: "enforce",
  };
  const [checkModes, setCheckModes] =
    useState<CheckModeMapT>(DEFAULT_CHECK_MODES);
  const [checkModesByTestId, setCheckModesByTestId] = useState<
    Record<string, Partial<CheckModeMapT>>
  >({});
  const [runningTests, setRunningTests] = useState<
    Array<{ testId: string; name: string }>
  >([]);
  const [liveCounts, setLiveCounts] = useState<{
    totalTests: number;
    passed: number;
    failed: number;
  }>({
    totalTests: props.build.totalTests ?? 0,
    passed: props.build.passedCount ?? 0,
    failed: props.build.failedCount ?? 0,
  });
  // Tracks whether the first cards-hydration pass has come back from the
  // server. The frame still renders with `--` counters while we wait, but
  // the column lists know to show a skeleton instead of "no cases".
  const [cardsLoaded, setCardsLoaded] = useState(
    props.stepComparisons.length > 0,
  );

  /** One-shot pull of the verify-status endpoint. Used by the polling
   *  interval and by post-mutation hooks (issue linked / created / closed)
   *  so client state catches up without a full page reload. Local state is
   *  initialized from props on mount and never re-syncs from props
   *  (intentional — see the BoardFocusClient `key` comment), so server
   *  mutations after the build completes need this manual refresh. */
  const refreshFromServer = useCallback(async () => {
    const buildId = props.build.id;
    try {
      const res = await fetch(`/api/builds/${buildId}/verify-status`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        completedAt: string | null;
        totalTests: number;
        passedCount: number;
        failedCount: number;
        stepComparisons: StepComparison[];
        layerFeedback: StepLayerFeedback[];
        visualDiffs: VisualDiffLite[];
        testResults: TestResultLite[];
        runningTests: Array<{ testId: string; name: string }>;
        changeMap: ChangeMap | null;
        checkModes?: CheckModeMapT;
        checkModesByTestId?: Record<string, Partial<CheckModeMapT>>;
      };
      setStepComparisons(data.stepComparisons);
      // Merge-not-replace: keep any local `optimistic-*` rows whose step has
      // no server row yet, so a poll that lands between an optimistic apply
      // and the matching DB write doesn't snap the card back to its source
      // column. Once any real row arrives for a step, we trust the server.
      setLayerFeedback((prev) => {
        const serverStepsWithRows = new Set(
          data.layerFeedback.map((f) => f.stepComparisonId),
        );
        const survivingOptimistic = prev.filter(
          (f) =>
            f.id.startsWith("optimistic-") &&
            !serverStepsWithRows.has(f.stepComparisonId),
        );
        return [...data.layerFeedback, ...survivingOptimistic];
      });
      setVisualDiffs(data.visualDiffs);
      setTestResults(data.testResults);
      setRunningTests(data.runningTests);
      setLiveCounts({
        totalTests: data.totalTests,
        passed: data.passedCount,
        failed: data.failedCount,
      });
      if (data.changeMap) setChangeMap(data.changeMap);
      if (data.checkModes) setCheckModes(data.checkModes);
      if (data.checkModesByTestId)
        setCheckModesByTestId(data.checkModesByTestId);
      if (data.completedAt && !completedAt) {
        setCompletedAt(data.completedAt);
      }
      setCardsLoaded(true);
    } catch {
      /* best-effort */
    }
  }, [props.build.id, completedAt]);

  // Initial hydration on mount — the server passes empty arrays so the page
  // chrome renders instantly. This pull fills the cards.
  useEffect(() => {
    if (!cardsLoaded) {
      refreshFromServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling effect — only active while completedAt is null.
  useEffect(() => {
    if (completedAt) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      await refreshFromServer();
      if (cancelled) return;
      // Polling owns the "build just completed" handoff: kick a server
      // re-render so change-map + branches refresh once the run is done.
      // (refreshFromServer set completedAt synchronously; check via ref.)
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [completedAt, refreshFromServer]);

  // Once the build has just completed, pull a fresh server render so
  // change-map + branches reload. Runs once per buildId.
  useEffect(() => {
    if (!completedAt) return;
    router.refresh();
    // We deliberately ignore router in deps — refresh on completedAt edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedAt]);

  const isRunning = !completedAt;

  const testById = useMemo(
    () => new Map(props.tests.map((t) => [t.id, t])),
    [props.tests],
  );
  const areaById = useMemo(
    () => new Map(props.areas.map((a) => [a.id, a])),
    [props.areas],
  );
  const changedAreaIds = useMemo(
    () =>
      new Set(
        changeMap?.areas
          .filter(
            (a) => a.sources.includes("code") || a.sources.includes("manual"),
          )
          .map((a) => a.areaId) ?? [],
      ),
    [changeMap],
  );

  // Coverage gaps: areas the Change Map flagged as risky-but-uncovered. The
  // verify board can't show a card for an area with no test, so without this
  // banner the user has no way to spot "this area changed but nothing tested
  // it". An area is uncovered when the current build has 0 step_comparisons
  // for any test in that area — even if a test exists, if it didn't run we
  // can't claim coverage for this PR.
  const coveredAreaIds = useMemo(() => {
    const s = new Set<string>();
    for (const step of stepComparisons) {
      const test = testById.get(step.testId);
      if (test?.functionalAreaId) s.add(test.functionalAreaId);
    }
    return s;
  }, [stepComparisons, testById]);

  const coverageGaps = useMemo(() => {
    if (!changeMap) return [];
    return changeMap.areas.filter(
      (a) =>
        (a.sources.includes("code") || a.sources.includes("manual")) &&
        !coveredAreaIds.has(a.areaId),
    );
  }, [changeMap, coveredAreaIds]);

  // Areas the reviewer has already dispatched coverArea for in this session —
  // suppresses the chip so repeated clicks don't create duplicate placeholders
  // before a refresh lands.
  const [dispatchedAreaIds, setDispatchedAreaIds] = useState<Set<string>>(
    new Set(),
  );

  const handleCoverArea = useCallback(
    (areaId: string) => {
      setDispatchedAreaIds((prev) => new Set(prev).add(areaId));
      startTransition(async () => {
        const result = await coverArea({
          areaId,
          buildId: props.build.id,
        }).catch(
          (e) =>
            ({
              ok: false,
              error: e instanceof Error ? e.message : "unknown",
            }) as { ok: false; error: string },
        );
        if (!result.ok) {
          toast.error("Could not draft coverage test", {
            description: result.error,
          });
          // Un-dispatch so the user can retry.
          setDispatchedAreaIds((prev) => {
            const next = new Set(prev);
            next.delete(areaId);
            return next;
          });
          return;
        }
        toast.success(`Drafted ${result.title ?? "spec"}`, {
          description: "Open the spec to generate the test code.",
          action: result.testId
            ? {
                label: "Open",
                onClick: () => router.push(`/tests/${result.testId}`),
              }
            : undefined,
        });
      });
    },
    [props.build.id, router],
  );

  const visualByStepKey = useMemo(() => {
    const m = new Map<string, VisualDiffLite>();
    for (const d of visualDiffs) {
      const key = `${d.testId}::${d.stepLabel ?? ""}`;
      if (!m.has(key)) m.set(key, d);
    }
    return m;
  }, [visualDiffs]);

  // Map testResultId → TestResultLite for the focus view's "captured-no-diff"
  // panes (used to show real data even when there's no scored evidence).
  const testResultById = useMemo(() => {
    const m = new Map<string, TestResultLite>();
    for (const r of testResults) m.set(r.id, r);
    return m;
  }, [testResults]);

  // Filter step comparisons before passing into views.
  const filteredSteps = useMemo(() => {
    return stepComparisons.filter((step) => {
      if (filters.areaIds.size > 0) {
        const test = testById.get(step.testId);
        if (
          !test?.functionalAreaId ||
          !filters.areaIds.has(test.functionalAreaId)
        )
          return false;
      }
      if (filters.issueFilter === "with" && !step.githubIssueUrl) return false;
      if (filters.issueFilter === "without" && step.githubIssueUrl)
        return false;
      if (filters.query.trim().length > 0) {
        const q = filters.query.trim().toLowerCase();
        const test = testById.get(step.testId);
        const haystack =
          `${test?.name ?? ""} ${step.stepLabel ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Status filter is applied AFTER status derivation in the views (since
      // the views need the full set to compute counts). We pass the set down
      // and let them honor it.
      return true;
    });
  }, [stepComparisons, filters, testById]);

  const totalCases = filteredSteps.length;
  // A case is "verified" when its derived status is anything but `unknown`:
  //   - done (passed cleanly OR approved by reviewer / auto-approved)
  //   - regression (red verdict OR rejected)
  //   - missed (yellow in changed area)
  // All three are settled, only `unknown` is open.
  const verifiedCount = useMemo(() => {
    const fbByStep = new Map<string, StepLayerFeedback[]>();
    for (const f of layerFeedback) {
      if (!fbByStep.has(f.stepComparisonId))
        fbByStep.set(f.stepComparisonId, []);
      fbByStep.get(f.stepComparisonId)!.push(f);
    }
    let n = 0;
    for (const step of filteredSteps) {
      const test = testById.get(step.testId);
      const isInChangedArea = !!(
        test?.functionalAreaId && changedAreaIds.has(test.functionalAreaId)
      );
      const result = step.testResultId
        ? (testResultById.get(step.testResultId) ?? null)
        : null;
      const modes = mergeWithTestOverrides(
        checkModes,
        test?.id ? checkModesByTestId[test.id] : null,
      );
      const status = deriveCaseStatus({
        step,
        feedback: fbByStep.get(step.id) ?? [],
        isInChangedArea,
        testFailed:
          result?.status === "failed" || result?.status === "setup_failed",
        verdictOverride: effectiveVerdict(step.evidence, modes),
      });
      if (status !== "unknown") n++;
    }
    return n;
  }, [
    layerFeedback,
    filteredSteps,
    testById,
    changedAreaIds,
    testResultById,
    checkModes,
    checkModesByTestId,
  ]);

  const handleRefresh = () => {
    if (!props.repositoryId) return;
    startRefresh(async () => {
      const result = await runVerifyBuild(props.repositoryId!);
      if ("error" in result) {
        toast.error(result.error || "Could not start build");
        return;
      }
      // If the smart path bailed (no diff vs base, GitHub unavailable, etc.)
      // we just ran every test instead — let the user know so they aren't
      // confused about why the build is wider than expected.
      if (result.fallback) {
        toast.message("Running all tests", { description: result.reason });
      }
      router.push(`/verify/${result.buildId}`);
      router.refresh();
    });
  };

  // Returns a promise that resolves once every per-layer decideLayer write
  // for this step has hit the DB. The optimistic local row write is done
  // SYNCHRONOUSLY before the promise is created so the card moves the moment
  // the user lets go of the mouse. Callers should `await` the returned
  // promise before triggering `refreshFromServer` — otherwise a poll that
  // lands between the optimistic apply and the DB commit would replace the
  // local rows with stale server data and snap the case back to its prior
  // column. (This was the "drag, thing get undone, page no refresh" bug.)
  const decideAllForStep = (
    stepId: string,
    status: "approved" | "rejected" | "snoozed",
  ): Promise<void> => {
    const step = stepComparisons.find((s) => s.id === stepId);
    if (!step) return Promise.resolve();
    // Persist a decision for every evidence layer + every layer that already
    // has feedback in the DB. Without the second part, a stale `rejected`
    // row on a layer that wasn't in step.evidence would survive the override
    // and pin the case in regression after the next poll. Fallback to
    // `visual` when there's nothing else to write against (typical for
    // hard-failed tests with no diff evidence).
    const evidenceLayers =
      step.evidence.length > 0
        ? Array.from(new Set(step.evidence.map((e) => e.layer)))
        : ([] as EvidenceLayer[]);
    const existingLayers = layerFeedback
      .filter((f) => f.stepComparisonId === stepId)
      .map((f) => f.layer);
    const layerSet = new Set<EvidenceLayer>([
      ...evidenceLayers,
      ...existingLayers,
    ]);
    if (layerSet.size === 0) layerSet.add("visual");
    const layers: EvidenceLayer[] = Array.from(layerSet);

    // Optimistic local feedback so the card moves to the new column INSTANTLY
    // — no waiting on round-trips.
    const fakeStatus =
      status === "approved"
        ? "approved"
        : status === "rejected"
          ? "rejected"
          : "snoozed";
    const optimisticRows: StepLayerFeedback[] = layers.map((layer) => ({
      id: `optimistic-${stepId}-${layer}`,
      stepComparisonId: stepId,
      buildId: props.build.id,
      layer,
      status: fakeStatus,
      baselineKind: null,
      reviewTodoId: null,
      note: null,
      decidedBy: null,
      decidedAt: new Date(),
      aiRecommendation: null,
      createdAt: new Date(),
    }));
    // Strip ALL prior feedback for this step (real OR optimistic) so a stale
    // rejected row from an earlier decision can't leak through and pin the
    // case in `regression` (anyRejected wins in deriveCaseStatus). The whole-
    // case action is meant to override per-layer decisions outright.
    setLayerFeedback((prev) => [
      ...prev.filter((f) => f.stepComparisonId !== stepId),
      ...optimisticRows,
    ]);

    // Persist in parallel — N decideLayer writes, 1 wall-clock roundtrip.
    // Returned to the caller so they can sequence refreshFromServer after
    // the writes have committed.
    return Promise.all(
      layers.map((layer) =>
        decideLayer({
          stepComparisonId: stepId,
          buildId: props.build.id,
          layer,
          status,
        }).catch(() => null),
      ),
    ).then(() => undefined);
  };

  /** Bulk-action over every filtered case currently sitting in a given
   *  column. The header-level "Mark all verified" button is gone in v1.15B —
   *  columns expose their own actions instead so reviewers can sweep an
   *  entire bucket (Verify all on Unsorted/Broken/Missed; Report all on
   *  Broken/Missed) without dragging each card individually. */
  const handleColumnAction = (
    column: CaseStatus,
    action: "verify" | "report",
  ) => {
    const fbByStep = new Map<string, StepLayerFeedback[]>();
    for (const f of layerFeedback) {
      if (!fbByStep.has(f.stepComparisonId))
        fbByStep.set(f.stepComparisonId, []);
      fbByStep.get(f.stepComparisonId)!.push(f);
    }
    const targets: string[] = [];
    for (const step of filteredSteps) {
      const test = testById.get(step.testId);
      const isInChangedArea = !!(
        test?.functionalAreaId && changedAreaIds.has(test.functionalAreaId)
      );
      const result = step.testResultId
        ? (testResultById.get(step.testResultId) ?? null)
        : null;
      const derived = deriveCaseStatus({
        step,
        feedback: fbByStep.get(step.id) ?? [],
        isInChangedArea,
        testFailed:
          result?.status === "failed" || result?.status === "setup_failed",
      });
      if (derived === column) targets.push(step.id);
    }
    if (targets.length === 0) {
      toast.message("No cases in this column to act on");
      return;
    }

    // "Verify all" always lands cases in the Verified column. "Report all"
    // is only valid on Broken (→ regression bug) and Missed (→ improvement)
    // — the underlying decideAllForStep keeps the case in its current
    // column while confirmCase files the typed GH ticket.
    let confirmKind: ConfirmKind | null = null;
    if (action === "verify") {
      confirmKind = "done";
    } else if (column === "regression") {
      confirmKind = "regression";
    } else if (column === "missed") {
      confirmKind = "improvement";
    } else {
      return;
    }

    const decision =
      action === "verify"
        ? "approved"
        : column === "regression"
          ? "rejected"
          : "snoozed";

    startTransition(async () => {
      // 1) Optimistic + per-layer writes for every target.
      await Promise.all(targets.map((id) => decideAllForStep(id, decision)));

      // 2) File / close GH tickets in parallel.
      const results = await Promise.all(
        targets.map((id) => confirmCase(id, confirmKind!).catch(() => null)),
      );
      const filed = results.filter(
        (r) => r?.ticketChanged && r.issueUrl,
      ).length;
      const closed = results.filter(
        (r) => r?.ticketChanged && confirmKind === "done",
      ).length;

      // 3) Settle the UI against the authoritative server state.
      await refreshFromServer();

      if (action === "verify") {
        toast.success(
          `${targets.length} case${targets.length === 1 ? "" : "s"} verified`,
          closed > 0
            ? {
                description: `Closed ${closed} ticket${closed === 1 ? "" : "s"}`,
              }
            : undefined,
        );
      } else if (filed > 0) {
        toast.success(`Filed ${filed} ticket${filed === 1 ? "" : "s"}`);
      } else {
        toast.message(
          `${targets.length} case${targets.length === 1 ? "" : "s"} updated`,
        );
      }
    });
  };

  /** Per-evidence Expected/Needs fix click. Optimistically writes the layer
   *  feedback so the panel reflects the decision before the round-trip
   *  finishes; persists in the background. */
  const decideOneLayer = (
    stepId: string,
    layer: EvidenceLayer,
    status: "approved" | "rejected" | "snoozed",
  ) => {
    const optimistic: StepLayerFeedback = {
      id: `optimistic-${stepId}-${layer}`,
      stepComparisonId: stepId,
      buildId: props.build.id,
      layer,
      status,
      baselineKind: null,
      reviewTodoId: null,
      note: null,
      decidedBy: null,
      decidedAt: new Date(),
      aiRecommendation: null,
      createdAt: new Date(),
    };
    setLayerFeedback((prev) => [
      // remove any prior decision (real or optimistic) on this exact step+layer
      ...prev.filter(
        (f) => !(f.stepComparisonId === stepId && f.layer === layer),
      ),
      optimistic,
    ]);

    startTransition(async () => {
      await decideLayer({
        stepComparisonId: stepId,
        buildId: props.build.id,
        layer,
        status,
      }).catch(() => null);
      router.refresh();
    });
  };

  const handleOpenCase = (stepId: string) => {
    // Single history entry that flips mode AND selects the step — back-button
    // returns straight to the board view.
    updateUrl({ mode: "focus", step: stepId });
  };

  const handleDropCase = (stepId: string, target: CaseStatus) => {
    // Dropping on Unsorted = clear all feedback for the step so its derived
    // status falls back to verdict-based classification. The user's drop
    // always wins over any prior decision: stripping local rows + writing
    // `pending` on the layers (deriveCaseStatus ignores pending rows
    // entirely) clears stale approvals/rejections that would otherwise
    // persist.
    if (target === "unknown") {
      const layers = Array.from(
        new Set(
          layerFeedback
            .filter((f) => f.stepComparisonId === stepId)
            .map((f) => f.layer),
        ),
      );
      setLayerFeedback((prev) =>
        prev.filter((f) => f.stepComparisonId !== stepId),
      );
      startTransition(async () => {
        await Promise.all(
          layers.map((layer) =>
            decideLayer({
              stepComparisonId: stepId,
              buildId: props.build.id,
              layer,
              status: "pending",
            }).catch(() => null),
          ),
        );
        await refreshFromServer();
      });
      return;
    }
    // approved (Verified), rejected (Broken), snoozed (Missed) — all flow
    // through decideAllForStep which already strips any prior feedback for
    // the step before writing the new decision, so it cleanly overrides.
    const decision = STATUS_TO_DECISION[target];
    if (!decision) return;

    // Verify phase (v1.14+) — also fire the typed-ticket confirmation. This
    // is the only path that creates GH issues from a column drop:
    //   - Verified  → close any linked issue
    //   - Broken    → file a `bugfix` issue
    //   - Missed    → file an `improvement` issue
    const confirmKind =
      STATUS_TO_CONFIRM_KIND[target as Exclude<CaseStatus, "unknown">];

    // CRITICAL — sequence everything in ONE transition so refreshFromServer
    // never reads server state before the decideLayer writes have committed.
    // Two parallel transitions caused the "card snaps back" bug: confirmCase
    // would finish + call refreshFromServer, which replaced the optimistic
    // rows with stale (pre-decideLayer) server data → card returned to its
    // original column.
    startTransition(async () => {
      // 1) Persist the per-layer decision. The optimistic UI move already
      //    happened synchronously inside decideAllForStep before the await.
      await decideAllForStep(stepId, decision);

      // 2) File / close the linked issue, if applicable.
      if (confirmKind) {
        const result = await confirmCase(stepId, confirmKind).catch(() => null);
        if (result?.ok) {
          if (result.ticketChanged && result.issueUrl) {
            toast.success(`Filed ${result.issueKind ?? "verify"} ticket`, {
              description: result.issueUrl,
              action: {
                label: "Open",
                onClick: () => window.open(result.issueUrl!, "_blank"),
              },
            });
          } else if (result.ticketChanged && confirmKind === "done") {
            toast.success("Closed linked ticket");
          }
        }
      }

      // 3) Now and only now refresh from the server — every decideLayer +
      //    confirmCase write is committed, so the merged poll won't pull
      //    stale rows over our optimistic ones.
      await refreshFromServer();
    });
  };

  const handleBranchSelect = (branch: string) => {
    if (!props.repositoryId || branch === props.branch) {
      setBranchOpen(false);
      return;
    }
    startTransition(async () => {
      await updateRepoSelectedBranch(props.repositoryId!, branch);
      // After the branch change, the dashboard route will redirect to the
      // latest build of the new branch.
      router.push("/verify");
    });
    setBranchOpen(false);
  };

  const buildLabel = useMemo(() => {
    const parts: string[] = [];
    if (props.branch) parts.push(props.branch);
    if (props.build.completedAt)
      parts.push(new Date(props.build.completedAt).toLocaleDateString());
    parts.push(`${props.build.totalTests ?? 0} tests`);
    return parts.join(" · ");
  }, [props.branch, props.build]);

  const filterBadge = filterCount(filters);

  return (
    <div
      className="verify-page"
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        inset: 0,
        background: "var(--c-soft-2)",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Header — no secondary logo (sidebar already shows the brand). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--c-white)",
          position: "relative",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--fg-1)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Verify
            {isRunning && (
              <span className="v-chip info" style={{ fontSize: 10 }}>
                <Loader2
                  size={10}
                  className="anim-spin"
                  style={{ animation: "verify-spin 1s linear infinite" }}
                />
                running · {liveCounts.passed + liveCounts.failed} /{" "}
                {liveCounts.totalTests}
              </span>
            )}
          </div>
          <div className="label" style={{ marginTop: 2 }}>
            Build #{props.build.id.slice(0, 8)} · {buildLabel} ·{" "}
            {!cardsLoaded
              ? "loading cases…"
              : mode === "board"
                ? `${verifiedCount} / ${totalCases} verified`
                : `${totalCases} cases`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="v-tabs">
            <button
              className={`v-tab ${mode === "board" ? "active" : ""}`}
              onClick={() => setMode("board")}
            >
              Board
            </button>
            <button
              className={`v-tab ${mode === "focus" ? "active" : ""}`}
              onClick={() => setMode("focus")}
            >
              Focus
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <button className="v-btn" onClick={() => setFiltersOpen((v) => !v)}>
              <Filter size={13} />
              Filter
              {filterBadge > 0 && (
                <span
                  className="v-chip info"
                  style={{ fontSize: 9, padding: "0 5px" }}
                >
                  {filterBadge}
                </span>
              )}
            </button>
            {filtersOpen && (
              <FilterPanel
                filters={filters}
                areas={props.areas}
                onChange={setFilters}
                onClose={() => setFiltersOpen(false)}
              />
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              className="v-btn"
              onClick={() => setBranchOpen((v) => !v)}
              disabled={!props.repositoryId}
            >
              <GitBranch size={13} />
              {props.branch ?? "unknown"}
              <ChevronDown size={11} />
            </button>
            {branchOpen && props.branches.length > 0 && (
              <BranchPicker
                current={props.branch}
                defaultBranch={props.defaultBranch}
                branches={props.branches}
                onSelect={handleBranchSelect}
                onClose={() => setBranchOpen(false)}
              />
            )}
          </div>
          <button
            className="v-btn primary"
            onClick={handleRefresh}
            disabled={refreshing || !props.repositoryId}
          >
            <Play size={13} />
            {refreshing ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      <BuildAbortedBanner
        build={props.build}
        completedAt={completedAt}
        runResultCount={testResults.length}
        scoredCaseCount={stepComparisons.length}
      />

      <CoverageGapsBanner
        gaps={coverageGaps}
        dispatchedAreaIds={dispatchedAreaIds}
        onCover={handleCoverArea}
      />

      {mode === "board" ? (
        <BoardView
          buildId={props.build.id}
          steps={filteredSteps}
          feedback={layerFeedback}
          testById={testById}
          areaById={areaById}
          changedAreaIds={changedAreaIds}
          visualByStepKey={visualByStepKey}
          testResultById={testResultById}
          statusFilter={filters.statuses}
          isRunning={isRunning}
          runningTests={runningTests}
          cardsLoaded={cardsLoaded}
          onOpenCase={handleOpenCase}
          onDropCase={handleDropCase}
          onColumnAction={handleColumnAction}
          onOpenIssuePicker={(stepId) => setIssuePickerStepId(stepId)}
          checkModes={checkModes}
          checkModesByTestId={checkModesByTestId}
        />
      ) : (
        <FocusView
          buildId={props.build.id}
          steps={filteredSteps}
          feedback={layerFeedback}
          testById={testById}
          areaById={areaById}
          changedAreaIds={changedAreaIds}
          visualByStepKey={visualByStepKey}
          testResultById={testResultById}
          checkModes={checkModes}
          checkModesByTestId={checkModesByTestId}
          repositoryId={props.repositoryId}
          statusFilter={filters.statuses}
          selectedStepId={selectedStepId}
          onSelect={setSelectedStepId}
          onMarkDecision={decideAllForStep}
          onDecideLayer={decideOneLayer}
          onOpenIssuePicker={(stepId) => setIssuePickerStepId(stepId)}
          onRefresh={refreshFromServer}
          buildA11y={{
            score: props.build.a11yScore,
            violationCount: props.build.a11yViolationCount,
            criticalCount: props.build.a11yCriticalCount,
            totalRulesChecked: props.build.a11yTotalRulesChecked,
            trend: props.a11yTrend,
            violations: props.a11yViolations,
          }}
          buildDesignSystem={{
            score: props.build.designSystemScore,
            violationCount: props.build.designSystemViolationCount,
            criticalCount: props.build.designSystemCriticalCount,
            totalRulesChecked: props.build.designSystemTotalRulesChecked,
            tokenUsage: props.build.designSystemTokenUsage,
            trend: props.designSystemTrend,
            violations: props.designSystemViolations,
            config: props.repoDesignSystem,
          }}
        />
      )}

      {issuePickerStepId &&
        (() => {
          const step = stepComparisons.find((s) => s.id === issuePickerStepId);
          const test = step ? (testById.get(step.testId) ?? null) : null;
          const title = step
            ? `[Verify] ${test?.name ?? "case"} — ${step.stepLabel ?? "step"}`
            : "Verify case";
          return (
            <IssuePickerDialog
              key={issuePickerStepId}
              open
              onClose={() => setIssuePickerStepId(null)}
              stepComparisonId={issuePickerStepId}
              caseTitle={title}
              defaultTitle={title}
              defaultBody={step?.reviewerNote ?? ""}
              onLinked={refreshFromServer}
            />
          );
        })()}

      <style jsx global>{`
        @keyframes verify-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes verify-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

function filterCount(f: VerifyFilters): number {
  let n = 0;
  n += f.statuses.size;
  n += f.areaIds.size;
  if (f.issueFilter !== "any") n += 1;
  if (f.query.trim().length > 0) n += 1;
  return n;
}

interface BuildAbortedBannerProps {
  build: Build;
  completedAt: string | null;
  runResultCount: number;
  scoredCaseCount: number;
}

// Surfaces non-success terminal states so users don't mistake a partial
// recovery for a clean run. Shown only when the build has stopped (it's
// terminal, not just slow) AND its status indicates the executor itself
// failed — not a normal "diffs need review" state.
function BuildAbortedBanner({
  build,
  completedAt,
  runResultCount,
  scoredCaseCount,
}: BuildAbortedBannerProps) {
  // Still running → the running-state chip in the header already handles it.
  if (!completedAt) return null;

  const status = build.overallStatus;
  const isExecutorFailed = status === "executor_failed";
  const isBlocked = status === "blocked";
  if (!isExecutorFailed && !isBlocked) return null;

  // 'blocked' covers two distinct meanings on builds: (a) the diff-driven
  // "needs review" state, (b) the runBuildAsync catch fallback when results
  // landed but the run threw. We can only distinguish by inspecting whether
  // executorError or executorFailedAt is set, or by inferring from totals.
  // Heuristic: if totalTests > 0 and we got fewer test_results than tests
  // were planned, the build was aborted mid-execution.
  const planned = build.totalTests ?? 0;
  const isPartial =
    isExecutorFailed || (isBlocked && planned > 0 && runResultCount < planned);
  if (!isPartial) return null;

  const errorBody = (build.executorError ?? "").trim();
  const errorHead =
    errorBody.length > 0 ? errorBody.split("\n")[0]?.slice(0, 240) : null;

  const isCleanFail = isExecutorFailed || runResultCount === 0;
  const accent = isCleanFail ? "var(--c-red)" : "var(--c-amber)";
  const bg = `color-mix(in oklab, ${accent} 10%, var(--c-white))`;
  const heading = isCleanFail
    ? "Build failed — no tests ran"
    : `Build aborted mid-run — recovered ${scoredCaseCount} of ${planned} cases`;
  const detail = isCleanFail
    ? "The executor crashed before any test produced a result. Re-run to retry."
    : `${runResultCount} test result${runResultCount === 1 ? "" : "s"} were captured; the rest were lost when the run was interrupted.`;

  return (
    <div
      style={{
        padding: "10px 20px",
        background: bg,
        borderBottom: `1px solid color-mix(in oklab, ${accent} 30%, var(--border))`,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        fontSize: 12,
      }}
    >
      <AlertOctagon
        size={14}
        style={{ color: accent, marginTop: 1, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{heading}</div>
        <div className="label" style={{ marginTop: 2 }}>
          {detail} The build is no longer running.
        </div>
        {errorHead && (
          <div
            className="mono"
            style={{
              marginTop: 6,
              padding: "4px 6px",
              fontSize: 11,
              color: "var(--fg-2)",
              background: "var(--c-soft-2)",
              borderRadius: 4,
              wordBreak: "break-word",
            }}
            title={errorBody}
          >
            {errorHead}
          </div>
        )}
      </div>
    </div>
  );
}

interface CoverageGapsBannerProps {
  gaps: import("@/lib/db/schema").ChangeMapArea[];
  dispatchedAreaIds: Set<string>;
  onCover: (areaId: string) => void;
}

// Surfaces Change-Map areas that the current build did not cover. Compact by
// design: one row, one chip per area, AI narrative on hover so we don't eat
// vertical real estate on a build with many gaps. The chip's CTA is the only
// path from the verify board to a "draft a covering test" action.
function CoverageGapsBanner({
  gaps,
  dispatchedAreaIds,
  onCover,
}: CoverageGapsBannerProps) {
  if (gaps.length === 0) return null;
  return (
    <div
      style={{
        padding: "8px 20px",
        background: "color-mix(in oklab, var(--c-amber) 8%, var(--c-white))",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12,
        flexWrap: "wrap",
      }}
    >
      <AlertTriangle size={13} style={{ color: "var(--c-amber)" }} />
      <span style={{ fontWeight: 500, color: "var(--fg-1)" }}>
        Coverage gaps
      </span>
      <span className="label">
        {gaps.length === 1
          ? "changed area with no test on this build"
          : `${gaps.length} changed areas with no test on this build`}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginLeft: 4 }}>
        {gaps.map((g) => {
          const dispatched = dispatchedAreaIds.has(g.areaId);
          const narrative = g.aiNarrative?.join(" · ") ?? "";
          return (
            <button
              key={g.areaId}
              onClick={() => !dispatched && onCover(g.areaId)}
              disabled={dispatched}
              title={narrative || `Draft a covering test for ${g.areaName}`}
              className="v-chip"
              style={{
                cursor: dispatched ? "default" : "pointer",
                opacity: dispatched ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: dispatched
                  ? "var(--c-soft-2)"
                  : "color-mix(in oklab, var(--c-amber) 16%, var(--c-white))",
                color: "var(--fg-1)",
                border:
                  "1px solid color-mix(in oklab, var(--c-amber) 30%, var(--border))",
              }}
            >
              <Sparkles size={11} />
              {g.areaName}
              <span className="label" style={{ fontSize: 9, marginLeft: 4 }}>
                {dispatched ? "drafting…" : "cover this area"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FilterPanelProps {
  filters: VerifyFilters;
  areas: AreaLite[];
  onChange: (f: VerifyFilters) => void;
  onClose: () => void;
}

function FilterPanel({ filters, areas, onChange, onClose }: FilterPanelProps) {
  const STATUSES: CaseStatus[] = ["unknown", "regression", "missed", "done"];
  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };
  return (
    <>
      {/* outer backdrop catches off-clicks */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
      />
      <div
        className="v-card"
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 320,
          padding: 14,
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div className="label">Filter</div>
          <button className="v-btn ghost icon" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>
            Search
          </div>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="test name or step label"
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--c-white)",
              color: "var(--fg-1)",
            }}
          />
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>
            Status
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {STATUSES.map((s) => {
              const active = filters.statuses.has(s);
              return (
                <button
                  key={s}
                  className={`v-chip ${active ? s : ""}`}
                  style={{
                    cursor: "pointer",
                    textTransform: "capitalize",
                    opacity: active ? 1 : 0.55,
                  }}
                  onClick={() =>
                    onChange({
                      ...filters,
                      statuses: toggle(filters.statuses, s),
                    })
                  }
                >
                  <span className="dot" />
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>
            Area
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              maxHeight: 100,
              overflowY: "auto",
            }}
          >
            {areas.length === 0 && (
              <span className="label" style={{ fontSize: 9 }}>
                no areas
              </span>
            )}
            {areas.map((a) => {
              const active = filters.areaIds.has(a.id);
              return (
                <button
                  key={a.id}
                  className={`v-chip ${active ? "info" : ""}`}
                  style={{ cursor: "pointer", opacity: active ? 1 : 0.55 }}
                  onClick={() =>
                    onChange({
                      ...filters,
                      areaIds: toggle(filters.areaIds, a.id),
                    })
                  }
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>
            Issue
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["any", "with", "without"] as const).map((opt) => (
              <button
                key={opt}
                className={`v-chip ${filters.issueFilter === opt ? "info" : ""}`}
                style={{
                  cursor: "pointer",
                  opacity: filters.issueFilter === opt ? 1 : 0.55,
                  textTransform: "capitalize",
                }}
                onClick={() => onChange({ ...filters, issueFilter: opt })}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <button
          className="v-btn sm ghost"
          onClick={() => onChange(emptyFilters())}
          style={{ alignSelf: "flex-end" }}
        >
          Reset filters
        </button>
      </div>
    </>
  );
}

interface BranchPickerProps {
  current: string | null;
  defaultBranch: string | null;
  branches: string[];
  onSelect: (branch: string) => void;
  onClose: () => void;
}

function BranchPicker({
  current,
  defaultBranch,
  branches,
  onSelect,
  onClose,
}: BranchPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches
      .filter((b) => !q || b.toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, branches]);
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
      />
      <div
        className="v-card"
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 280,
          padding: 8,
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search branch…"
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--c-white)",
            color: "var(--fg-1)",
          }}
        />
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {filtered.map((b) => {
            const active = b === current;
            return (
              <button
                key={b}
                onClick={() => onSelect(b)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  background: active
                    ? "color-mix(in oklab, var(--c-teal) 12%, white)"
                    : "transparent",
                  color: active ? "#1F7B66" : "var(--fg-1)",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  border: "0",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b}
                </span>
                {b === defaultBranch && (
                  <span className="label" style={{ fontSize: 9 }}>
                    default
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="label" style={{ padding: 8, fontSize: 9 }}>
              no matches
            </div>
          )}
        </div>
      </div>
    </>
  );
}
