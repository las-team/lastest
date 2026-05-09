'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Filter,
  Github,
  Layers,
  Link as LinkIcon,
  MoveHorizontal,
  Search,
  SkipForward,
  X,
  GitPullRequest,
  CheckCircle as CheckCircleIcon,
  Plus,
} from 'lucide-react';
import { decideLayer } from '@/server/actions/layer-feedback';
import {
  createIssueForCase,
  linkIssueToCase,
  closeIssueForCase,
} from '@/server/actions/verify-issues';
import type {
  StepComparison,
  StepLayerFeedback,
  EvidenceLayer,
  StepIssueState,
} from '@/lib/db/schema';
import { deriveCaseStatus, type CaseStatus } from '@/lib/verify/case-status';
import type { VisualDiffLite } from './board-focus-client';

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface FocusViewProps {
  buildId: string;
  steps: StepComparison[];
  feedback: StepLayerFeedback[];
  testById: Map<string, TestLite>;
  areaById: Map<string, AreaLite>;
  changedAreaIds: Set<string>;
  visualByStepKey: Map<string, VisualDiffLite>;
  statusFilter: Set<CaseStatus>;
  selectedStepId: string | null;
  onSelect: (id: string) => void;
  onMarkDecision: (stepId: string, status: 'approved' | 'rejected' | 'snoozed') => void;
}

type CompareTab = EvidenceLayer;

const COMPARE_TABS: { id: CompareTab; name: string }[] = [
  { id: 'visual',   name: 'Visual' },
  { id: 'dom',      name: 'DOM' },
  { id: 'network',  name: 'Network' },
  { id: 'console',  name: 'Console' },
  { id: 'a11y',     name: 'A11y' },
  { id: 'perf',     name: 'Perf' },
  { id: 'url',      name: 'URL' },
  { id: 'variable', name: 'Vars' },
];

interface CaseRow {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  feedback: StepLayerFeedback[];
  visual: VisualDiffLite | null;
}

