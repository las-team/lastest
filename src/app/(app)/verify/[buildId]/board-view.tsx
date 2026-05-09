'use client';

import { useMemo, useState } from 'react';
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
import {
  Check,
  CircleDot,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  SkipForward,
  Undo2,
  Github,
  CheckCircle as CheckCircleIcon,
} from 'lucide-react';
import type {
  StepComparison,
  StepLayerFeedback,
  StepIssueState,
} from '@/lib/db/schema';
import { deriveCaseStatus } from '@/lib/verify/case-status';
import type { VisualDiffLite } from './board-focus-client';

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
  /** When non-empty, only these statuses are shown on the board. */
  statusFilter: Set<CaseStatus>;
  /** True while the build is in progress — shows a Running banner + in-flight cards. */
  isRunning: boolean;
  /** Tests currently executing on the runner (for in-flight skeleton cards). */
  runningTests: Array<{ testId: string; name: string }>;
  onOpenCase: (stepId: string) => void;
  onDropCase: (stepId: string, target: CaseStatus) => void;
}

// Columns flow from "needs decision" (Unknown — leftmost) → verdict
// (Regression / Missed) → resolved (Done — rightmost).
const COLUMN_ORDER: { status: CaseStatus; label: string; accent: string }[] = [
  { status: 'unknown',    label: 'Unknown',             accent: 'var(--fg-3)' },
  { status: 'regression', label: 'Regression',          accent: 'var(--c-red)' },
  { status: 'missed',     label: 'Intended · Missed',   accent: 'var(--c-amber)' },
  { status: 'done',       label: 'Intended · Done',     accent: 'var(--c-teal)' },
];

interface CaseCardData {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  feedback: StepLayerFeedback[];
  visual: VisualDiffLite | null;
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
      const status = deriveCaseStatus({ step, feedback: stepFb, isInChangedArea });
      const area = test?.functionalAreaId ? props.areaById.get(test.functionalAreaId) ?? null : null;
      const visual = props.visualByStepKey.get(`${step.testId}::${step.stepLabel ?? ''}`) ?? null;
      return { step, test, area, status, feedback: stepFb, visual };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds, props.visualByStepKey]);

  const grouped = useMemo(() => {
    const map: Record<CaseStatus, CaseCardData[]> = { regression: [], missed: [], unknown: [], done: [] };
    for (const c of cases) {
      if (props.statusFilter.size > 0 && !props.statusFilter.has(c.status)) continue;
      map[c.status].push(c);
    }
    return map;
  }, [cases, props.statusFilter]);

  const total = cases.length;
  const verified = grouped.done.length + grouped.regression.length + grouped.missed.length;
  const wPct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragCase = activeDragId ? cases.find((c) => c.step.id === activeDragId) ?? null : null;

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

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
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
              accent={col.accent}
              status={col.status}
              cases={grouped[col.status]}
              onOpenCase={props.onOpenCase}
              // Show in-flight skeletons in the Unknown column while running.
              runningTests={col.status === 'unknown' && props.isRunning ? props.runningTests : []}
              testById={props.testById}
            />
          ))}
        </div>

        {/* dev cycle footer (computed from real counts) */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Github size={14} />
          <span className="label">Dev cycle</span>
          {grouped.regression.length > 0 && (
            <span className="v-chip regression">
              <CircleDot size={11} />
              {countWithoutIssue(grouped.regression)} {countWithoutIssue(grouped.regression) === 1 ? 'regression' : 'regressions'} pending issue creation
            </span>
          )}
          {grouped.done.length > 0 && (
            <span className="v-chip done">
              <CheckCircleIcon size={11} />
              {countWithLinkedIssue(grouped.done)} done case{countWithLinkedIssue(grouped.done) === 1 ? '' : 's'} ready to close
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
    regression: 'Regression',
    done: 'Done',
    missed: 'Missed',
    unknown: 'Unknown',
  };
  return <span className={`v-chip ${status}`}><span className="dot" />{labels[status]}</span>;
}

function Counter({ n }: { n: number }) {
  return <span className="mono" style={{ color: 'var(--fg-3)' }}>{n}</span>;
}

interface KColProps {
  label: string;
  accent: string;
  status: CaseStatus;
  cases: CaseCardData[];
  onOpenCase: (stepId: string) => void;
  /** Live in-flight tests; rendered as non-draggable skeleton cards. */
  runningTests: Array<{ testId: string; name: string }>;
  testById: Map<string, TestLite>;
}

function KCol({ label, accent, status, cases, onOpenCase, runningTests, testById }: KColProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const visible = cases.slice(0, 30);
  const sideColor = isOver ? 'color-mix(in oklab, var(--c-teal) 35%, transparent)' : 'var(--border)';
  const totalCount = cases.length + runningTests.length;
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        background: isOver ? 'color-mix(in oklab, var(--c-teal) 6%, var(--c-soft))' : 'var(--c-soft)',
        borderTop: `3px solid ${accent}`,
        borderRight: `1px solid ${sideColor}`,
        borderBottom: `1px solid ${sideColor}`,
        borderLeft: `1px solid ${sideColor}`,
        borderRadius: 8,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
          <span className="label" style={{ fontSize: 10 }}>{totalCount}</span>
        </div>
        <MoreHorizontal size={14} />
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
        {/* In-flight running tests (only in Unknown column while running). */}
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
        {visible.map((c) => (
          <DraggableCaseCard
            key={c.step.id}
            data={c}
            onOpen={() => onOpenCase(c.step.id)}
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

interface DraggableProps {
  data: CaseCardData;
  colStatus: CaseStatus;
  onOpen: () => void;
}

function DraggableCaseCard({ data, colStatus, onOpen }: DraggableProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: data.step.id });
  // While dragging, the source slot fades out — DragOverlay portals the
  // visual preview above all columns so it never gets clipped.
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.25 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <CaseCard data={data} colStatus={colStatus} onOpen={onOpen} dragging={false} />
    </div>
  );
}

interface CardProps {
  data: CaseCardData;
  colStatus: CaseStatus;
  onOpen: () => void;
  dragging?: boolean;
}

function CaseCard({ data, colStatus, onOpen, dragging }: CardProps) {
  const layerKinds = Array.from(new Set(data.step.evidence.slice(0, 4).map((e) => e.layer)));
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
        <IssueChipReal step={data.step} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8, color: 'var(--fg-1)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {data.test?.name ?? 'Unknown test'}
        {data.step.stepLabel && <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}> · {data.step.stepLabel}</span>}
      </div>
      <CardThumbnail visual={data.visual} />
      {layerKinds.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {layerKinds.map((k) => (
            <span key={k} className="v-chip" style={{ fontSize: 9, padding: '1px 6px' }}>{k}</span>
          ))}
        </div>
      )}
      {data.visual?.percentageDifference != null && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 6 }}>
          {data.visual.percentageDifference}% diff · {data.visual.pixelDifference} px
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
        {colStatus === 'unknown' ? (
          <button className="v-btn sm primary" style={{ flex: 1, fontSize: 11 }} onClick={onOpen}>
            Triage
          </button>
        ) : (
          <button className="v-btn sm" style={{ flex: 1, fontSize: 11 }} onClick={onOpen}>
            <Check size={11} />Open
          </button>
        )}
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
    <div style={{ height: 56, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--c-soft-2)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
      />
    </div>
  );
}

function IssueChipReal({ step }: { step: StepComparison }) {
  if (!step.githubIssueUrl) {
    return (
      <span className="v-chip" style={{ opacity: 0.55 }}>
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
