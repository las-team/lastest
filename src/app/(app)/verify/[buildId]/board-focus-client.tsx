'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, GitBranch, Play, ChevronDown, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { runVerifyBuild } from '@/server/actions/smart-run';
import { decideLayer } from '@/server/actions/layer-feedback';
import { updateRepoSelectedBranch } from '@/server/actions/repos';
import type {
  Build,
  ChangeMap,
  EvidenceLayer,
  StepComparison,
  StepLayerFeedback,
} from '@/lib/db/schema';
import { deriveCaseStatus } from '@/lib/verify/case-status';
import { IssuePickerDialog } from '@/components/verify/issue-picker-dialog';
import { BoardView, type CaseStatus } from './board-view';
import { FocusView } from './focus-view';
import '../verify-design.css';

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

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
  domDiff: import('@/lib/db/schema').DomDiffResult | null;
  /** Per-region rectangles (added/removed/changed/etc.) — drawn on the
   *  current screenshot in the visual pane "Regions" overlay. */
  changedRegions: import('@/lib/db/schema').DiffMetadata['changedRegions'] | null;
  /** innerText diff status — populated when textDiffEnabled in
   *  diffSensitivitySettings. Surfaces the Text tab on the focus view. */
  textDiffStatus: import('@/lib/db/schema').TextDiffStatus | null;
  baselineTextPath: string | null;
  currentTextPath: string | null;
  /** Line-count summary computed during the diff run; lets the Text tab
   *  render +/− deltas without re-fetching the text files. */
  textDiffSummary: { added: number; removed: number; sameAsBaseline: boolean } | null;
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
  networkRequests: import('@/lib/db/schema').NetworkRequest[] | null;
  a11yViolations: import('@/lib/db/schema').A11yViolation[] | null;
  a11yPassesCount: number | null;
  urlTrajectory: import('@/lib/db/schema').UrlTrajectoryStep[] | null;
  webVitals: import('@/lib/db/schema').WebVitalsSample[] | null;
  extractedVariables: Record<string, string> | null;
  assignedVariables: Record<string, string> | null;
  domSnapshot: import('@/lib/db/schema').DomSnapshotData | null;
}

export interface VerifyFilters {
  /** Restrict to specific case statuses. Empty = all. */
  statuses: Set<CaseStatus>;
  /** Restrict to specific area ids. Empty = all. */
  areaIds: Set<string>;
  /** Issue state filter. 'any' = no filter. */
  issueFilter: 'any' | 'with' | 'without';
  /** Free-text search against test name + step label. */
  query: string;
}

export function emptyFilters(): VerifyFilters {
  return { statuses: new Set(), areaIds: new Set(), issueFilter: 'any', query: '' };
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
}

type Mode = 'board' | 'focus';

