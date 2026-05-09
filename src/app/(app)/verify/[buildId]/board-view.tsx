'use client';

import { useMemo } from 'react';
import {
  Check,
  CircleDot,
  MoreHorizontal,
  SkipForward,
  Undo2,
  Github,
  CheckCircle as CheckCircleIcon,
} from 'lucide-react';
import type {
  StepComparison,
  StepLayerFeedback,
  ChangeMap,
} from '@/lib/db/schema';
import { deriveCaseStatus, type CaseStatus } from '@/lib/verify/case-status';

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface BoardViewProps {
  steps: StepComparison[];
  feedback: StepLayerFeedback[];
  testById: Map<string, TestLite>;
  areaById: Map<string, AreaLite>;
  changedAreaIds: Set<string>;
  changeMap: ChangeMap | null;
  onOpenCase: (stepId: string) => void;
  onMarkIntended: (stepId: string) => void;
  onMarkMissed: (stepId: string) => void;
  onTriage: (stepId: string) => void;
  onSkip: (stepId: string) => void;
}

const COLUMN_ORDER: { status: CaseStatus; label: string; accent: string }[] = [
  { status: 'regression', label: 'Regression',       accent: 'var(--c-red)' },
  { status: 'missed',     label: 'Intended · Missed', accent: 'var(--c-amber)' },
  { status: 'unknown',    label: 'Unknown',           accent: 'var(--fg-3)' },
  { status: 'done',       label: 'Intended · Done',   accent: 'var(--c-teal)' },
];

interface CaseCard {
  id: string;
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  feedback: StepLayerFeedback[];
}

export function BoardView(props: BoardViewProps) {
  const cases = useMemo<CaseCard[]>(() => {
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
      return { id: step.id, step, test, area, status, feedback: stepFb };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds]);

  const grouped = useMemo(() => {
    const map: Record<CaseStatus, CaseCard[]> = { regression: [], missed: [], unknown: [], done: [] };
    for (const c of cases) map[c.status].push(c);
    return map;
  }, [cases]);

  const total = cases.length;
  const verified = grouped.done.length + grouped.regression.length + grouped.missed.length;
  const wPct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
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
            onMarkIntended={props.onMarkIntended}
            onMarkMissed={props.onMarkMissed}
            onTriage={props.onTriage}
            onSkip={props.onSkip}
          />
        ))}
      </div>

      {/* dev cycle footer */}
      <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <Github size={14} />
        <span className="label">Dev cycle</span>
        <span className="v-chip regression"><CircleDot size={11} />auto-create {grouped.regression.length} {grouped.regression.length === 1 ? 'issue' : 'issues'} from regressions</span>
        <span className="v-chip done"><CheckCircleIcon size={11} />auto-close {grouped.done.length} {grouped.done.length === 1 ? 'issue' : 'issues'} from done</span>
        <span style={{ flex: 1 }} />
        <button className="v-btn" disabled>Preview &amp; commit</button>
      </div>
    </div>
  );
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
  cases: CaseCard[];
  onOpenCase: (stepId: string) => void;
  onMarkIntended: (stepId: string) => void;
  onMarkMissed: (stepId: string) => void;
  onTriage: (stepId: string) => void;
  onSkip: (stepId: string) => void;
}

function KCol({ label, accent, status, cases, onOpenCase, onMarkIntended, onMarkMissed, onTriage, onSkip }: KColProps) {
  const visible = cases.slice(0, 8);
  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--c-soft)', border: '1px solid var(--border)', borderRadius: 8,
      borderTop: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
          <span className="label" style={{ fontSize: 10 }}>{cases.length}</span>
        </div>
        <MoreHorizontal size={14} />
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
        {visible.length === 0 && (
          <div className="label" style={{ textAlign: 'center', padding: '24px 0' }}>—</div>
        )}
        {visible.map((c) => (
          <CaseCard
            key={c.id}
            data={c}
            onOpen={() => onOpenCase(c.id)}
            onMarkIntended={() => onMarkIntended(c.id)}
            onMarkMissed={() => onMarkMissed(c.id)}
            onTriage={() => onTriage(c.id)}
            onSkip={() => onSkip(c.id)}
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

interface CaseCardProps {
  data: CaseCard;
  colStatus: CaseStatus;
  onOpen: () => void;
  onMarkIntended: () => void;
  onMarkMissed: () => void;
  onTriage: () => void;
  onSkip: () => void;
}

function CaseCard({ data, colStatus, onOpen, onMarkIntended, onMarkMissed, onTriage, onSkip }: CaseCardProps) {
  const layerKinds = data.step.evidence.slice(0, 3).map((e) => e.layer);
  return (
    <div
      className="v-card"
      style={{ padding: 10, cursor: 'pointer' }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span className="label" style={{ fontSize: 9 }}>{data.area?.name ?? 'Unscoped'}</span>
        <span style={{ flex: 1 }} />
        <span className="v-chip" style={{ opacity: 0.55 }}>
          <CircleDot size={11} />no issue
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8, color: 'var(--fg-1)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {data.test?.name ?? 'Unknown test'}
        {data.step.stepLabel && <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}> · {data.step.stepLabel}</span>}
      </div>
      <div className="v-thumb" style={{ height: 56 }}>
        <span className="v-region" style={{ top: 14, left: 12, width: '38%', height: 10 }} />
        <span className="v-region" style={{ top: 30, left: 12, width: '60%', height: 6 }} />
        <span className="v-region" style={{ top: 42, left: 12, width: '30%', height: 6 }} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {layerKinds.map((k) => (
          <span key={k} className="v-chip" style={{ fontSize: 9, padding: '1px 6px' }}>{k}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
        {colStatus === 'regression' && (
          <button className="v-btn sm" style={{ flex: 1, fontSize: 11 }} onClick={onMarkIntended}>
            <Check size={11} />Intended
          </button>
        )}
        {colStatus === 'missed' && (
          <button className="v-btn sm" style={{ flex: 1, fontSize: 11 }} onClick={onMarkMissed}>
            <Check size={11} />Mark done
          </button>
        )}
        {colStatus === 'unknown' && (
          <button className="v-btn sm primary" style={{ flex: 1, fontSize: 11 }} onClick={onTriage}>
            Triage
          </button>
        )}
        {colStatus === 'done' && (
          <button className="v-btn sm ghost" style={{ flex: 1, fontSize: 11 }} disabled>
            <Undo2 size={11} />Undo
          </button>
        )}
        <button className="v-btn sm icon" title="Open issue">
          <CircleDot size={11} />
        </button>
        <button className="v-btn sm icon" title="Skip" onClick={onSkip}>
          <SkipForward size={11} />
        </button>
      </div>
    </div>
  );
}
