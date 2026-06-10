'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { setReviewerNote } from '@/server/actions/verify-issues';
import {
  AlertOctagon,
  CircleDot,
  Loader2,
  Github,
  CheckCircle as CheckCircleIcon,
  AlertCircle,
} from 'lucide-react';
import type {
  EvidenceLayer,
  StepComparison,
  StepLayerFeedback,
  StepIssueState,
} from '@/lib/db/schema';
import { deriveCaseStatus } from '@/lib/verify/case-status';
import type { StepVerdict } from '@/lib/db/schema';
import {
  chipToneForLayer,
  defaultCheckModes,
  effectiveVerdict,
  mergeWithTestOverrides,
  type CheckLayer,
  type CheckMode,
  type CheckModeMap,
} from '@/lib/verify/check-modes';
import type { VisualDiffLite, TestResultLite } from './board-focus-client';

export type CaseStatus = 'regression' | 'done' | 'missed' | 'unknown';

/**
 * Execution-quality of a case — orthogonal to the reviewer-decision status
 * above. Speaks to "what happened on the runner" rather than "what should
 * the reviewer do".
 *  - errored: the test itself threw (assertion, timeout, runner failure)
 *  - changed: the test ran but diff signal exists (visual/step verdict)
 *  - flaky:   the test passed but was retried, or visual classified flaky
 *  - passed:  ran cleanly, no diff, no flake
 *
 * "Changed" does NOT mean broken — the diff may be expected. The Broken
 * column is reviewer-decided; this dimension is executor-observed.
 */
export type ExecutionKind = 'errored' | 'changed' | 'flaky' | 'passed';

function deriveExecutionKind(
  result: TestResultLite | null,
  verdict: StepVerdict,
  visual: VisualDiffLite | null,
): ExecutionKind {
  // Hard executor/test failures dominate — even if the diff scorer didn't
  // populate evidence, a runner-side exception is the strongest signal.
  if (result?.status === 'failed' || result?.status === 'setup_failed') return 'errored';

  // Flake takes priority over a green-but-retried surface: retryOf set or
  // visual classifier flagged flaky.
  if (result?.isFlaky || result?.retryOf || visual?.classification === 'flaky') return 'flaky';

  // Any non-green verdict OR a visual classified as `changed` is "changed".
  // `verdict` is the mode-aware effective verdict (not the stored mode-blind
  // one), so a high-signal layer the user set to `log`/`disable` doesn't flag
  // the case as Changed when no chip is amber/red.
  if (verdict !== 'green' || visual?.classification === 'changed') return 'changed';

  return 'passed';
}

const EXECUTION_KIND_LABEL: Record<ExecutionKind, string> = {
  errored: 'Errors',
  changed: 'Changed',
  flaky: 'Flaky',
  passed: 'Passed',
};

const EXECUTION_KIND_ACCENT: Record<ExecutionKind, string> = {
  errored: 'var(--c-red)',
  changed: 'var(--c-amber)',
  flaky: 'var(--c-blue)',
  passed: 'var(--c-teal)',
};

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface BoardViewProps {
  buildId: string;
  steps: StepComparison[];
  feedback: StepLayerFeedback[];
  testById: Map<string, TestLite>;
  areaById: Map<string, AreaLite>;
  changedAreaIds: Set<string>;
  visualByStepKey: Map<string, VisualDiffLite>;
  /** Test results keyed by id — used to detect which layers were *applied*
   *  (captured) for each case so the card can chip them even with 0 diff. */
  testResultById: Map<string, TestResultLite>;
  /** When non-empty, only these statuses are shown on the board. */
  statusFilter: Set<CaseStatus>;
  /** True while the build is in progress — shows a Running banner + in-flight cards. */
  isRunning: boolean;
  /** Tests currently executing on the runner (for in-flight skeleton cards). */
  runningTests: Array<{ testId: string; name: string }>;
  /** False until the first /verify-status fetch lands — columns show
   *  placeholder skeletons instead of "no cases" while we wait. */
  cardsLoaded: boolean;
  onOpenCase: (stepId: string) => void;
  onDropCase: (stepId: string, target: CaseStatus) => void;
  /** Column-level bulk action (Verify all / Report all). */
  onColumnAction: (column: CaseStatus, action: 'verify' | 'report') => void;
  /** Open the GH issue picker dialog for a specific case. */
  onOpenIssuePicker: (stepId: string) => void;
  /** Repo-level 3-way check modes governing the chip tone (enforce →
   *  regression, log → missed, disable → muted). Defaults are applied
   *  when omitted so the board still renders meaningfully before the
   *  first verify-status fetch lands. */
  checkModes?: CheckModeMap;
  /** Sparse per-test overrides — any layer a test opted out of takes
   *  precedence over the repo-level mode for its case card. */
  checkModesByTestId?: Record<string, Partial<CheckModeMap>>;
}

// Columns flow left → right: needs decision → expected-but-missing → broken → resolved.
// NOTE: status type values stay in code (`unknown`, `regression`, `missed`, `done`)
// to avoid a wide rename — only the user-facing labels are reworded.
const COLUMN_ORDER: { status: CaseStatus; label: string; accent: string; dropLabel: string }[] = [
  { status: 'unknown',    label: 'Unsorted', dropLabel: 'unsorted',  accent: 'var(--fg-3)' },
  { status: 'missed',     label: 'Missed',   dropLabel: 'missed',    accent: 'var(--c-amber)' },
  { status: 'regression', label: 'Broken',   dropLabel: 'broken',    accent: 'var(--c-red)' },
  { status: 'done',       label: 'Verified', dropLabel: 'verified',  accent: 'var(--c-teal)' },
];