// Drop targets map to per-layer feedback statuses. `unknown` is special-
// cased in handleDropCase to clear feedback outright (no decision). The
// `fullySnoozed → missed` rule in deriveCaseStatus lets the snoozed status
// double as "reviewer flagged this as missed".
const STATUS_TO_DECISION: Record<CaseStatus, 'approved' | 'rejected' | 'snoozed' | null> = {
  done: 'approved',
  regression: 'rejected',
  missed: 'snoozed',
  unknown: null,
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
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  const mode: Mode = ((): Mode => {
    const raw = searchParams.get('mode');
    return raw === 'focus' ? 'focus' : 'board';
  })();
  const selectedStepId = searchParams.get('step');

  const updateUrl = useCallback((next: { mode?: Mode; step?: string | null }, replace = false) => {
    const url = new URL(window.location.href);
    if (next.mode !== undefined) {
      if (next.mode === 'board') url.searchParams.delete('mode');
      else url.searchParams.set('mode', next.mode);
    }
    if (next.step !== undefined) {
      if (next.step === null) url.searchParams.delete('step');
      else url.searchParams.set('step', next.step);
    }
    const fn = replace ? 'replaceState' : 'pushState';
    window.history[fn](null, '', url.toString());
    setPopVersion((v) => v + 1);
  }, []);
  // Reference popVersion so the closure-captured re-render fires on browser nav.
  void popVersion;
  const setMode = useCallback((m: Mode) => {
    updateUrl({ mode: m, step: m === 'board' ? null : undefined });
  }, [updateUrl]);
  const setSelectedStepId = useCallback((id: string | null) => {
    updateUrl({ step: id });
  }, [updateUrl]);

  const [refreshing, startRefresh] = useTransition();
  const [, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [filters, setFilters] = useState<VerifyFilters>(emptyFilters());
  const [issuePickerStepId, setIssuePickerStepId] = useState<string | null>(null);

  // Live polling state — initialised from props, refreshed every 2s while
  // the build is running. Once `completedAt` is set, polling stops.
  const [stepComparisons, setStepComparisons] = useState<StepComparison[]>(props.stepComparisons);
  const [layerFeedback, setLayerFeedback] = useState<StepLayerFeedback[]>(props.layerFeedback);
  const [visualDiffs, setVisualDiffs] = useState<VisualDiffLite[]>(props.visualDiffs);
  const [testResults, setTestResults] = useState<TestResultLite[]>(props.testResults);
  const [completedAt, setCompletedAt] = useState<string | null>(
    props.build.completedAt ? props.build.completedAt.toISOString() : null,
  );
  const [runningTests, setRunningTests] = useState<Array<{ testId: string; name: string }>>([]);
  const [liveCounts, setLiveCounts] = useState<{ totalTests: number; passed: number; failed: number }>({
    totalTests: props.build.totalTests ?? 0,
    passed: props.build.passedCount ?? 0,
    failed: props.build.failedCount ?? 0,
  });

  /** One-shot pull of the verify-status endpoint. Used by the polling
   *  interval and by post-mutation hooks (issue linked / created / closed)
   *  so client state catches up without a full page reload. Local state is
   *  initialized from props on mount and never re-syncs from props
   *  (intentional — see the BoardFocusClient `key` comment), so server
   *  mutations after the build completes need this manual refresh. */
  const refreshFromServer = useCallback(async () => {
    const buildId = props.build.id;
    try {
      const res = await fetch(`/api/builds/${buildId}/verify-status`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as {
        completedAt: string | null;
        totalTests: number; passedCount: number; failedCount: number;
        stepComparisons: StepComparison[];
        layerFeedback: StepLayerFeedback[];
        visualDiffs: VisualDiffLite[];
        testResults: TestResultLite[];
        runningTests: Array<{ testId: string; name: string }>;
      };
      setStepComparisons(data.stepComparisons);
      setLayerFeedback(data.layerFeedback);
      setVisualDiffs(data.visualDiffs);
      setTestResults(data.testResults);
      setRunningTests(data.runningTests);
      setLiveCounts({ totalTests: data.totalTests, passed: data.passedCount, failed: data.failedCount });
      if (data.completedAt && !completedAt) {
        setCompletedAt(data.completedAt);
      }
    } catch {
      /* best-effort */
    }
  }, [props.build.id, completedAt]);

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
    return () => { cancelled = true; clearInterval(interval); };
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

  const testById = useMemo(() => new Map(props.tests.map((t) => [t.id, t])), [props.tests]);
  const areaById = useMemo(() => new Map(props.areas.map((a) => [a.id, a])), [props.areas]);
  const changedAreaIds = useMemo(
    () => new Set(props.changeMap?.areas
      .filter((a) => a.sources.includes('code') || a.sources.includes('manual'))
      .map((a) => a.areaId) ?? []),
    [props.changeMap],
  );

  const visualByStepKey = useMemo(() => {
    const m = new Map<string, VisualDiffLite>();
    for (const d of visualDiffs) {
      const key = `${d.testId}::${d.stepLabel ?? ''}`;
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
        if (!test?.functionalAreaId || !filters.areaIds.has(test.functionalAreaId)) return false;
      }
      if (filters.issueFilter === 'with' && !step.githubIssueUrl) return false;
      if (filters.issueFilter === 'without' && step.githubIssueUrl) return false;
      if (filters.query.trim().length > 0) {
        const q = filters.query.trim().toLowerCase();
        const test = testById.get(step.testId);
        const haystack = `${test?.name ?? ''} ${step.stepLabel ?? ''}`.toLowerCase();
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
      if (!fbByStep.has(f.stepComparisonId)) fbByStep.set(f.stepComparisonId, []);
      fbByStep.get(f.stepComparisonId)!.push(f);
    }
    let n = 0;
    for (const step of filteredSteps) {
      const test = testById.get(step.testId);
      const isInChangedArea = !!(test?.functionalAreaId && changedAreaIds.has(test.functionalAreaId));
      const result = step.testResultId ? testResultById.get(step.testResultId) ?? null : null;
      const status = deriveCaseStatus({
        step,
        feedback: fbByStep.get(step.id) ?? [],
        isInChangedArea,
        testFailed: result?.status === 'failed',
      });
      if (status !== 'unknown') n++;
    }
    return n;
  }, [layerFeedback, filteredSteps, testById, changedAreaIds, testResultById]);

  const handleRefresh = () => {
    if (!props.repositoryId) return;
    startRefresh(async () => {
      const result = await runVerifyBuild(props.repositoryId!);
      if ('error' in result) {
        toast.error(result.error || 'Could not start build');
        return;
      }
      // If the smart path bailed (no diff vs base, GitHub unavailable, etc.)
      // we just ran every test instead — let the user know so they aren't
      // confused about why the build is wider than expected.
      if (result.fallback) {
        toast.message('Running all tests', { description: result.reason });
      }
      router.push(`/verify/${result.buildId}`);
      router.refresh();
    });
  };

  const decideAllForStep = (stepId: string, status: 'approved' | 'rejected' | 'snoozed') => {
    const step = stepComparisons.find((s) => s.id === stepId);
    if (!step) return;
    // Persist a decision for every evidence layer + every layer that already
    // has feedback in the DB. Without the second part, a stale `rejected`
    // row on a layer that wasn't in step.evidence would survive the override
    // and pin the case in regression after the next poll. Fallback to
    // `visual` when there's nothing else to write against (typical for
    // hard-failed tests with no diff evidence).
    const evidenceLayers = step.evidence.length > 0
      ? Array.from(new Set(step.evidence.map((e) => e.layer)))
      : [] as EvidenceLayer[];
    const existingLayers = layerFeedback
      .filter((f) => f.stepComparisonId === stepId)
      .map((f) => f.layer);
    const layerSet = new Set<EvidenceLayer>([...evidenceLayers, ...existingLayers]);
    if (layerSet.size === 0) layerSet.add('visual');
    const layers: EvidenceLayer[] = Array.from(layerSet);

    // 1) Optimistic local feedback so the card moves to the new column
    //    INSTANTLY — no waiting on round-trips.
    const fakeStatus = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'snoozed';
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
    // case action is meant to override per-layer decisions outright. The
    // next poll returns the new authoritative status from the server.
    setLayerFeedback((prev) => [
      ...prev.filter((f) => f.stepComparisonId !== stepId),
      ...optimisticRows,
    ]);

    // 2) Persist in parallel — was sequential per layer (N roundtrips), now 1
    //    wall-clock roundtrip total. The server is idempotent on this.
    startTransition(async () => {
      await Promise.all(
        layers.map((layer) =>
          decideLayer({ stepComparisonId: stepId, buildId: props.build.id, layer, status })
            .catch(() => null),
        ),
      );
      router.refresh();
    });
  };

  /** Per-evidence Expected/Needs fix click. Optimistically writes the layer
   *  feedback so the panel reflects the decision before the round-trip
   *  finishes; persists in the background. */
  const decideOneLayer = (
    stepId: string,
    layer: EvidenceLayer,
    status: 'approved' | 'rejected' | 'snoozed',
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
      ...prev.filter((f) => !(f.stepComparisonId === stepId && f.layer === layer)),
      optimistic,
    ]);

    startTransition(async () => {
      await decideLayer({ stepComparisonId: stepId, buildId: props.build.id, layer, status })
        .catch(() => null);
      router.refresh();
    });
  };

  const handleOpenCase = (stepId: string) => {
    // Single history entry that flips mode AND selects the step — back-button
    // returns straight to the board view.
    updateUrl({ mode: 'focus', step: stepId });
  };

  const handleDropCase = (stepId: string, target: CaseStatus) => {
    // Dropping on Unsorted = clear all feedback for the step so its derived
    // status falls back to verdict-based classification. The user's drop
    // always wins over any prior decision: stripping local rows + writing
    // snoozed on the layers (closest server-side "no-op") clears stale
    // approvals/rejections that would otherwise persist.
    if (target === 'unknown') {
      const layers = Array.from(new Set(
        layerFeedback.filter((f) => f.stepComparisonId === stepId).map((f) => f.layer),
      ));
      setLayerFeedback((prev) => prev.filter((f) => f.stepComparisonId !== stepId));
      // Use the 'pending' status to wipe any prior decision: deriveCaseStatus
      // ignores pending rows entirely, so the case falls back to its
      // verdict-based natural classification — typically `unknown` for
      // yellow-not-in-changed-area, `done` for green, etc.
      startTransition(async () => {
        await Promise.all(
          layers.map((layer) =>
            decideLayer({ stepComparisonId: stepId, buildId: props.build.id, layer, status: 'pending' }).catch(() => null),
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
    decideAllForStep(stepId, decision);
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
      router.push('/verify');
    });
    setBranchOpen(false);
  };

  const buildLabel = useMemo(() => {
    const parts: string[] = [];
    if (props.branch) parts.push(props.branch);
    if (props.build.completedAt) parts.push(new Date(props.build.completedAt).toLocaleDateString());
    parts.push(`${props.build.totalTests ?? 0} tests`);
    return parts.join(' · ');
  }, [props.branch, props.build]);

  const filterBadge = filterCount(filters);

  return (
    <div className="verify-page" style={{ display: 'flex', flexDirection: 'column', position: 'absolute', inset: 0, background: 'var(--c-soft-2)', minHeight: 0, overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      {/* Header — no secondary logo (sidebar already shows the brand). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', position: 'relative' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Verify
            {isRunning && (
              <span className="v-chip info" style={{ fontSize: 10 }}>
                <Loader2 size={10} className="anim-spin" style={{ animation: 'verify-spin 1s linear infinite' }} />
                running · {liveCounts.passed + liveCounts.failed} / {liveCounts.totalTests}
              </span>
            )}
          </div>
          <div className="label" style={{ marginTop: 2 }}>
            Build #{props.build.id.slice(0, 8)} · {buildLabel} · {mode === 'board' ? `${verifiedCount} / ${totalCases} verified` : `${totalCases} cases`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="v-tabs">
            <button
              className={`v-tab ${mode === 'board' ? 'active' : ''}`}
              onClick={() => setMode('board')}
            >
              Board
            </button>
            <button
              className={`v-tab ${mode === 'focus' ? 'active' : ''}`}
              onClick={() => setMode('focus')}
            >
              Focus
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <button className="v-btn" onClick={() => setFiltersOpen((v) => !v)}>
              <Filter size={13} />Filter
              {filterBadge > 0 && (
                <span className="v-chip info" style={{ fontSize: 9, padding: '0 5px' }}>{filterBadge}</span>
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
          <div style={{ position: 'relative' }}>
            <button className="v-btn" onClick={() => setBranchOpen((v) => !v)} disabled={!props.repositoryId}>
              <GitBranch size={13} />
              {props.branch ?? 'unknown'}
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
            <Play size={13} />{refreshing ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {mode === 'board' ? (
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
          onOpenCase={handleOpenCase}
          onDropCase={handleDropCase}
          onOpenIssuePicker={(stepId) => setIssuePickerStepId(stepId)}
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
          statusFilter={filters.statuses}
          selectedStepId={selectedStepId}
          onSelect={setSelectedStepId}
          onMarkDecision={decideAllForStep}
          onDecideLayer={decideOneLayer}
          onOpenIssuePicker={(stepId) => setIssuePickerStepId(stepId)}
          onRefresh={refreshFromServer}
        />
      )}

      {issuePickerStepId && (() => {
        const step = stepComparisons.find((s) => s.id === issuePickerStepId);
        const test = step ? testById.get(step.testId) ?? null : null;
        const title = step ? `[Verify] ${test?.name ?? 'case'} — ${step.stepLabel ?? 'step'}` : 'Verify case';
        return (
          <IssuePickerDialog
            key={issuePickerStepId}
            open
            onClose={() => setIssuePickerStepId(null)}
            stepComparisonId={issuePickerStepId}
            caseTitle={title}
            defaultTitle={title}
            defaultBody={step?.reviewerNote ?? ''}
            onLinked={refreshFromServer}
          />
        );
      })()}

      <style jsx global>{`
        @keyframes verify-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes verify-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

function filterCount(f: VerifyFilters): number {
  let n = 0;
  n += f.statuses.size;
  n += f.areaIds.size;
  if (f.issueFilter !== 'any') n += 1;
  if (f.query.trim().length > 0) n += 1;
  return n;
}

interface FilterPanelProps {
  filters: VerifyFilters;
  areas: AreaLite[];
  onChange: (f: VerifyFilters) => void;
  onClose: () => void;
}

function FilterPanel({ filters, areas, onChange, onClose }: FilterPanelProps) {
  const STATUSES: CaseStatus[] = ['unknown', 'regression', 'missed', 'done'];
  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };
  return (
    <>
      {/* outer backdrop catches off-clicks */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 50 }}
      />
      <div
        className="v-card"
        style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 320, padding: 14, zIndex: 51, display: 'flex', flexDirection: 'column', gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="label">Filter</div>
          <button className="v-btn ghost icon" onClick={onClose}><X size={13} /></button>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>Search</div>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="test name or step label"
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--c-white)', color: 'var(--fg-1)' }}
          />
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>Status</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => {
              const active = filters.statuses.has(s);
              return (
                <button
                  key={s}
                  className={`v-chip ${active ? s : ''}`}
                  style={{ cursor: 'pointer', textTransform: 'capitalize', opacity: active ? 1 : 0.55 }}
                  onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
                >
                  <span className="dot" />{s}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>Area</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 100, overflowY: 'auto' }}>
            {areas.length === 0 && <span className="label" style={{ fontSize: 9 }}>no areas</span>}
            {areas.map((a) => {
              const active = filters.areaIds.has(a.id);
              return (
                <button
                  key={a.id}
                  className={`v-chip ${active ? 'info' : ''}`}
                  style={{ cursor: 'pointer', opacity: active ? 1 : 0.55 }}
                  onClick={() => onChange({ ...filters, areaIds: toggle(filters.areaIds, a.id) })}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>Issue</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['any', 'with', 'without'] as const).map((opt) => (
              <button
                key={opt}
                className={`v-chip ${filters.issueFilter === opt ? 'info' : ''}`}
                style={{ cursor: 'pointer', opacity: filters.issueFilter === opt ? 1 : 0.55, textTransform: 'capitalize' }}
                onClick={() => onChange({ ...filters, issueFilter: opt })}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <button className="v-btn sm ghost" onClick={() => onChange(emptyFilters())} style={{ alignSelf: 'flex-end' }}>
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

function BranchPicker({ current, defaultBranch, branches, onSelect, onClose }: BranchPickerProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => !q || b.toLowerCase().includes(q)).slice(0, 50);
  }, [query, branches]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
      <div
        className="v-card"
        style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 280, padding: 8, zIndex: 51, display: 'flex', flexDirection: 'column', gap: 6 }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search branch…"
          style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--c-white)', color: 'var(--fg-1)' }}
        />
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((b) => {
            const active = b === current;
            return (
              <button
                key={b}
                onClick={() => onSelect(b)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 8px', borderRadius: 6, fontSize: 12,
                  background: active ? 'color-mix(in oklab, var(--c-teal) 12%, white)' : 'transparent',
                  color: active ? '#1F7B66' : 'var(--fg-1)',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer', border: '0',
                  textAlign: 'left',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</span>
                {b === defaultBranch && <span className="label" style={{ fontSize: 9 }}>default</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="label" style={{ padding: 8, fontSize: 9 }}>no matches</div>
          )}
        </div>
      </div>
    </>
  );
}
