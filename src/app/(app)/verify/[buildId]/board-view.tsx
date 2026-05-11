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
  Check,
  CircleDot,
  ExternalLink,
  Loader2,
  SkipForward,
  Undo2,
  Github,
  CheckCircle as CheckCircleIcon,
} from 'lucide-react';
import type {
  EvidenceLayer,
  StepComparison,
  StepLayerFeedback,
  StepIssueState,
} from '@/lib/db/schema';
import { deriveCaseStatus } from '@/lib/verify/case-status';
import type { VisualDiffLite, TestResultLite } from './board-focus-client';

export type CaseStatus = 'regression' | 'done' | 'missed' | 'unknown';

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
  onOpenCase: (stepId: string) => void;
  onDropCase: (stepId: string, target: CaseStatus) => void;
  /** Open the GH issue picker dialog for a specific case. */
  onOpenIssuePicker: (stepId: string) => void;
}

// Columns flow left → right: needs decision → broken → expected-but-missing → resolved.
// NOTE: status type values stay in code (`unknown`, `regression`, `missed`, `done`)
// to avoid a wide rename — only the user-facing labels are reworded.
const COLUMN_ORDER: { status: CaseStatus; label: string; accent: string; dropLabel: string }[] = [
  { status: 'unknown',    label: 'Unsorted', dropLabel: 'unsorted',  accent: 'var(--fg-3)' },
  { status: 'regression', label: 'Broken',   dropLabel: 'broken',    accent: 'var(--c-red)' },
  { status: 'missed',     label: 'Missed',   dropLabel: 'missed',    accent: 'var(--c-amber)' },
  { status: 'done',       label: 'Verified', dropLabel: 'verified',  accent: 'var(--c-teal)' },
];

interface CaseCardData {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
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
    return props.steps.map((step) => {
      const stepFb = fbByStep.get(step.id) ?? [];
      const test = props.testById.get(step.testId) ?? null;
      const isInChangedArea = !!(test?.functionalAreaId && props.changedAreaIds.has(test.functionalAreaId));
      const result = step.testResultId ? props.testResultById.get(step.testResultId) ?? null : null;
      const status = deriveCaseStatus({
        step,
        feedback: stepFb,
        isInChangedArea,
        testFailed: result?.status === 'failed',
      });
      const area = test?.functionalAreaId ? props.areaById.get(test.functionalAreaId) ?? null : null;
      const visual = props.visualByStepKey.get(`${step.testId}::${step.stepLabel ?? ''}`) ?? null;
      return { step, test, area, status, feedback: stepFb, visual, result };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds, props.visualByStepKey, props.testResultById]);

  const grouped = useMemo(() => {
    const map: Record<CaseStatus, CaseCardData[]> = { regression: [], missed: [], unknown: [], done: [] };
    for (const c of cases) {
      if (props.statusFilter.size > 0 && !props.statusFilter.has(c.status)) continue;
      map[c.status].push(c);
    }
    return map;
  }, [cases, props.statusFilter]);

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

  const total = cases.length;
  const verified = grouped.done.length + grouped.regression.length + grouped.missed.length;
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
                <div style={{ width: `${wPct(grouped.done.length)}%`, background: 'var(--c-teal)' }} />
                <div style={{ width: `${wPct(grouped.missed.length)}%`, background: 'var(--c-amber)' }} />
                <div style={{ width: `${wPct(grouped.regression.length)}%`, background: 'var(--c-red)' }} />
                <div style={{ width: `${wPct(grouped.unknown.length)}%`, background: 'var(--fg-3)' }} />
              </div>
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              {verified} / {total} verified
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
            <Chip status="regression" /><Counter n={grouped.regression.length} />
            <Chip status="missed" /><Counter n={grouped.missed.length} />
            <Chip status="unknown" /><Counter n={grouped.unknown.length} />
            <Chip status="done" /><Counter n={grouped.done.length} />
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
              onOpenCase={props.onOpenCase}
              onOpenIssuePicker={props.onOpenIssuePicker}
              // Show in-flight skeletons in the Unsorted column while running.
              runningTests={col.status === 'unknown' && props.isRunning ? props.runningTests : []}
              testById={props.testById}
              isDragSource={sourceStatus === col.status}
              isDragValid={sourceStatus !== null && sourceStatus !== col.status}
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
            <CaseCard data={activeDragCase} colStatus={activeDragCase.status} onOpen={() => {}} dragging />
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

function Chip({ status }: { status: CaseStatus }) {
  const labels: Record<CaseStatus, string> = {
    regression: 'Broken',
    done: 'Verified',
    missed: 'Missed',
    unknown: 'Unsorted',
  };
  return <span className={`v-chip ${status}`}><span className="dot" />{labels[status]}</span>;
}

function Counter({ n }: { n: number }) {
  return <span className="mono" style={{ color: 'var(--fg-3)' }}>{n}</span>;
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
  onOpenCase: (stepId: string) => void;
  onOpenIssuePicker: (stepId: string) => void;
  /** Live in-flight tests; rendered as non-draggable skeleton cards. */
  runningTests: Array<{ testId: string; name: string }>;
  testById: Map<string, TestLite>;
  /** True while a card is being dragged FROM this column. */
  isDragSource: boolean;
  /** True while a card is being dragged AND this column is a valid drop target. */
  isDragValid: boolean;
}

function KCol({ label, dropLabel, accent, status, cases, areaTotals, onOpenCase, onOpenIssuePicker, runningTests, testById, isDragSource, isDragValid }: KColProps) {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
          <span className="label" style={{ fontSize: 10 }}>{totalCount}</span>
        </div>
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
          <div className="label" style={{ textAlign: 'center', padding: '24px 0' }}>—</div>
        )}
        {/* Verified column: collapse all-clean areas under a single details row.
            Areas with any flagged case (linked issue, reviewer note in future)
            still expand inline. Other columns just render flat. */}
        {status === 'done'
          ? renderVerifiedGrouped(visible, areaTotals, onOpenCase, onOpenIssuePicker)
          : visible.map((c) => (
              <DraggableCaseCard
                key={c.step.id}
                data={c}
                onOpen={() => onOpenCase(c.step.id)}
                onOpenIssuePicker={() => onOpenIssuePicker(c.step.id)}
                colStatus={status}
              />
            ))}
        {cases.length > visible.length && (
          <div className="label" style={{ textAlign: 'center', padding: '8px 0' }}>+{cases.length - visible.length} more</div>
        )}
      </div>
    </div>
  );
}