interface CaseCardData {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  kind: ExecutionKind;
  feedback: StepLayerFeedback[];
  visual: VisualDiffLite | null;
  result: TestResultLite | null;
}

export function BoardView(props: BoardViewProps) {
  const cases = useMemo<CaseCardData[]>(() => {
    const fbByStep = new Map<string, StepLayerFeedback[]>();
    for (const f of props.feedback) {
      if (!fbByStep.has(f.stepComparisonId)) fbByStep.set(f.stepComparisonId, []);
      fbByStep.get(f.stepComparisonId)!.push(f);
    }
    const repoModes = props.checkModes ?? defaultCheckModes();
    return props.steps.map((step) => {
      const stepFb = fbByStep.get(step.id) ?? [];
      const test = props.testById.get(step.testId) ?? null;
      const isInChangedArea = !!(test?.functionalAreaId && props.changedAreaIds.has(test.functionalAreaId));
      const result = step.testResultId ? props.testResultById.get(step.testResultId) ?? null : null;
      // Mode-aware effective verdict — the stored step.verdict is mode-blind,
      // so reduce evidence through the repo + per-test modes the chips use.
      const modes = mergeWithTestOverrides(
        repoModes,
        test?.id ? props.checkModesByTestId?.[test.id] : null,
      );
      const verdict = effectiveVerdict(step.evidence, modes);
      const status = deriveCaseStatus({
        step,
        feedback: stepFb,
        isInChangedArea,
        testFailed: result?.status === 'failed' || result?.status === 'setup_failed',
        verdictOverride: verdict,
      });
      const area = test?.functionalAreaId ? props.areaById.get(test.functionalAreaId) ?? null : null;
      const visual = props.visualByStepKey.get(`${step.testId}::${step.stepLabel ?? ''}`) ?? null;
      const kind = deriveExecutionKind(result, verdict, visual);
      return { step, test, area, status, kind, feedback: stepFb, visual, result };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds, props.visualByStepKey, props.testResultById, props.checkModes, props.checkModesByTestId]);

  // Local execution-quality filter — orthogonal to the reviewer-status
  // filter in the header. Click a token to narrow the board to just those
  // cases; second click clears it.
  const [kindFilter, setKindFilter] = useState<Set<ExecutionKind>>(new Set());
  const toggleKind = (k: ExecutionKind) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // Always counted off the *unfiltered* set so toggling tokens doesn't make
  // the other counts disappear.
  const kindCounts = useMemo(() => {
    const c: Record<ExecutionKind, number> = { errored: 0, changed: 0, flaky: 0, passed: 0 };
    for (const x of cases) c[x.kind]++;
    return c;
  }, [cases]);

  const grouped = useMemo(() => {
    const map: Record<CaseStatus, CaseCardData[]> = { regression: [], missed: [], unknown: [], done: [] };
    for (const c of cases) {
      if (props.statusFilter.size > 0 && !props.statusFilter.has(c.status)) continue;
      if (kindFilter.size > 0 && !kindFilter.has(c.kind)) continue;
      map[c.status].push(c);
    }
    return map;
  }, [cases, props.statusFilter, kindFilter]);

  // Per-area total case counts (independent of which column they sit in) —
  // used as the denominator for the Verified column's "y/x verified" summary.
  const areaTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) {
      const key = c.area?.id ?? '__unscoped__';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [cases]);

  // Per-area "settled" count — cases in the area whose derived status is
  // anything but `unknown`. Used as the numerator alongside areaTotals so
  // both sides of the "y/x verified" ratio are in the same unit (cases in
  // the area), not "cards visible in the Verified column" vs "total cases".
  const areaSettled = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) {
      if (c.status === 'unknown') continue;
      const key = c.area?.id ?? '__unscoped__';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [cases]);

  // Progress strip counts — both numerator and denominator computed off the
  // same unfiltered case set so toggling kind/status filters can't make the
  // ratio look like it's mixing units. ("22/52" used to read as
  // cards-in-columns / total-steps; both sides now count cases.)
  const total = cases.length;
  const statusTotals = useMemo(() => {
    const m: Record<CaseStatus, number> = { regression: 0, missed: 0, unknown: 0, done: 0 };
    for (const c of cases) m[c.status]++;
    return m;
  }, [cases]);
  const verified = statusTotals.done + statusTotals.regression + statusTotals.missed;
  const wPct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragCase = activeDragId ? cases.find((c) => c.step.id === activeDragId) ?? null : null;
  const sourceStatus = activeDragCase?.status ?? null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const stepId = String(event.active.id);
    const target = event.over?.id ? String(event.over.id) : null;
    if (!target) return;
    const validTargets: CaseStatus[] = ['regression', 'missed', 'unknown', 'done'];
    if (!validTargets.includes(target as CaseStatus)) return;
    // If the source column is the same as the drop target, no-op.
    const cur = cases.find((c) => c.step.id === stepId);
    if (!cur || cur.status === target) return;
    props.onDropCase(stepId, target as CaseStatus);
  };
  const handleDragCancel = () => setActiveDragId(null);

  // Stable `id` on DndContext prevents dnd-kit's internal aria-describedby
  // counter from drifting between server and client renders (would otherwise
  // hydrate as `DndDescribedBy-3` server / `DndDescribedBy-0` client).
  return (
    <DndContext id="verify-board" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* progress strip */}
        <div style={{ padding: '12px 20px', background: 'var(--c-white)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <div className="label">Verification progress</div>
            <div style={{ flex: 1, height: 6, background: 'var(--c-soft-2)', borderRadius: 99, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                <div style={{ width: `${wPct(statusTotals.done)}%`, background: 'var(--c-teal)' }} />
                <div style={{ width: `${wPct(statusTotals.missed)}%`, background: 'var(--c-amber)' }} />
                <div style={{ width: `${wPct(statusTotals.regression)}%`, background: 'var(--c-red)' }} />
                <div style={{ width: `${wPct(statusTotals.unknown)}%`, background: 'var(--fg-3)' }} />
              </div>
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              {verified} / {total} verified
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center', flexWrap: 'wrap' }}>
            <KindToken
              label="Cases"
              count={total}
              accent="var(--fg-3)"
              active={kindFilter.size === 0}
              onClick={() => setKindFilter(new Set())}
            />
            {(['errored', 'changed', 'flaky', 'passed'] as ExecutionKind[]).map((k) => (
              <KindToken
                key={k}
                label={EXECUTION_KIND_LABEL[k]}
                count={kindCounts[k]}
                accent={EXECUTION_KIND_ACCENT[k]}
                active={kindFilter.has(k)}
                onClick={() => toggleKind(k)}
                dim={kindFilter.size > 0 && !kindFilter.has(k)}
              />
            ))}
            <span style={{ flex: 1 }} />
            <span className="label">Group: Status · Area</span>
          </div>
        </div>

        {/* Running banner — only when a build is in flight. */}
        {props.isRunning && (
          <div style={{ padding: '8px 20px', background: 'color-mix(in oklab, var(--c-blue) 6%, var(--c-white))', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <Loader2 size={13} style={{ animation: 'verify-spin 1s linear infinite' }} />
            <span style={{ fontWeight: 500, color: 'var(--fg-1)' }}>Build running</span>
            <span className="label">cards land in their column as each test finishes</span>
            <span style={{ flex: 1 }} />
            {props.runningTests.length > 0 && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
                {props.runningTests.length} in flight
              </span>
            )}
          </div>
        )}

        {/* board */}
        <div style={{ flex: 1, padding: 16, display: 'flex', gap: 12, minHeight: 0 }}>
          {COLUMN_ORDER.map((col) => (
            <KCol
              key={col.status}
              label={col.label}
              dropLabel={col.dropLabel}
              accent={col.accent}
              status={col.status}
              cases={grouped[col.status]}
              areaTotals={areaTotals}
              areaSettled={areaSettled}
              onOpenCase={props.onOpenCase}
              onOpenIssuePicker={props.onOpenIssuePicker}
              onColumnAction={props.onColumnAction}
              cardsLoaded={props.cardsLoaded}
              // Show in-flight skeletons in the Unsorted column while running.
              runningTests={col.status === 'unknown' && props.isRunning ? props.runningTests : []}
              testById={props.testById}
              isDragSource={sourceStatus === col.status}
              isDragValid={sourceStatus !== null && sourceStatus !== col.status}
              checkModes={props.checkModes ?? defaultCheckModes()}
              checkModesByTestId={props.checkModesByTestId ?? {}}
            />
          ))}
        </div>

        {/* dev cycle footer (computed from real counts) */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Github size={14} />
          <span className="label">Dev cycle</span>
          {grouped.regression.length > 0 && countWithoutIssue(grouped.regression) > 0 && (
            <span className="v-chip regression">
              <CircleDot size={11} />
              {countWithoutIssue(grouped.regression)} broken case{countWithoutIssue(grouped.regression) === 1 ? '' : 's'} need an issue
            </span>
          )}
          {grouped.done.length > 0 && countWithLinkedIssue(grouped.done) > 0 && (
            <span className="v-chip done">
              <CheckCircleIcon size={11} />
              {countWithLinkedIssue(grouped.done)} verified case{countWithLinkedIssue(grouped.done) === 1 ? '' : 's'} ready to close
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span className="label" style={{ fontSize: 9 }}>{verified === total && total > 0 ? 'all verified' : '—'}</span>
        </div>
      </div>
      {/* Portal-rendered drag preview — escapes column overflow boundaries. */}
      <DragOverlay dropAnimation={null}>
        {activeDragCase ? (
          <div style={{ width: 280, opacity: 0.95 }}>
            <CaseCard
              data={activeDragCase}
              colStatus={activeDragCase.status}
              onOpen={() => {}}
              dragging
              checkModes={props.checkModes ?? defaultCheckModes()}
              checkModesByTestId={props.checkModesByTestId ?? {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function countWithoutIssue(cases: CaseCardData[]): number {
  return cases.filter((c) => !c.step.githubIssueUrl).length;
}
function countWithLinkedIssue(cases: CaseCardData[]): number {
  return cases.filter((c) => c.step.githubIssueUrl && c.step.githubIssueState !== 'closed').length;
}

interface KindTokenProps {
  label: string;
  count: number;
  accent: string;
  active: boolean;
  dim?: boolean;
  onClick: () => void;
}

// Execution-quality filter token — replaces the prior reviewer-decision
// chips on the progress strip. Behaves like the build-page filter pills:
// clickable, multi-select (toggle), and the count is always the unfiltered
// total so toggling doesn't make the other categories vanish.
function KindToken({ label, count, accent, active, dim, onClick }: KindTokenProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: 99,
        fontSize: 11,
        cursor: 'pointer',
        border: active
          ? `1px solid color-mix(in oklab, ${accent} 60%, var(--border))`
          : '1px solid var(--border)',
        background: active
          ? `color-mix(in oklab, ${accent} 14%, var(--c-white))`
          : 'var(--c-white)',
        color: 'var(--fg-1)',
        opacity: dim ? 0.55 : 1,
        transition: 'background 120ms ease, opacity 120ms ease, border-color 120ms ease',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
      {label}
      <span className="mono" style={{ color: 'var(--fg-2)' }}>{count}</span>
    </button>
  );
}

interface KColProps {
  label: string;
  dropLabel: string;
  accent: string;
  status: CaseStatus;
  cases: CaseCardData[];
  /** Total cases per area across the entire board — denominator for the
   *  Verified column's "y/x verified" summary. */
  areaTotals: Map<string, number>;
  /** Per-area count of cases whose derived status is not `unknown`. Used as
   *  the numerator for the Verified column's per-area "y/x verified" pill so
   *  both sides count cases in the same scope (area), not cards visible in
   *  the Done column vs total area cases. */
  areaSettled: Map<string, number>;
  onOpenCase: (stepId: string) => void;
  onOpenIssuePicker: (stepId: string) => void;
  /** Column-level bulk action — Verify all on Unsorted/Broken/Missed,
   *  Report all on Broken/Missed. Verified column has none (already done). */
  onColumnAction: (column: CaseStatus, action: 'verify' | 'report') => void;
  /** False until the first /verify-status fetch lands. */
  cardsLoaded: boolean;
  /** Live in-flight tests; rendered as non-draggable skeleton cards. */
  runningTests: Array<{ testId: string; name: string }>;
  testById: Map<string, TestLite>;
  /** True while a card is being dragged FROM this column. */
  isDragSource: boolean;
  /** True while a card is being dragged AND this column is a valid drop target. */
  isDragValid: boolean;
  /** Repo-level + per-test 3-way modes governing the chip tone on each card. */
  checkModes: CheckModeMap;
  checkModesByTestId: Record<string, Partial<CheckModeMap>>;
}

function KCol({ label, dropLabel, accent, status, cases, areaTotals, areaSettled, onOpenCase, onOpenIssuePicker, onColumnAction, cardsLoaded, runningTests, testById, isDragSource, isDragValid, checkModes, checkModesByTestId }: KColProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const visible = cases.slice(0, 30);
  const showDropAffordance = isDragValid;
  const isHovered = isOver && isDragValid;
  const sideColor = isHovered
    ? 'color-mix(in oklab, var(--c-teal) 55%, transparent)'
    : showDropAffordance
      ? 'color-mix(in oklab, var(--c-teal) 25%, transparent)'
      : 'var(--border)';
  const totalCount = cases.length + runningTests.length;
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative',
        background: isHovered
          ? 'color-mix(in oklab, var(--c-teal) 8%, var(--c-soft))'
          : isDragSource
            ? 'color-mix(in oklab, var(--fg-3) 6%, var(--c-soft))'
            : 'var(--c-soft)',
        borderTop: `3px solid ${accent}`,
        borderRight: `1px solid ${sideColor}`,
        borderBottom: `1px solid ${sideColor}`,
        borderLeft: `1px solid ${sideColor}`,
        borderRadius: 8,
        boxShadow: isHovered ? 'inset 0 0 0 2px color-mix(in oklab, var(--c-teal) 35%, transparent)' : undefined,
        transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
        opacity: isDragSource ? 0.7 : 1,
      }}
    >
      {/* Drop affordance — only while dragging from another column. */}
      {showDropAffordance && (
        <div
          style={{
            position: 'absolute',
            top: 48, left: 8, right: 8, bottom: 8,
            border: `2px dashed ${isHovered ? 'color-mix(in oklab, var(--c-teal) 50%, transparent)' : 'color-mix(in oklab, var(--c-teal) 25%, transparent)'}`,
            borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 1,
            color: isHovered ? '#1F7B66' : 'var(--fg-3)',
            fontSize: 12, fontWeight: 600,
            background: isHovered ? 'color-mix(in oklab, var(--c-teal) 4%, white)' : 'transparent',
            transition: 'all 120ms ease',
          }}
        >
          Drop to mark <span style={{ marginLeft: 4 }}>{dropLabel}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <span className="label" style={{ fontSize: 10 }}>{totalCount}</span>
        </div>
        <ColumnActions
          status={status}
          caseCount={cases.length}
          onAction={onColumnAction}
        />
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
        {/* In-flight running tests (only in Unsorted column while running). */}
        {runningTests.map((rt) => {
          const test = testById.get(rt.testId);
          return (
            <RunningCard
              key={`run-${rt.testId}`}
              testName={test?.name ?? rt.name ?? rt.testId.slice(0, 8)}
            />
          );
        })}
        {visible.length === 0 && runningTests.length === 0 && (
          !cardsLoaded
            ? <ColumnSkeleton />
            : <div className="label" style={{ textAlign: 'center', padding: '24px 0' }}>—</div>
        )}
        {/* Verified column: collapse all-clean areas under a single details row.
            Areas with any flagged case (linked issue, reviewer note in future)
            still expand inline. Other columns just render flat. */}
        {status === 'done'
          ? renderVerifiedGrouped(visible, areaTotals, areaSettled, onOpenCase, onOpenIssuePicker, checkModes, checkModesByTestId)
          : visible.map((c) => (
              <DraggableCaseCard
                key={c.step.id}
                data={c}
                onOpen={() => onOpenCase(c.step.id)}
                onOpenIssuePicker={() => onOpenIssuePicker(c.step.id)}
                colStatus={status}
                checkModes={checkModes}
                checkModesByTestId={checkModesByTestId}
              />
            ))}
        {cases.length > visible.length && (
          <div className="label" style={{ textAlign: 'center', padding: '8px 0' }}>+{cases.length - visible.length} more</div>
        )}
      </div>
    </div>
  );
}

interface ColumnActionsProps {
  status: CaseStatus;
  caseCount: number;
  onAction: (column: CaseStatus, action: 'verify' | 'report') => void;
}

// Per-column bulk-action buttons. The Verified column has none (those are
// already settled). Verify all: approve every case in the column. Report
// all (Broken/Missed only): file the typed ticket — regression for Broken,
// improvement for Missed.
function ColumnActions({ status, caseCount, onAction }: ColumnActionsProps) {
  if (status === 'done') return null;
  if (caseCount === 0) return null;
  const showReport = status === 'regression' || status === 'missed';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        className="v-btn sm success"
        onClick={() => onAction(status, 'verify')}
        title={`Mark all ${caseCount} case${caseCount === 1 ? '' : 's'} in this column as Verified`}
      >
        <CheckCircleIcon size={11} />
        Verify all
      </button>
      {showReport && (
        <button
          type="button"
          className="v-btn sm danger"
          onClick={() => onAction(status, 'report')}
          title={status === 'regression'
            ? `File regression tickets for all ${caseCount} broken case${caseCount === 1 ? '' : 's'}`
            : `File improvement tickets for all ${caseCount} missed case${caseCount === 1 ? '' : 's'}`}
        >
          <AlertCircle size={11} />
          Report all
        </button>
      )}
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="v-card"
          style={{
            padding: 10,
            height: 132,
            background: 'linear-gradient(90deg, var(--c-soft) 0%, var(--c-soft-2) 50%, var(--c-soft) 100%)',
            backgroundSize: '200% 100%',
            animation: 'verify-shimmer 1.4s linear infinite',
            opacity: 1 - i * 0.25,
          }}
        />
      ))}
    </div>
  );
}

/** Group Verified-column cards by area; areas where every case is "clean"
 *  (no linked issue / no rejection feedback) collapse to a single summary row.
 *  Other areas render flat so anything that still needs eyes is visible.
 *  `areaTotals` carries the count of *all* tests in each area across the board
 *  (denominator); `areaSettled` carries the count of cases in the area whose
 *  derived status is anything but `unknown` (numerator). Both are measured in
 *  the same unit — cases per area — so the displayed ratio stops mixing
 *  "cards in this column" with "steps across the build". */
function renderVerifiedGrouped(
  cases: CaseCardData[],
  areaTotals: Map<string, number>,
  areaSettled: Map<string, number>,
  onOpenCase: (id: string) => void,
  onOpenIssuePicker: (id: string) => void,
  checkModes: CheckModeMap,
  checkModesByTestId: Record<string, Partial<CheckModeMap>>,
): React.ReactNode {
  const byArea = new Map<string, { area: CaseCardData['area']; rows: CaseCardData[] }>();
  for (const c of cases) {
    const key = c.area?.id ?? '__unscoped__';
    if (!byArea.has(key)) byArea.set(key, { area: c.area, rows: [] });
    byArea.get(key)!.rows.push(c);
  }

  const isCleanCase = (c: CaseCardData) =>
    !c.step.githubIssueUrl &&
    !c.feedback.some((f) => f.status === 'rejected');

  const groups = Array.from(byArea.values());
  return groups.map((g, i) => {
    const allClean = g.rows.every(isCleanCase);
    const areaKey = g.area?.id ?? `unscoped-${i}`;
    if (allClean && g.rows.length > 1) {
      const areaId = g.area?.id ?? '__unscoped__';
      const totalInArea = areaTotals.get(areaId) ?? g.rows.length;
      // Numerator: cases in this area that are settled (anywhere on the
      // board), not just the ones sitting in the Done column. Keeps the
      // ratio meaningful when some cases in the same area are still in
      // Broken/Missed/Unsorted.
      const verifiedCount = areaSettled.get(areaId) ?? g.rows.length;
      const fullyVerified = verifiedCount === totalInArea;
      return (
        <details key={areaKey} className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
          <summary
            style={{
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              listStyle: 'none',
              fontSize: 12,
            }}
          >
            {/* Only show the green check when *all* tests in the area are verified. */}
            {fullyVerified && <CheckCircleIcon size={12} style={{ color: 'var(--c-teal)' }} />}
            <span style={{ fontWeight: 600 }}>{g.area?.name ?? 'Unscoped'}</span>
            <span className="label" style={{ fontSize: 9, marginLeft: 'auto' }}>
              {verifiedCount}/{totalInArea} verified
            </span>
          </summary>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)' }}>
            {g.rows.map((c) => (
              <DraggableCaseCard
                key={c.step.id}
                data={c}
                onOpen={() => onOpenCase(c.step.id)}
                onOpenIssuePicker={() => onOpenIssuePicker(c.step.id)}
                colStatus="done"
                checkModes={checkModes}
                checkModesByTestId={checkModesByTestId}
              />
            ))}
          </div>
        </details>
      );
    }
    // Mixed area or single case — render flat.
    return g.rows.map((c) => (
      <DraggableCaseCard
        key={c.step.id}
        data={c}
        onOpen={() => onOpenCase(c.step.id)}
        onOpenIssuePicker={() => onOpenIssuePicker(c.step.id)}
        colStatus="done"
        checkModes={checkModes}
        checkModesByTestId={checkModesByTestId}
      />
    ));
  });
}

function RunningCard({ testName }: { testName: string }) {
  return (
    <div
      className="v-card"
      style={{ padding: 10, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', gap: 6 }}
      aria-label={`${testName} is running`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Loader2 size={12} style={{ animation: 'verify-spin 1s linear infinite' }} />
        <span className="label" style={{ fontSize: 9 }}>running</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-1)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {testName}
      </div>
      <div
        style={{
          height: 56,
          borderRadius: 6,
          background: 'linear-gradient(90deg, var(--c-soft) 0%, var(--c-soft-2) 50%, var(--c-soft) 100%)',
          backgroundSize: '200% 100%',
          animation: 'verify-shimmer 1.4s linear infinite',
        }}
      />
    </div>
  );
}

/** Inline textarea on Missed cards for reviewer's "what should have changed".
 *  Debounced save on blur; the saved note prepends any GH issue created from
 *  this case so the human framing leads the report.
 */
function ReviewerNoteEditor({ stepId, initial }: { stepId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flush = (v: string) => {
    if (v === lastSaved.current) return;
    setSaving(true);
    setReviewerNote(stepId, v).then((res) => {
      if (res.ok) lastSaved.current = v;
      setSaving(false);
    }).catch(() => setSaving(false));
  };

  const handleChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 700);
  };

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={(e) => flush(e.target.value)}
        placeholder="What was supposed to change here?"
        rows={2}
        style={{
          width: '100%',
          fontSize: 11,
          fontFamily: 'var(--font-sans)',
          padding: '6px 8px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--c-white)',
          color: 'var(--fg-1)',
          resize: 'vertical',
          minHeight: 38,
        }}
      />
      {saving && (
        <div className="label" style={{ fontSize: 9, marginTop: 2, color: 'var(--fg-3)' }}>
          saving…
        </div>
      )}
    </div>
  );
}

interface DraggableProps {
  data: CaseCardData;
  colStatus: CaseStatus;
  onOpen: () => void;
  onOpenIssuePicker: () => void;
  checkModes: CheckModeMap;
  checkModesByTestId: Record<string, Partial<CheckModeMap>>;
}

function DraggableCaseCard({ data, colStatus, onOpen, onOpenIssuePicker, checkModes, checkModesByTestId }: DraggableProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: data.step.id });
  // While dragging, the source slot fades out — DragOverlay portals the
  // visual preview above all columns so it never gets clipped.
  // Default browser cursor; dnd-kit's `attributes` set role="button"/tabIndex
  // which some user-agent stylesheets render with an unfamiliar caret —
  // override back to the arrow so the card behaves like a normal element.
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.25 : 1,
    cursor: isDragging ? 'grabbing' : 'default',
    // Prevent the flex parent (KCol's scrollable list) from shrinking cards
    // when the column has more content than fits — without this, dense
    // columns squash thumbnails into a few px each.
    flexShrink: 0,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <CaseCard
        data={data}
        colStatus={colStatus}
        onOpen={onOpen}
        onOpenIssuePicker={onOpenIssuePicker}
        dragging={false}
        checkModes={checkModes}
        checkModesByTestId={checkModesByTestId}
      />
    </div>
  );
}

interface CardProps {
  data: CaseCardData;
  colStatus: CaseStatus;
  onOpen: () => void;
  onOpenIssuePicker?: () => void;
  dragging?: boolean;
  checkModes: CheckModeMap;
  checkModesByTestId: Record<string, Partial<CheckModeMap>>;
}

function CaseCard({ data, colStatus, onOpen, onOpenIssuePicker, dragging, checkModes, checkModesByTestId }: CardProps) {
  const layerSummaries = useMemo(
    () => summarizeLayersForCard(data.step, data.result, data.visual, checkModes, checkModesByTestId[data.test?.id ?? ''] ?? null),
    [data.step, data.result, data.visual, checkModes, checkModesByTestId, data.test?.id],
  );
  // Thin left-border colored by execution kind — "this ran red" (errored)
  // vs "this changed but may be intentional" (changed) at a glance, without
  // tying the surface to the reviewer-decision column it's sitting in.
  // Passed/flaky cards reserve the same 3px stripe but render it transparent
  // (passed = no signal; flaky's hint surfaces via the layer chips instead)
  // so content x-position stays identical across all cards and non-accent
  // cards keep the same visible left padding.
  const accentColor = data.kind === 'errored'
    ? EXECUTION_KIND_ACCENT.errored
    : data.kind === 'changed'
      ? EXECUTION_KIND_ACCENT.changed
      : 'transparent';
  return (
    <div
      className="v-card"
      style={{
        padding: 10,
        userSelect: 'none',
        boxShadow: dragging ? '0 8px 24px rgba(31,42,51,0.18)' : undefined,
        borderLeft: `3px solid ${accentColor}`,
        // Compensate left padding for the 3px stripe so content lands at the
        // same x position on every card, accented or not.
        paddingLeft: 7,
      }}
      onClick={(e) => {
        if (dragging) return;
        // Prevent click during drag
        if ((e.target as HTMLElement).closest('button')) return;
        onOpen();
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span className="label" style={{ fontSize: 9 }}>{data.area?.name ?? 'Unscoped'}</span>
        <span style={{ flex: 1 }} />
        <ErrorChip result={data.result} />
        <IssueChipReal step={data.step} onOpenPicker={onOpenIssuePicker} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8, color: 'var(--fg-1)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {data.test?.name ?? 'Unknown test'}
        {data.step.stepLabel && <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}> · {data.step.stepLabel}</span>}
      </div>
      <CardThumbnail visual={data.visual} />
      {layerSummaries.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {layerSummaries.map((s) => (
            <span
              key={s.layer}
              className={`v-chip ${s.tone}`}
              style={{ fontSize: 9, padding: '1px 6px' }}
              title={`${s.layer}: ${s.summary}`}
            >
              {s.layer.toUpperCase()}{s.delta ? ` · ${s.delta}` : ''}
            </span>
          ))}
        </div>
      )}
      {colStatus === 'missed' && (
        <ReviewerNoteEditor
          stepId={data.step.id}
          initial={data.step.reviewerNote ?? ''}
        />
      )}
    </div>
  );
}

function CardThumbnail({ visual }: { visual: VisualDiffLite | null }) {
  // Prefer the diff image (highlighted regions); fall back to current; then baseline.
  const src = visual?.diffImagePath ?? visual?.currentImagePath ?? visual?.baselineImagePath ?? null;
  if (!src) return null;
  return (
    <div
      style={{
        // Screen-ratio (16:9) thumbnail keeps screenshots readable as
        // miniature pages instead of cropped strips.
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--c-soft-2)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'white' }}
      />
    </div>
  );
}

interface LayerCardSummary {
  layer: string;
  delta: string;
  summary: string;
  /** Maps to the verify-design chip tone classes. */
  tone: 'regression' | 'missed' | 'done' | 'unknown';
}

const ALL_LAYERS: ReadonlyArray<EvidenceLayer> = [
  'visual', 'dom', 'network', 'console', 'a11y', 'design', 'perf', 'url', 'variable', 'api',
];

/** EvidenceLayer subset that maps to a `*Mode` column in `playwright_settings`.
 *  `variable` doesn't have a configurable mode today — it always renders by
 *  the raw signal. */
function modeForLayer(
  layer: EvidenceLayer,
  modes: CheckModeMap,
  perTest: Partial<CheckModeMap> | null,
): CheckMode | null {
  if (layer === 'variable') return null;
  const key = layer as CheckLayer;
  return perTest?.[key] ?? modes[key] ?? null;
}

/** Per-layer summary chip data for a board card.
 *
 *  Includes BOTH evidence-bearing layers AND layers that were captured but
 *  matched baseline (no evidence row) — those render as green "match" chips
 *  so reviewers can see what was actually verified, not just what failed.
 *
 *  Chip tone honors the per-check 3-way mode (enforce / log / disable). A
 *  high-signal evidence on a `log` layer still renders as amber `missed`
 *  rather than red `regression`; a `disable` layer drops out entirely so
 *  the card doesn't surface a check the user opted out of. */
function summarizeLayersForCard(
  step: StepComparison,
  result: TestResultLite | null,
  visual: VisualDiffLite | null,
  checkModes: CheckModeMap,
  perTestModes: Partial<CheckModeMap> | null,
): LayerCardSummary[] {
  const evidenceByLayer = new Map<EvidenceLayer, StepComparison['evidence'][number]>();
  for (const e of step.evidence) {
    if (!evidenceByLayer.has(e.layer)) evidenceByLayer.set(e.layer, e);
  }

  const out: LayerCardSummary[] = [];
  for (const layer of ALL_LAYERS) {
    const ev = evidenceByLayer.get(layer);
    const captured = wasLayerCaptured(layer, result, visual);
    if (!ev && !captured) continue;

    const mode = modeForLayer(layer, checkModes, perTestModes);
    // A `disable` layer has been opted out — hide the chip entirely so the
    // card matches the focus toolbar's "absent" treatment instead of
    // claiming a verified-clean state the user didn't sign up for.
    if (mode === 'disable') continue;

    if (ev) {
      out.push({
        layer,
        delta: deltaForLayer(step, layer),
        summary: ev.summary,
        tone: mode != null
          ? chipToneForLayer(mode, ev.signal)
          // `variable` (no mode) keeps the legacy signal-only mapping.
          : ev.signal === 'high' ? 'regression' : ev.signal === 'medium' ? 'missed' : 'done',
      });
    } else {
      // Layer was captured + scored, no diff → "match" chip so the reviewer
      // can confirm at a glance the layer was actually verified.
      out.push({
        layer,
        delta: matchLabelForLayer(layer, visual),
        summary: 'no diff',
        tone: 'done',
      });
    }
  }
  return out;
}

function wasLayerCaptured(layer: EvidenceLayer, result: TestResultLite | null, visual: VisualDiffLite | null): boolean {
  switch (layer) {
    case 'visual': return !!(visual?.currentImagePath || visual?.baselineImagePath);
    case 'dom': return !!result?.domSnapshot;
    case 'network': return result?.networkRequests != null;
    case 'console': return result?.consoleErrors != null;
    case 'a11y': return result?.a11yViolations != null || result?.a11yPassesCount != null;
    case 'design': return result?.designSystemViolations != null || result?.designSystemRulesChecked != null;
    case 'perf': return result?.webVitals != null;
    case 'url': return result?.urlTrajectory != null;
    case 'variable': return result?.extractedVariables != null || result?.assignedVariables != null;
    case 'api': return result?.apiResult != null || result?.loadResult != null;
  }
}

function matchLabelForLayer(layer: EvidenceLayer, visual: VisualDiffLite | null): string {
  if (layer === 'visual') {
    // 0 px / 0% → "100% match" reads better than "0% diff".
    if (visual?.percentageDifference != null && parseFloat(visual.percentageDifference) === 0) return '100% match';
    if (visual?.pixelDifference === 0) return '100% match';
    return 'match';
  }
  return 'match';
}

function deltaForLayer(step: StepComparison, layer: string): string {
  const layers = step.layers;
  switch (layer) {
    case 'visual': {
      const v = layers?.visual;
      if (!v) return '';
      return v.percentageDifference != null ? `${v.percentageDifference}%` : `${v.pixelDifference} px`;
    }
    case 'dom': {
      const d = layers?.dom;
      if (!d) return 'Δ';
      const parts: string[] = [];
      if (d.added.length) parts.push(`+${d.added.length}`);
      if (d.removed.length) parts.push(`−${d.removed.length}`);
      if (d.changed.length) parts.push(`~${d.changed.length}`);
      return parts.join(' ') || 'Δ';
    }
    case 'network': {
      const n = layers?.network;
      if (!n) return '';
      // Endpoint counts are the new shape; raw added/removed are the legacy
      // fallback for rows persisted before the endpoint-count field landed.
      const added = n.addedEndpoints ?? n.added;
      const removed = n.removedEndpoints ?? n.removed;
      const changed = n.changedEndpoints ?? n.changed;
      const parts: string[] = [];
      if (added) parts.push(`+${added}`);
      if (removed) parts.push(`−${removed}`);
      if (n.newErrorCount) parts.push(`${n.newErrorCount} err`);
      return parts.join(' ') || `${changed} chg`;
    }
    case 'console': {
      const c = layers?.consoleDiff;
      if (!c) return '';
      return c.newFingerprints.length > 0 ? `${c.newFingerprints.length} new` : '';
    }
    case 'a11y': {
      const a = layers?.a11y;
      if (!a) return '';
      return a.newViolations.length > 0 ? `+${a.newViolations.length}` : `−${a.disappeared.length}`;
    }
    case 'design': {
      const d = layers?.designSystem;
      if (!d) return '';
      return d.newViolations.length > 0 ? `+${d.newViolations.length}` : `−${d.disappeared.length}`;
    }
    case 'perf': {
      const p = layers?.perf;
      if (!p || p.deltas.length === 0) return '';
      // Pick the highest-impact delta (over budget first, then largest drift).
      const worst = [...p.deltas].sort((a, b) => {
        if (a.budgetBreached !== b.budgetBreached) return a.budgetBreached ? -1 : 1;
        return Math.abs(b.delta) - Math.abs(a.delta);
      })[0];
      const sign = worst.delta >= 0 ? '+' : '';
      const value = worst.metric === 'cls' ? worst.delta.toFixed(2) : `${Math.round(worst.delta)}ms`;
      return `${worst.metric.toUpperCase()} ${sign}${value}`;
    }
    case 'url': {
      const u = layers?.url;
      if (!u) return '';
      return u.divergedSteps.length > 0 ? `${u.divergedSteps.length} div` : '';
    }
    case 'variable': {
      const v = layers?.variable;
      if (!v) return '';
      return `Δ ${v.changes.length}`;
    }
  }
  return '';
}

/** Red chip surfaced when the underlying test_result.status is 'failed' —
 *  signals a hard failure (timeout, assertion throw, navigation error, etc.)
 *  distinct from a visual/diff regression. The errorMessage is exposed via
 *  the native title tooltip so reviewers don't have to drill into a tab. */
function ErrorChip({ result }: { result: TestResultLite | null }) {
  if (!result || result.status !== 'failed') return null;
  const msg = (result.errorMessage ?? '').trim();
  const summary = msg.length > 0 ? firstLine(msg) : 'test failed';
  const tooltip = msg.length > 0 ? msg : 'Test failed (no error message captured)';
  return (
    <span
      className="v-chip regression"
      style={{ fontSize: 9, padding: '1px 6px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      <AlertOctagon size={10} />
      {summary}
    </span>
  );
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/, 1)[0] ?? s;
  return line.length > 64 ? line.slice(0, 61) + '…' : line;
}

function IssueChipReal({ step, onOpenPicker }: { step: StepComparison; onOpenPicker?: () => void }) {
  if (!step.githubIssueUrl) {
    // 24px min hit-target + AA contrast on the "no issue" pill. Earlier
    // opacity:0.55 dropped the text to ~2.3:1 and the chip's intrinsic
    // height landed at 23.6px — axe flagged both.
    return (
      <span
        role={onOpenPicker ? 'button' : undefined}
        tabIndex={onOpenPicker ? 0 : -1}
        onClick={onOpenPicker ? (e) => { e.stopPropagation(); onOpenPicker(); } : undefined}
        onKeyDown={onOpenPicker ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPicker(); } } : undefined}
        className="v-chip"
        style={{
          cursor: onOpenPicker ? 'pointer' : 'default',
          minHeight: 24,
          color: 'var(--fg-2)',
        }}
        title={onOpenPicker ? 'Browse or file an issue for this case' : 'No linked issue'}
      >
        <CircleDot size={11} />no issue
      </span>
    );
  }
  const state = step.githubIssueState as StepIssueState | null;
  const cls =
    state === 'auto' ? 'regression' :
    state === 'open' ? 'missed' :
    state === 'closed' ? 'done' :
    'info';
  return (
    <a
      href={step.githubIssueUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`v-chip ${cls}`}
      style={{ textDecoration: 'none', cursor: 'pointer' }}
      title="Open issue on GitHub"
    >
      <CircleDot size={11} />#{step.githubIssueNumber} · {state ?? 'linked'}
    </a>
  );
}
