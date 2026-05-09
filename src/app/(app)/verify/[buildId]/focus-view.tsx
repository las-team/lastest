'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Eye,
  Filter,
  Github,
  Layers,
  Link as LinkIcon,
  MoveHorizontal,
  Search,
  SkipForward,
  X,
  GitPullRequest,
} from 'lucide-react';
import { decideLayer } from '@/server/actions/layer-feedback';
import type {
  StepComparison,
  StepLayerFeedback,
  EvidenceLayer,
  ChangeMap,
} from '@/lib/db/schema';
import { deriveCaseStatus, type CaseStatus } from '@/lib/verify/case-status';

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface FocusViewProps {
  buildId: string;
  steps: StepComparison[];
  feedback: StepLayerFeedback[];
  testById: Map<string, TestLite>;
  areaById: Map<string, AreaLite>;
  changedAreaIds: Set<string>;
  changeMap: ChangeMap | null;
  selectedStepId: string | null;
  onSelect: (id: string) => void;
}

type CompareTab = EvidenceLayer | 'visual' | 'dom' | 'network' | 'console' | 'a11y' | 'perf' | 'url' | 'variable';

const COMPARE_TABS: { id: CompareTab; name: string; deltaLabel: (s?: StepComparison) => string }[] = [
  { id: 'visual',   name: 'Visual',  deltaLabel: (s) => s?.layers?.visual?.percentageDifference ? `${s.layers.visual.percentageDifference}%` : '—' },
  { id: 'dom',      name: 'DOM',     deltaLabel: (s) => s?.layers?.dom ? `Δ` : '—' },
  { id: 'network',  name: 'Network', deltaLabel: (s) => s?.layers?.network ? `+${s.layers.network.added} −${s.layers.network.removed}` : '—' },
  { id: 'console',  name: 'Console', deltaLabel: (s) => s?.layers?.consoleDiff ? `${s.layers.consoleDiff.newFingerprints.length} new` : '—' },
  { id: 'a11y',     name: 'A11y',    deltaLabel: (s) => s?.layers?.a11y ? `${s.layers.a11y.newViolations.length}` : '—' },
  { id: 'perf',     name: 'Perf',    deltaLabel: (s) => s?.layers?.perf ? `${s.layers.perf.deltas.length} Δ` : '—' },
  { id: 'url',      name: 'URL',     deltaLabel: (s) => s?.layers?.url ? `${s.layers.url.divergedSteps.length} div` : '—' },
  { id: 'variable', name: 'Vars',    deltaLabel: (s) => s?.layers?.variable ? `Δ ${s.layers.variable.changes.length}` : '—' },
];