/** Group Verified-column cards by area; areas where every case is "clean"
 *  (no linked issue / no rejection feedback) collapse to a single summary row.
 *  Other areas render flat so anything that still needs eyes is visible.
 *  `areaTotals` carries the count of *all* tests in each area across the board
 *  (not just the ones that landed in Verified) — used as the y/x denominator. */
function renderVerifiedGrouped(
  cases: CaseCardData[],
  areaTotals: Map<string, number>,
  onOpenCase: (id: string) => void,
  onOpenIssuePicker: (id: string) => void,
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
      const verifiedCount = g.rows.filter(isCleanCase).length;
      // Denominator = every test in this area across ALL columns, not just
      // the ones that happen to be in the Verified column right now.
      const totalInArea = areaTotals.get(g.area?.id ?? '__unscoped__') ?? g.rows.length;
      const fullyVerified = verifiedCount === totalInArea;
      return (
        <details key={areaKey} className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
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
}

function DraggableCaseCard({ data, colStatus, onOpen, onOpenIssuePicker }: DraggableProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: data.step.id });
  // While dragging, the source slot fades out — DragOverlay portals the
  // visual preview above all columns so it never gets clipped.
  // Default browser cursor; dnd-kit's `attributes` set role="button"/tabIndex
  // which some user-agent stylesheets render with an unfamiliar caret —
  // override back to the arrow so the card behaves like a normal element.
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.25 : 1,
    cursor: isDragging ? 'grabbing' : 'default',
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <CaseCard data={data} colStatus={colStatus} onOpen={onOpen} onOpenIssuePicker={onOpenIssuePicker} dragging={false} />
    </div>
  );
}

interface CardProps {
  data: CaseCardData;
  colStatus: CaseStatus;
  onOpen: () => void;
  onOpenIssuePicker?: () => void;
  dragging?: boolean;
}

function CaseCard({ data, colStatus, onOpen, onOpenIssuePicker, dragging }: CardProps) {
  const layerSummaries = useMemo(
    () => summarizeLayersForCard(data.step, data.result, data.visual),
    [data.step, data.result, data.visual],
  );
  return (
    <div
      className="v-card"
      style={{ padding: 10, userSelect: 'none', boxShadow: dragging ? '0 8px 24px rgba(31,42,51,0.18)' : undefined }}
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
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
        <button className="v-btn sm" style={{ flex: 1, fontSize: 11 }} onClick={onOpen}>
          {colStatus === 'unknown' ? 'Triage' : <><Check size={11} />Open</>}
        </button>
        {data.step.githubIssueUrl && (
          <a
            href={data.step.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="v-btn sm icon"
            title={`#${data.step.githubIssueNumber} on GitHub`}
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={11} />
          </a>
        )}
        {colStatus !== 'unknown' && colStatus !== 'done' && (
          <button className="v-btn sm icon" title="Skip">
            <SkipForward size={11} />
          </button>
        )}
        {colStatus === 'done' && (
          <button className="v-btn sm icon" title="Undo">
            <Undo2 size={11} />
          </button>
        )}
      </div>
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
  'visual', 'dom', 'network', 'console', 'a11y', 'perf', 'url', 'variable',
];

/** Per-layer summary chip data for a board card.
 *
 *  Includes BOTH evidence-bearing layers AND layers that were captured but
 *  matched baseline (no evidence row) — those render as green "match" chips
 *  so reviewers can see what was actually verified, not just what failed. */
function summarizeLayersForCard(
  step: StepComparison,
  result: TestResultLite | null,
  visual: VisualDiffLite | null,
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
    if (ev) {
      out.push({
        layer,
        delta: deltaForLayer(step, layer),
        summary: ev.summary,
        tone: ev.signal === 'high' ? 'regression' : ev.signal === 'medium' ? 'missed' : 'done',
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
    case 'perf': return result?.webVitals != null;
    case 'url': return result?.urlTrajectory != null;
    case 'variable': return result?.extractedVariables != null || result?.assignedVariables != null;
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
      const parts: string[] = [];
      if (n.added) parts.push(`+${n.added}`);
      if (n.removed) parts.push(`−${n.removed}`);
      if (n.newErrorCount) parts.push(`${n.newErrorCount} err`);
      return parts.join(' ') || `${n.changed} chg`;
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
    return (
      <span
        role={onOpenPicker ? 'button' : undefined}
        tabIndex={onOpenPicker ? 0 : -1}
        onClick={onOpenPicker ? (e) => { e.stopPropagation(); onOpenPicker(); } : undefined}
        onKeyDown={onOpenPicker ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPicker(); } } : undefined}
        className="v-chip"
        style={{ opacity: 0.55, cursor: onOpenPicker ? 'pointer' : 'default' }}
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