export function FocusView(props: FocusViewProps) {
  const [tab, setTab] = useState<CompareTab>('visual');
  const [intentOpen, setIntentOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const cases = useMemo<CaseRow[]>(() => {
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

  const visibleCases = useMemo(() => {
    if (props.statusFilter.size === 0) return cases;
    return cases.filter((c) => props.statusFilter.has(c.status));
  }, [cases, props.statusFilter]);

  const groupedByArea = useMemo(() => {
    const map = new Map<string, { area: AreaLite | null; rows: CaseRow[] }>();
    for (const c of visibleCases) {
      const key = c.area?.id ?? '__unscoped__';
      if (!map.has(key)) map.set(key, { area: c.area, rows: [] });
      map.get(key)!.rows.push(c);
    }
    return Array.from(map.values());
  }, [visibleCases]);

  const activeCase = visibleCases.find((c) => c.step.id === props.selectedStepId) ?? visibleCases[0] ?? null;
  const activeIdx = activeCase ? visibleCases.findIndex((c) => c.step.id === activeCase.step.id) : -1;

  const goPrev = () => {
    if (activeIdx > 0) props.onSelect(visibleCases[activeIdx - 1].step.id);
  };
  const goNext = () => {
    if (activeIdx >= 0 && activeIdx < visibleCases.length - 1) props.onSelect(visibleCases[activeIdx + 1].step.id);
  };

  const decideOneLayer = async (layer: EvidenceLayer, status: 'approved' | 'rejected' | 'snoozed') => {
    if (!activeCase) return;
    startTransition(async () => {
      await decideLayer({ stepComparisonId: activeCase.step.id, buildId: props.buildId, layer, status });
      router.refresh();
    });
  };

  // Server-side issue actions
  const handleCreateIssue = async () => {
    if (!activeCase) return;
    startTransition(async () => {
      const result = await createIssueForCase({ stepComparisonId: activeCase.step.id });
      if (!result.ok) alert(`Failed to create issue: ${result.error}`);
      router.refresh();
    });
  };
  const handleLinkIssue = async () => {
    if (!activeCase) return;
    const url = prompt('Paste GitHub issue URL (e.g. https://github.com/owner/repo/issues/123):');
    if (!url) return;
    startTransition(async () => {
      const result = await linkIssueToCase({ stepComparisonId: activeCase.step.id, issueUrl: url });
      if (!result.ok) alert(`Failed to link: ${result.error}`);
      router.refresh();
    });
  };
  const handleCloseIssue = async () => {
    if (!activeCase?.step.githubIssueUrl) return;
    if (!confirm(`Close issue #${activeCase.step.githubIssueNumber} on GitHub?`)) return;
    startTransition(async () => {
      const result = await closeIssueForCase(activeCase.step.id);
      if (!result.ok) alert(`Failed to close: ${result.error}`);
      router.refresh();
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <CaseSidebar
        groupedByArea={groupedByArea}
        activeId={activeCase?.step.id ?? null}
        onPick={props.onSelect}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Compare top bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="label" style={{ flexShrink: 0 }}>Verify · {activeCase?.area?.name ?? 'unscoped'}</span>
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeCase?.test?.name ?? 'Pick a case from the sidebar'}
          </span>
          {activeCase && <StatusChipFor status={activeCase.status} />}
          {activeCase?.step.githubIssueUrl && <IssueChipReal step={activeCase.step} />}
          <span style={{ flex: 1 }} />
          <button className="v-btn sm" onClick={goPrev} disabled={activeIdx <= 0}>
            <ChevronLeft size={12} />Prev
          </button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
            {activeIdx >= 0 ? activeIdx + 1 : 0} / {visibleCases.length}
          </span>
          <button className="v-btn sm" onClick={goNext} disabled={activeIdx < 0 || activeIdx >= visibleCases.length - 1}>
            Next<ChevronRight size={12} />
          </button>
          <button
            className={'v-btn ' + (intentOpen ? 'primary' : '')}
            onClick={() => setIntentOpen((v) => !v)}
          >
            <Github size={13} />{intentOpen ? 'Hide intent' : 'Show intent'}
          </button>
        </div>

        {/* Compare-kind tabs — disabled when the layer has no evidence */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
          {COMPARE_TABS.map((k) => {
            const isActive = tab === k.id;
            const delta = activeCase?.step ? layerDelta(activeCase.step, k.id) : null;
            const hasData = delta !== null || (k.id === 'visual' && !!activeCase?.visual);
            return (
              <button
                key={k.id}
                onClick={() => setTab(k.id)}
                disabled={!hasData}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  cursor: hasData ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isActive ? 'color-mix(in oklab, var(--c-teal) 12%, white)' : 'transparent',
                  border: '1px solid ' + (isActive ? 'color-mix(in oklab, var(--c-teal) 22%, transparent)' : 'var(--border)'),
                  color: isActive ? '#1F7B66' : (hasData ? 'var(--fg-2)' : 'var(--fg-4)'),
                  fontWeight: isActive ? 600 : 400,
                  opacity: hasData ? 1 : 0.5,
                }}
              >
                <span>{k.name}</span>
                {delta !== null && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{delta}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Compare pane */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ComparePane tab={tab} step={activeCase?.step ?? null} visual={activeCase?.visual ?? null} />
        </div>

        {/* Bottom action bar — Wired to real decideLayer for every layer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="v-btn primary" disabled={pending || !activeCase} onClick={() => activeCase && props.onMarkDecision(activeCase.step.id, 'approved')}>
            <Check size={13} />Mark intended
          </button>
          <button className="v-btn warning" disabled={pending || !activeCase} onClick={() => activeCase && props.onMarkDecision(activeCase.step.id, 'rejected')}>
            <AlertTriangle size={13} />Missed-intended
          </button>
          {!activeCase?.step.githubIssueUrl && (
            <button className="v-btn" disabled={pending || !activeCase} onClick={handleCreateIssue}>
              <Plus size={13} />Create issue
            </button>
          )}
          {activeCase?.step.githubIssueUrl && activeCase.step.githubIssueState !== 'closed' && (
            <button className="v-btn" disabled={pending} onClick={handleCloseIssue}>
              <CheckCircleIcon size={13} />Close issue
            </button>
          )}
          <button className="v-btn ghost" disabled={pending || !activeCase} onClick={() => activeCase && props.onMarkDecision(activeCase.step.id, 'snoozed')}>
            <SkipForward size={13} />Skip
          </button>
          <span style={{ flex: 1 }} />
          <span className="label">{activeCase?.feedback.length ?? 0} layer decision{activeCase?.feedback.length === 1 ? '' : 's'} on this case</span>
        </div>
      </div>

      <IntentPanel
        open={intentOpen}
        onClose={() => setIntentOpen(false)}
        activeCase={activeCase}
        onApproveLayer={(layer) => decideOneLayer(layer, 'approved')}
        onRejectLayer={(layer) => decideOneLayer(layer, 'rejected')}
        onCreateIssue={handleCreateIssue}
        onLinkIssue={handleLinkIssue}
        onCloseIssue={handleCloseIssue}
      />
    </div>
  );
}

function layerDelta(step: StepComparison, layer: EvidenceLayer): string | null {
  const layers = step.layers;
  switch (layer) {
    case 'visual': {
      const v = layers?.visual;
      if (!v) return null;
      return v.percentageDifference != null ? `${v.percentageDifference}%` : `${v.pixelDifference} px`;
    }
    case 'dom': return layers?.dom ? 'Δ' : null;
    case 'network': {
      const n = layers?.network;
      if (!n) return null;
      return `+${n.added} −${n.removed}`;
    }
    case 'console': {
      const c = layers?.consoleDiff;
      if (!c) return null;
      return c.newFingerprints.length > 0 ? `${c.newFingerprints.length} new` : '0';
    }
    case 'a11y': {
      const a = layers?.a11y;
      if (!a) return null;
      return `${a.newViolations.length}`;
    }
    case 'perf': {
      const p = layers?.perf;
      if (!p) return null;
      return `${p.deltas.length} Δ`;
    }
    case 'url': {
      const u = layers?.url;
      if (!u) return null;
      return `${u.divergedSteps.length} div`;
    }
    case 'variable': {
      const v = layers?.variable;
      if (!v) return null;
      return `Δ ${v.changes.length}`;
    }
  }
  return null;
}

function StatusChipFor({ status }: { status: CaseStatus }) {
  const labels: Record<CaseStatus, string> = {
    regression: 'Regression', done: 'Done', missed: 'Missed', unknown: 'Unknown',
  };
  return <span className={`v-chip ${status}`}><span className="dot" />{labels[status]}</span>;
}

function IssueChipReal({ step }: { step: StepComparison }) {
  if (!step.githubIssueUrl) return null;
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
      className={`v-chip ${cls}`}
      style={{ textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }}
      title="Open issue on GitHub"
    >
      <CircleDot size={11} />#{step.githubIssueNumber} · {state ?? 'linked'}
    </a>
  );
}

interface CaseSidebarProps {
  groupedByArea: { area: AreaLite | null; rows: CaseRow[] }[];
  activeId: string | null;
  onPick: (id: string) => void;
}

function CaseSidebar({ groupedByArea, activeId, onPick }: CaseSidebarProps) {
  const total = groupedByArea.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div style={{ width: 260, background: 'var(--c-white)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={13} />
        <span className="label" style={{ fontSize: 10 }}>{total} cases · group by area</span>
        <span style={{ flex: 1 }} />
        <Filter size={13} style={{ opacity: 0.5 }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groupedByArea.length === 0 && (
          <div className="label" style={{ padding: 16, textAlign: 'center' }}>no cases</div>
        )}
        {groupedByArea.map((g, i) => (
          <details key={g.area?.id ?? `g${i}`} open>
            <summary
              style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--c-soft)', borderBottom: '1px solid var(--border)',
                listStyle: 'none', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>{g.area?.name ?? 'Unscoped'}</span>
              <span className="label" style={{ fontSize: 9, marginLeft: 'auto' }}>{g.rows.length}</span>
            </summary>
            {g.rows.map((row) => {
              const active = row.step.id === activeId;
              const dotColor =
                row.status === 'regression' ? 'var(--c-red)' :
                row.status === 'done' ? 'var(--c-teal)' :
                row.status === 'missed' ? 'var(--c-amber)' : 'var(--fg-3)';
              return (
                <div
                  key={row.step.id}
                  onClick={() => onPick(row.step.id)}
                  style={{
                    padding: '8px 12px', display: 'flex', alignItems: 'flex-start', gap: 8,
                    borderBottom: '1px solid var(--border)',
                    background: active ? 'color-mix(in oklab, var(--c-teal) 8%, white)' : 'transparent',
                    borderLeft: active ? '2px solid var(--c-teal)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, background: dotColor, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.test?.name ?? 'Unknown test'}
                    </div>
                    {row.step.stepLabel && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.step.stepLabel}
                      </div>
                    )}
                    {row.step.evidence.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                        {Array.from(new Set(row.step.evidence.slice(0, 3).map((e) => e.layer))).map((layer) => (
                          <span key={layer} className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{layer}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {row.step.githubIssueNumber != null && (
                    <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', flexShrink: 0 }}>
                      #{row.step.githubIssueNumber}
                    </span>
                  )}
                </div>
              );
            })}
          </details>
        ))}
      </div>
    </div>
  );
}

interface ComparePaneProps {
  tab: CompareTab;
  step: StepComparison | null;
  visual: VisualDiffLite | null;
}

function ComparePane({ tab, step, visual }: ComparePaneProps) {
  if (!step) {
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
        Pick a case to compare.
      </div>
    );
  }

  if (tab === 'visual') return <VisualPane step={step} visual={visual} />;
  if (tab === 'dom') return <DomPane step={step} />;
  if (tab === 'network') return <NetworkPane step={step} />;
  if (tab === 'console') return <ConsolePane step={step} />;
  if (tab === 'a11y') return <A11yPane step={step} />;
  if (tab === 'perf') return <PerfPane step={step} />;
  if (tab === 'url') return <UrlPane step={step} />;
  if (tab === 'variable') return <VariablePane step={step} />;
  return null;
}

function VisualPane({ step, visual }: { step: StepComparison; visual: VisualDiffLite | null }) {
  const [mode, setMode] = useState<'slider' | 'side' | 'overlay'>('slider');
  const [sliderPct, setSliderPct] = useState(50);

  const baselineSrc = visual?.baselineImagePath;
  const currentSrc = visual?.currentImagePath;
  const diffSrc = visual?.diffImagePath;

  const hasBaseline = !!baselineSrc;
  const hasCurrent = !!currentSrc;
  const visualEvidence = step.layers?.visual;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-white)' }}>
        <div className="v-tabs">
          <button className={`v-tab ${mode === 'slider' ? 'active' : ''}`} onClick={() => setMode('slider')}>Slider</button>
          <button className={`v-tab ${mode === 'side' ? 'active' : ''}`} onClick={() => setMode('side')}>Side by side</button>
          <button className={`v-tab ${mode === 'overlay' ? 'active' : ''}`} onClick={() => setMode('overlay')}>Overlay</button>
        </div>
        <span style={{ flex: 1 }} />
        {visualEvidence && (
          <span className="v-chip regression">
            <span className="dot" />
            {visualEvidence.pixelDifference} px{visualEvidence.percentageDifference != null ? ` · ${visualEvidence.percentageDifference}%` : ''}
          </span>
        )}
        {visual?.classification && (
          <span className="v-chip" style={{ fontSize: 10 }}>{visual.classification}</span>
        )}
        <button className="v-btn sm"><Layers size={11} />Regions</button>
      </div>
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', minHeight: 0, overflowY: 'auto' }}>
        {!hasBaseline && !hasCurrent && (
          <div className="v-card" style={{ width: '100%', padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
            No screenshots captured for this step.
          </div>
        )}
        {mode === 'slider' && hasBaseline && hasCurrent && (
          <SliderViewer baseline={baselineSrc} current={currentSrc} pct={sliderPct} onPctChange={setSliderPct} />
        )}
        {mode === 'side' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
            <ImagePanel label="baseline" src={baselineSrc} />
            <ImagePanel label="current" src={currentSrc} />
          </div>
        )}
        {mode === 'overlay' && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {diffSrc ? (
              <ImagePanel label="diff" src={diffSrc} />
            ) : (
              <ImagePanel label="current" src={currentSrc} />
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ImagePanel label="baseline" src={baselineSrc} small />
              <ImagePanel label="current" src={currentSrc} small />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImagePanel({ label, src, small }: { label: string; src: string | null | undefined; small?: boolean }) {
  return (
    <div className="v-card" style={{ position: 'relative', overflow: 'hidden', minHeight: small ? 120 : 240 }}>
      <span className="label" style={{ position: 'absolute', top: 6, left: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', zIndex: 1, fontSize: 9 }}>
        {label}
      </span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} style={{ display: 'block', width: '100%', maxHeight: small ? 240 : 600, objectFit: 'contain', background: 'white' }} />
      ) : (
        <div style={{ width: '100%', height: small ? 120 : 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }} className="label">
          missing
        </div>
      )}
    </div>
  );
}

function SliderViewer({ baseline, current, pct, onPctChange }: { baseline: string; current: string; pct: number; onPctChange: (n: number) => void }) {
  return (
    <div className="v-card" style={{ width: '100%', padding: 0, position: 'relative', overflow: 'hidden', minHeight: 320 }}>
      {/* baseline behind */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={baseline} alt="baseline" style={{ display: 'block', width: '100%', maxHeight: 600, objectFit: 'contain', background: 'white' }} />
      {/* current clipped */}
      <div style={{ position: 'absolute', inset: 0, clipPath: `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt="current" style={{ display: 'block', width: '100%', maxHeight: 600, objectFit: 'contain', background: 'white' }} />
      </div>
      {/* slider handle */}
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onPctChange(parseInt(e.target.value, 10))}
        aria-label="Compare slider"
        style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'ew-resize' }}
      />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: 2, background: 'var(--c-teal)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '50%', left: -12, width: 26, height: 26, borderRadius: '50%', background: 'var(--c-white)', border: '2px solid var(--c-teal)', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MoveHorizontal size={12} />
        </div>
      </div>
      <span className="label" style={{ position: 'absolute', top: 6, left: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', zIndex: 1, fontSize: 9 }}>baseline</span>
      <span className="label" style={{ position: 'absolute', top: 6, right: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', zIndex: 1, fontSize: 9 }}>current</span>
    </div>
  );
}

function DomPane({ step }: { step: StepComparison }) {
  const dom = step.layers?.dom;
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div className="v-card" style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--fg-2)' }}>
        {dom ? (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(dom, null, 2)}</pre>
        ) : (
          <span className="label">No DOM diff captured for this step.</span>
        )}
      </div>
    </div>
  );
}

function NetworkPane({ step }: { step: StepComparison }) {
  const net = step.layers?.network;
  if (!net) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No network deltas captured.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <span className="label" style={{ fontSize: 9 }}>Δ</span>
          <span className="label" style={{ fontSize: 9 }}>Request</span>
          <span className="label" style={{ fontSize: 9 }}>Status</span>
        </div>
        {net.newClientErrors.length === 0 && net.newServerErrors.length === 0 && net.statusFlips.length === 0 && (
          <div style={{ padding: 12 }} className="label">no deltas</div>
        )}
        {net.newClientErrors.map((e, i) => (
          <NetworkRow key={`c${i}`} kind="new" url={`${e.method} ${e.url}`} status={String(e.status)} cls="regression" />
        ))}
        {net.newServerErrors.map((e, i) => (
          <NetworkRow key={`s${i}`} kind="new" url={`${e.method} ${e.url}`} status={String(e.status)} cls="regression" />
        ))}
        {net.statusFlips.map((e, i) => (
          <NetworkRow key={`f${i}`} kind="Δ" url={`${e.method} ${e.url}`} status={`${e.from}→${e.to}`} cls="missed" />
        ))}
      </div>
      <div className="label" style={{ marginTop: 8, padding: '0 4px' }}>
        +{net.added} new · {net.removed} removed · {net.changed} changed · {net.newErrorCount} new errors
      </div>
    </div>
  );
}

function NetworkRow({ kind, url, status, cls }: { kind: string; url: string; status: string; cls: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center', fontSize: 12 }}>
      <span className={`v-chip ${cls}`} style={{ fontSize: 9, padding: '1px 6px' }}>{kind}</span>
      <span className="mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
      <span className="mono" style={{ fontSize: 11 }}>{status}</span>
    </div>
  );
}

function ConsolePane({ step }: { step: StepComparison }) {
  const con = step.layers?.consoleDiff;
  if (!con) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No console diff captured.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div className="v-card" style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.85 }}>
        {con.newFingerprints.length === 0 && con.disappeared.length === 0 && (
          <span className="label">no new console messages</span>
        )}
        {con.newFingerprints.map((fp, i) => (
          <div key={`n${i}`}>
            <span className="v-chip regression" style={{ fontSize: 9 }}>NEW · ×{fp.count}</span>{' '}
            <span style={{ color: 'var(--c-red)' }}>{fp.sample}</span>
          </div>
        ))}
        {con.disappeared.map((fp, i) => (
          <div key={`d${i}`} style={{ opacity: 0.55 }}>
            <span className="v-chip done" style={{ fontSize: 9 }}>resolved · ×{fp.count}</span>{' '}
            <span style={{ color: 'var(--c-teal)' }}>{fp.sample}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function A11yPane({ step }: { step: StepComparison }) {
  const a = step.layers?.a11y;
  if (!a) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No a11y diff captured.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
        {a.newViolations.length === 0 && <div style={{ padding: 12 }} className="label">no new violations</div>}
        {a.newViolations.map((v, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px 80px', padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', gap: 8 }}>
            <span className="v-chip regression" style={{ fontSize: 9 }}>new</span>
            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.id}</span>
            <span className="v-chip" style={{ fontSize: 9 }}>{v.impact}</span>
            {v.wcagLevel && <span className="v-chip info" style={{ fontSize: 9 }}>WCAG {v.wcagLevel}</span>}
          </div>
        ))}
      </div>
      <div className="label" style={{ marginTop: 8, padding: '0 4px' }}>
        crit {a.newBySeverity.critical} · ser {a.newBySeverity.serious} · mod {a.newBySeverity.moderate} · min {a.newBySeverity.minor}
      </div>
    </div>
  );
}

function PerfPane({ step }: { step: StepComparison }) {
  const p = step.layers?.perf;
  if (!p) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No perf diff captured.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {p.deltas.map((d, i) => (
          <div key={i} className="v-card" style={{ padding: 14 }}>
            <div className="label">{d.metric.toUpperCase()}{d.stepLabel ? ` · ${d.stepLabel}` : ''}</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>
              {d.metric === 'cls' ? d.current.toFixed(2) : Math.round(d.current)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`v-chip ${d.budgetBreached || d.drifted ? 'missed' : 'done'}`} style={{ fontSize: 9 }}>
                {d.delta >= 0 ? '+' : ''}{d.metric === 'cls' ? d.delta.toFixed(2) : Math.round(d.delta)}
              </span>
              {d.budgetBreached && <span className="label" style={{ fontSize: 9 }}>over budget</span>}
              {d.drifted && !d.budgetBreached && <span className="label" style={{ fontSize: 9 }}>drift</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UrlPane({ step }: { step: StepComparison }) {
  const u = step.layers?.url;
  if (!u) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No URL trajectory diff.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
      <div className="v-card" style={{ padding: 12 }}>
        <div className="label">URL trajectory ({u.totalStepsCompared} steps)</div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 2 }}>
          {u.divergedSteps.length === 0 && <span className="label">no divergence</span>}
          {u.divergedSteps.map((d, i) => (
            <div key={i}>
              <span style={{ color: 'var(--fg-2)' }}>{d.baselineUrl}</span> → <span style={{ color: 'var(--c-red)' }}>{d.currentUrl}</span>
              {d.redirectChainChanged && <span className="v-chip missed" style={{ fontSize: 9, marginLeft: 6 }}>+1 redirect</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VariablePane({ step }: { step: StepComparison }) {
  const v = step.layers?.variable;
  if (!v) {
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}><span className="label">No variable diff.</span></div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
      <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="label" style={{ fontSize: 9 }}>path</span>
          <span className="label" style={{ fontSize: 9 }}>baseline</span>
          <span className="label" style={{ fontSize: 9 }}>current</span>
          <span className="label" style={{ fontSize: 9 }}>tier</span>
        </div>
        {v.changes.length === 0 && <div style={{ padding: 12 }} className="label">no variable changes</div>}
        {v.changes.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.path}</span>
            <span className="mono" style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(c.baseline ?? '—')}</span>
            <span className="mono" style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(c.current ?? '—')}</span>
            <span className="v-chip" style={{ fontSize: 9 }}>{c.tier.replace('-', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface IntentPanelProps {
  open: boolean;
  onClose: () => void;
  activeCase: CaseRow | null;
  onApproveLayer: (layer: EvidenceLayer) => void;
  onRejectLayer: (layer: EvidenceLayer) => void;
  onCreateIssue: () => void;
  onLinkIssue: () => void;
  onCloseIssue: () => void;
}

function IntentPanel({ open, onClose, activeCase, onApproveLayer, onRejectLayer, onCreateIssue, onLinkIssue, onCloseIssue }: IntentPanelProps) {
  if (!open) return null;
  const evidence = activeCase?.step.evidence ?? [];
  const issueUrl = activeCase?.step.githubIssueUrl ?? null;
  const issueNumber = activeCase?.step.githubIssueNumber ?? null;
  const issueState = activeCase?.step.githubIssueState ?? null;
  return (
    <div style={{ width: 290, background: 'var(--c-white)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Github size={14} />
        <span className="label">linked intent</span>
        <span style={{ flex: 1 }} />
        <button className="v-btn ghost icon" onClick={onClose}><X size={13} /></button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
        {/* Real issue card if linked */}
        {issueUrl ? (
          <div className="v-card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`v-chip ${issueState === 'closed' ? 'done' : issueState === 'auto' ? 'regression' : 'info'}`} style={{ fontSize: 10 }}>
                #{issueNumber} {issueState ?? 'linked'}
              </span>
              <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11, color: 'var(--c-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {issueUrl.replace(/^https?:\/\//, '')}
              </a>
            </div>
          </div>
        ) : (
          <div className="v-card" style={{ padding: 12, background: 'var(--c-soft)' }}>
            <span className="v-chip info" style={{ fontSize: 10 }}>no issue linked</span>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>
              Link or create a GitHub issue to track this case in your dev cycle.
            </div>
          </div>
        )}

        {/* Per-evidence approve/reject */}
        {evidence.length > 0 && (
          <>
            <div className="label">Evidence ({evidence.length})</div>
            {evidence.map((e, i) => (
              <div key={i} className="v-card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`v-chip ${e.signal === 'high' ? 'regression' : e.signal === 'medium' ? 'missed' : 'done'}`} style={{ fontSize: 9 }}>
                    {e.layer} · {e.signal}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>{e.summary}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button className="v-btn sm" onClick={() => onApproveLayer(e.layer)}>
                    <Check size={11} />Expected
                  </button>
                  <button className="v-btn sm" onClick={() => onRejectLayer(e.layer)}>
                    <AlertTriangle size={11} />Needs fix
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        <div className="label" style={{ marginTop: 6 }}>actions on case</div>
        {!issueUrl && (
          <>
            <button className="v-btn" style={{ justifyContent: 'flex-start' }} onClick={onLinkIssue}>
              <LinkIcon size={12} />Link existing issue
            </button>
            <button className="v-btn primary" style={{ justifyContent: 'flex-start' }} onClick={onCreateIssue}>
              <Plus size={12} />Create new issue
            </button>
          </>
        )}
        {issueUrl && (
          <>
            <a className="v-btn" style={{ justifyContent: 'flex-start', textDecoration: 'none' }} href={issueUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} />Open in GitHub
            </a>
            {issueState !== 'closed' && (
              <button className="v-btn" style={{ justifyContent: 'flex-start' }} onClick={onCloseIssue}>
                <CheckCircleIcon size={12} />Close issue
              </button>
            )}
            <button className="v-btn ghost" style={{ justifyContent: 'flex-start' }} onClick={onLinkIssue}>
              <GitPullRequest size={12} />Re-link to a different issue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