interface CaseRow {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  feedback: StepLayerFeedback[];
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
      return { step, test, area, status, feedback: stepFb };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds]);

  const groupedByArea = useMemo(() => {
    const map = new Map<string, { area: AreaLite | null; rows: CaseRow[] }>();
    for (const c of cases) {
      const key = c.area?.id ?? '__unscoped__';
      if (!map.has(key)) map.set(key, { area: c.area, rows: [] });
      map.get(key)!.rows.push(c);
    }
    return Array.from(map.values());
  }, [cases]);

  const activeCase = cases.find((c) => c.step.id === props.selectedStepId) ?? cases[0] ?? null;
  const activeIdx = activeCase ? cases.findIndex((c) => c.step.id === activeCase.step.id) : -1;

  const goPrev = () => {
    if (activeIdx > 0) props.onSelect(cases[activeIdx - 1].step.id);
  };
  const goNext = () => {
    if (activeIdx >= 0 && activeIdx < cases.length - 1) props.onSelect(cases[activeIdx + 1].step.id);
  };

  const decide = async (layer: EvidenceLayer, status: 'approved' | 'rejected' | 'snoozed') => {
    if (!activeCase) return;
    startTransition(async () => {
      await decideLayer({ stepComparisonId: activeCase.step.id, buildId: props.buildId, layer, status });
      router.refresh();
    });
  };

  const decideAll = (status: 'approved' | 'rejected' | 'snoozed') => {
    if (!activeCase) return;
    const layers = activeCase.step.evidence.length > 0
      ? activeCase.step.evidence.map((e) => e.layer)
      : (['visual'] as EvidenceLayer[]);
    startTransition(async () => {
      for (const layer of layers) {
        await decideLayer({ stepComparisonId: activeCase.step.id, buildId: props.buildId, layer, status });
      }
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
          <span className="label">Verify · {activeCase?.area?.name ?? 'unscoped'}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{activeCase?.test?.name ?? 'Pick a case from the sidebar'}</span>
          {activeCase && <StatusChipFor status={activeCase.status} />}
          <span style={{ flex: 1 }} />
          <button className="v-btn sm" onClick={goPrev} disabled={activeIdx <= 0}>
            <ChevronLeft size={12} />Prev
          </button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
            {activeIdx >= 0 ? activeIdx + 1 : 0} / {cases.length}
          </span>
          <button className="v-btn sm" onClick={goNext} disabled={activeIdx < 0 || activeIdx >= cases.length - 1}>
            Next<ChevronRight size={12} />
          </button>
          <button
            className={'v-btn ' + (intentOpen ? 'primary' : '')}
            onClick={() => setIntentOpen((v) => !v)}
          >
            <Github size={13} />{intentOpen ? 'Hide intent' : 'Show intent'}
          </button>
        </div>

        {/* Compare-kind tabs */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
          {COMPARE_TABS.map((k) => {
            const isActive = tab === k.id;
            return (
              <button
                key={k.id}
                onClick={() => setTab(k.id)}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isActive ? 'color-mix(in oklab, var(--c-teal) 12%, white)' : 'transparent',
                  border: '1px solid ' + (isActive ? 'color-mix(in oklab, var(--c-teal) 22%, transparent)' : 'var(--border)'),
                  color: isActive ? '#1F7B66' : 'var(--fg-2)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <span>{k.name}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>
                  {k.deltaLabel(activeCase?.step)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Compare pane */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ComparePane tab={tab} step={activeCase?.step ?? null} />
        </div>

        {/* Bottom action bar */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="v-btn primary" disabled={pending || !activeCase} onClick={() => decideAll('approved')}>
            <Check size={13} />Mark intended
          </button>
          <button className="v-btn warning" disabled={pending || !activeCase} onClick={() => decideAll('rejected')}>
            <AlertTriangle size={13} />Missed-intended
          </button>
          <button className="v-btn" disabled={pending || !activeCase} onClick={() => decideAll('rejected')}>
            <CircleDot size={13} />Add to todo
          </button>
          <button className="v-btn ghost" disabled={pending || !activeCase} onClick={() => decideAll('snoozed')}>
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
        onApprove={(layer) => decide(layer, 'approved')}
        onReject={(layer) => decide(layer, 'rejected')}
      />
    </div>
  );
}

function StatusChipFor({ status }: { status: CaseStatus }) {
  const labels: Record<CaseStatus, string> = {
    regression: 'Regression', done: 'Done', missed: 'Missed', unknown: 'Unknown',
  };
  return <span className={`v-chip ${status}`}><span className="dot" />{labels[status]}</span>;
}

interface CaseSidebarProps {
  groupedByArea: { area: AreaLite | null; rows: CaseRow[] }[];
  activeId: string | null;
  onPick: (id: string) => void;
}

function CaseSidebar({ groupedByArea, activeId, onPick }: CaseSidebarProps) {
  return (
    <div style={{ width: 260, background: 'var(--c-white)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={13} />
        <span className="label" style={{ fontSize: 10 }}>cases · group by area</span>
        <span style={{ flex: 1 }} />
        <Filter size={13} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groupedByArea.map((g, i) => (
          <div key={g.area?.id ?? `g${i}`}>
            <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-soft)', borderBottom: '1px solid var(--border)' }}>
              <ChevronDown size={11} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{g.area?.name ?? 'Unscoped'}</span>
              <span className="label" style={{ fontSize: 9, marginLeft: 'auto' }}>{g.rows.length}</span>
            </div>
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
                  <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, background: dotColor }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.test?.name ?? 'Unknown test'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                      {row.step.evidence.slice(0, 3).map((e) => (
                        <span key={e.layer} className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{e.layer}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparePane({ tab, step }: { tab: CompareTab; step: StepComparison | null }) {
  if (!step) {
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
        Pick a case to compare.
      </div>
    );
  }

  if (tab === 'visual') {
    const visual = step.layers?.visual;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-white)' }}>
          <div className="v-tabs">
            <button className="v-tab active">Slider</button>
            <button className="v-tab">Side by side</button>
            <button className="v-tab">Overlay</button>
            <button className="v-tab">Onion</button>
          </div>
          <span style={{ flex: 1 }} />
          {visual && <span className="v-chip regression"><span className="dot" />{visual.pixelDifference} px · {visual.percentageDifference ?? '?'}%</span>}
          <button className="v-btn sm"><Layers size={11} />Regions</button>
        </div>
        <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          <div className="v-card" style={{ width: '100%', height: '100%', padding: 0, position: 'relative', overflow: 'hidden' }}>
            <div className="v-thumb" style={{ width: '100%', height: '100%' }}>
              <span className="v-region" style={{ top: '20%', left: '14%', width: '38%', height: '8%' }} />
              <span className="v-region" style={{ top: '38%', left: '14%', width: '60%', height: '6%' }} />
              <span className="v-region" style={{ top: '50%', left: '14%', width: '40%', height: '6%' }} />
            </div>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '54%', width: 2, background: 'var(--c-teal)' }}>
              <div style={{ position: 'absolute', top: '50%', left: -12, width: 26, height: 26, borderRadius: '50%', background: 'var(--c-white)', border: '2px solid var(--c-teal)', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MoveHorizontal size={12} />
              </div>
            </div>
            <div style={{ position: 'absolute', top: 8, left: 12 }} className="label">baseline</div>
            <div style={{ position: 'absolute', top: 8, right: 12 }} className="label">current</div>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'dom') {
    const dom = step.layers?.dom;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: 14, gap: 10, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ flex: 1, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--fg-2)' }}>
          {dom ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(dom, null, 2).slice(0, 1200)}</pre>
          ) : (
            <span className="label">No DOM diff for this step</span>
          )}
        </div>
        <div className="v-card" style={{ width: 220, padding: 12 }}>
          <div className="label">Selector</div>
          <div className="mono" style={{ fontSize: 11, marginTop: 6, color: 'var(--fg-1)' }}>—</div>
          <div style={{ marginTop: 14 }} className="label">Changes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, fontSize: 11 }}>
            <span className="v-chip done"><span className="dot" />added</span>
            <span className="v-chip regression"><span className="dot" />removed</span>
            <span className="v-chip missed"><span className="dot" />attrs</span>
          </div>
          <button className="v-btn sm" style={{ marginTop: 12, width: '100%' }}><Eye size={11} />Highlight</button>
        </div>
      </div>
    );
  }

  if (tab === 'network') {
    const net = step.layers?.network;
    const rows: Array<[string, string, string, string]> = [];
    if (net) {
      for (const e of net.newClientErrors.slice(0, 5)) rows.push(['new', `${e.method} ${e.url}`, String(e.status), 'regression']);
      for (const e of net.newServerErrors.slice(0, 5)) rows.push(['new', `${e.method} ${e.url}`, String(e.status), 'regression']);
      for (const e of net.statusFlips.slice(0, 5)) rows.push(['Δ', `${e.method} ${e.url}`, `${e.from}→${e.to}`, 'missed']);
    }
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 9 }}>Δ</span>
            <span className="label" style={{ fontSize: 9 }}>Request</span>
            <span className="label" style={{ fontSize: 9 }}>Status</span>
          </div>
          {rows.length === 0 && <div style={{ padding: 12 }} className="label">No network deltas captured</div>}
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center', fontSize: 12 }}>
              <span className={'v-chip ' + r[3]} style={{ fontSize: 9, padding: '1px 6px' }}>{r[0]}</span>
              <span className="mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[1]}</span>
              <span className="mono" style={{ fontSize: 11 }}>{r[2]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'console') {
    const con = step.layers?.consoleDiff;
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
        <div className="v-card" style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.85 }}>
          {!con && <span className="label">No console diff captured</span>}
          {con?.newFingerprints.slice(0, 8).map((fp, i) => (
            <div key={i}>
              <span className="v-chip regression" style={{ fontSize: 9 }}>NEW · ×{fp.count}</span>{' '}
              <span style={{ color: 'var(--c-red)' }}>{fp.sample}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'a11y') {
    const a = step.layers?.a11y;
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          {!a && <div style={{ padding: 12 }} className="label">No a11y diff captured</div>}
          {a?.newViolations.slice(0, 12).map((v, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px', padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center' }}>
              <span className="v-chip regression" style={{ fontSize: 9 }}>new</span>
              <span style={{ fontWeight: 500 }}>{v.id}</span>
              <span className="v-chip" style={{ fontSize: 9 }}>{v.impact}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'perf') {
    const p = step.layers?.perf;
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {!p && <div className="label">No perf diff captured</div>}
          {p?.deltas.slice(0, 12).map((d, i) => (
            <div key={i} className="v-card" style={{ padding: 14 }}>
              <div className="label">{d.metric.toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>{d.current.toFixed(d.metric === 'cls' ? 2 : 0)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <span className={'v-chip ' + (d.budgetBreached || d.drifted ? 'missed' : 'done')} style={{ fontSize: 9 }}>
                  {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(d.metric === 'cls' ? 2 : 0)}
                </span>
                {d.budgetBreached && <span className="label" style={{ fontSize: 9 }}>budget</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'url') {
    const u = step.layers?.url;
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)' }}>
        <div className="v-card" style={{ padding: 12 }}>
          <div className="label">URL trajectory</div>
          <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 2 }}>
            {!u && <span className="label">No URL trajectory diff</span>}
            {u?.divergedSteps.slice(0, 10).map((d, i) => (
              <div key={i}>
                {d.baselineUrl} → <span style={{ color: 'var(--c-red)' }}>{d.currentUrl}</span>{' '}
                {d.redirectChainChanged && <span className="v-chip missed" style={{ fontSize: 9 }}>+1 redirect</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'variable') {
    const v = step.layers?.variable;
    return (
      <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto' }}>
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          {!v && <div style={{ padding: 12 }} className="label">No variable diff</div>}
          {v?.changes.slice(0, 16).map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center' }}>
              <span className="mono">{c.path}</span>
              <span className="mono" style={{ color: 'var(--fg-2)' }}>{String(c.baseline ?? '—')}</span>
              <span className="mono" style={{ color: 'var(--fg-1)' }}>{String(c.current ?? '—')}</span>
              <span className="v-chip" style={{ fontSize: 9 }}>{c.tier.replace('-', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <div style={{ flex: 1 }} />;
}

interface IntentPanelProps {
  open: boolean;
  onClose: () => void;
  activeCase: CaseRow | null;
  onApprove: (layer: EvidenceLayer) => void;
  onReject: (layer: EvidenceLayer) => void;
}

function IntentPanel({ open, onClose, activeCase, onApprove, onReject }: IntentPanelProps) {
  if (!open) return null;
  const evidence = activeCase?.step.evidence ?? [];
  return (
    <div style={{ width: 290, background: 'var(--c-white)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Github size={14} />
        <span className="label">linked intent</span>
        <span style={{ flex: 1 }} />
        <button className="v-btn ghost icon" onClick={onClose}><X size={13} /></button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
        <div className="v-card" style={{ padding: 12, background: 'var(--c-soft)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="v-chip info" style={{ fontSize: 10 }}>no issue linked</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>
            Link a GitHub issue describing the expected behavior. Sub-criteria checks then run automatically against this case.
          </div>
        </div>

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
                  <button className="v-btn sm" onClick={() => onApprove(e.layer)}>
                    <Check size={11} />Expected
                  </button>
                  <button className="v-btn sm" onClick={() => onReject(e.layer)}>
                    <AlertTriangle size={11} />Needs fix
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        <div className="label" style={{ marginTop: 6 }}>actions on case</div>
        <button className="v-btn" style={{ justifyContent: 'flex-start' }} disabled>
          <LinkIcon size={12} />Link issue
        </button>
        <button className="v-btn" style={{ justifyContent: 'flex-start' }} disabled>
          <GitPullRequest size={12} />Open in GitHub
        </button>
        <button className="v-btn" style={{ justifyContent: 'flex-start' }} disabled>
          <CircleDot size={12} />Create sub-issue from diff
        </button>
      </div>
    </div>
  );
}
