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
import { closeIssueForCase } from '@/server/actions/verify-issues';
import { IssuePickerDialog } from '@/components/verify/issue-picker-dialog';
import type {
  StepComparison,
  StepLayerFeedback,
  EvidenceLayer,
  StepIssueState,
} from '@/lib/db/schema';
import { deriveCaseStatus, type CaseStatus } from '@/lib/verify/case-status';
import type { VisualDiffLite, TestResultLite } from './board-focus-client';

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
  testResultById: Map<string, TestResultLite>;
  statusFilter: Set<CaseStatus>;
  selectedStepId: string | null;
  onSelect: (id: string) => void;
  onMarkDecision: (stepId: string, status: 'approved' | 'rejected' | 'snoozed') => void;
  /** Open the issue picker dialog for a specific case. The dialog itself is
   *  rendered once at the BoardFocusClient level. */
  onOpenIssuePicker: (stepId: string) => void;
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

type LayerState = 'diff' | 'clean' | 'absent';

/**
 * Classify each layer for the active step:
 *   - diff:   evidence row present in step.evidence  → render diff details
 *   - clean:  layer was captured on the test result, no evidence  → render
 *             real captured data + a "no diff" affordance
 *   - absent: layer was never captured by the test run  → tab disabled
 */
function classifyLayer(
  layer: EvidenceLayer,
  step: StepComparison,
  result: TestResultLite | null,
  visual: VisualDiffLite | null,
): LayerState {
  if (step.evidence.some((e) => e.layer === layer)) return 'diff';
  switch (layer) {
    case 'visual':
      // Visual is captured whenever a visual diff record exists for the step
      // (even with 0 px difference) or a screenshot was taken.
      if (visual?.currentImagePath || visual?.baselineImagePath) return 'clean';
      return 'absent';
    case 'dom':
      return result?.domSnapshot ? 'clean' : 'absent';
    case 'network':
      return result?.networkRequests != null ? 'clean' : 'absent';
    case 'console':
      return result?.consoleErrors != null ? 'clean' : 'absent';
    case 'a11y':
      return result?.a11yViolations != null || result?.a11yPassesCount != null ? 'clean' : 'absent';
    case 'perf':
      return result?.webVitals != null ? 'clean' : 'absent';
    case 'url':
      return result?.urlTrajectory != null ? 'clean' : 'absent';
    case 'variable':
      return (result?.extractedVariables != null || result?.assignedVariables != null) ? 'clean' : 'absent';
  }
}

interface CaseRow {
  step: StepComparison;
  test: TestLite | null;
  area: AreaLite | null;
  status: CaseStatus;
  feedback: StepLayerFeedback[];
  visual: VisualDiffLite | null;
  result: TestResultLite | null;
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
      const result = step.testResultId ? props.testResultById.get(step.testResultId) ?? null : null;
      return { step, test, area, status, feedback: stepFb, visual, result };
    });
  }, [props.steps, props.feedback, props.testById, props.areaById, props.changedAreaIds, props.visualByStepKey, props.testResultById]);

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

  // Issue picker is hoisted to BoardFocusClient so the same dialog covers
  // both the Board and Focus surfaces.
  const handleOpenPicker = () => {
    if (activeCase) props.onOpenIssuePicker(activeCase.step.id);
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
            className={'v-btn ' + (intentOpen ? 'tinted' : '')}
            onClick={() => setIntentOpen((v) => !v)}
            aria-pressed={intentOpen}
          >
            <Github size={13} />{intentOpen ? 'Hide intent' : 'Show intent'}
          </button>
        </div>

        {/* Signals strip — at-a-glance summary of every non-visual layer's
            delta. Click a chip to jump to that layer's compare tab.
        */}
        {activeCase && (
          <SignalsStrip
            step={activeCase.step}
            visual={activeCase.visual}
            result={activeCase.result}
            activeTab={tab}
            onJump={(layer) => setTab(layer)}
          />
        )}

        {/* Compare-kind tabs — 3 states:
              diff   → red/amber chip with delta (real diff present)
              clean  → green ✓ (layer captured, no diff)
              absent → dim (layer not captured at all by this run)
        */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
          {COMPARE_TABS.map((k) => {
            const isActive = tab === k.id;
            const layerState: LayerState = activeCase
              ? classifyLayer(k.id, activeCase.step, activeCase.result, activeCase.visual)
              : 'absent';
            const delta = activeCase?.step ? layerDelta(activeCase.step, k.id) : null;
            const isClickable = layerState !== 'absent';
            const tabBorder = isActive
              ? 'color-mix(in oklab, var(--c-teal) 22%, transparent)'
              : 'var(--border)';
            const tabColor = isActive
              ? '#1F7B66'
              : layerState === 'absent' ? 'var(--fg-4)' : 'var(--fg-2)';
            return (
              <button
                key={k.id}
                onClick={() => isClickable && setTab(k.id)}
                disabled={!isClickable}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  cursor: isClickable ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isActive ? 'color-mix(in oklab, var(--c-teal) 12%, white)' : 'transparent',
                  border: `1px solid ${tabBorder}`,
                  color: tabColor,
                  fontWeight: isActive ? 600 : 400,
                  opacity: layerState === 'absent' ? 0.5 : 1,
                }}
                aria-label={`${k.name} — ${layerState === 'diff' ? 'diff' : layerState === 'clean' ? 'no diff (captured)' : 'not captured'}`}
              >
                <span>{k.name}</span>
                {layerState === 'diff' && delta !== null && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{delta}</span>
                )}
                {layerState === 'clean' && (
                  <span
                    aria-hidden
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'color-mix(in oklab, var(--c-teal) 16%, white)',
                      color: '#1F7B66',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, lineHeight: 1, fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Compare pane */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ComparePane
            tab={tab}
            step={activeCase?.step ?? null}
            visual={activeCase?.visual ?? null}
            result={activeCase?.result ?? null}
            layerState={
              activeCase
                ? classifyLayer(tab, activeCase.step, activeCase.result, activeCase.visual)
                : 'absent'
            }
          />
        </div>

        {/* Bottom action bar — Wired to real decideLayer for every layer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="v-btn success" disabled={pending || !activeCase} onClick={() => activeCase && props.onMarkDecision(activeCase.step.id, 'approved')}>
            <Check size={13} />Mark intended
          </button>
          <button className="v-btn warning" disabled={pending || !activeCase} onClick={() => activeCase && props.onMarkDecision(activeCase.step.id, 'rejected')}>
            <AlertTriangle size={13} />Missed-intended
          </button>
          {!activeCase?.step.githubIssueUrl && (
            <button className="v-btn" disabled={pending || !activeCase} onClick={handleOpenPicker}>
              <Plus size={13} />Link or file issue
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
        onOpenPicker={handleOpenPicker}
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
    regression: 'Broken', done: 'Verified', missed: 'Missed', unknown: 'Unsorted',
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

const SIGNAL_LAYERS: ReadonlyArray<{ layer: EvidenceLayer; label: string }> = [
  { layer: 'dom',      label: 'DOM' },
  { layer: 'network',  label: 'NETWORK' },
  { layer: 'console',  label: 'CONSOLE' },
  { layer: 'a11y',     label: 'A11Y' },
  { layer: 'perf',     label: 'PERF' },
  { layer: 'url',      label: 'URL' },
  { layer: 'variable', label: 'VARS' },
];

function SignalsStrip({
  step,
  visual,
  result,
  activeTab,
  onJump,
}: {
  step: StepComparison;
  visual: VisualDiffLite | null;
  result: TestResultLite | null;
  activeTab: EvidenceLayer;
  onJump: (layer: EvidenceLayer) => void;
}) {
  const chips = SIGNAL_LAYERS
    .map(({ layer, label }) => {
      const ev = step.evidence.find((e) => e.layer === layer) ?? null;
      const state = classifyLayer(layer, step, result, visual);
      if (state === 'absent' && !ev) return null;
      const delta = layerDelta(step, layer);
      const tone = ev?.signal === 'high'
        ? 'regression'
        : ev?.signal === 'medium'
          ? 'missed'
          : 'unknown';
      const text = state === 'diff' && delta
        ? delta
        : state === 'clean'
          ? 'same'
          : '—';
      return { layer, label, tone, text };
    })
    .filter((x): x is { layer: EvidenceLayer; label: string; tone: string; text: string } => x !== null);

  if (chips.length === 0) return null;

  return (
    <div
      style={{
        padding: '8px 16px',
        background: 'var(--c-white)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        overflowX: 'auto',
      }}
      role="toolbar"
      aria-label="Layer signals"
    >
      <span className="label" style={{ fontSize: 9, marginRight: 4, flexShrink: 0 }}>
        Signals
      </span>
      {chips.map(({ layer, label, tone, text }) => {
        const isActive = activeTab === layer;
        return (
          <button
            key={layer}
            onClick={() => onJump(layer)}
            className={`v-chip ${tone}`}
            style={{
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 10,
              outline: isActive ? '1px solid color-mix(in oklab, var(--c-teal) 35%, transparent)' : 'none',
              outlineOffset: 1,
            }}
            title={`Jump to ${label} tab`}
          >
            <span className="dot" />
            {label} · {text}
          </button>
        );
      })}
    </div>
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
        <Search size={13} aria-hidden />
        <span className="label" style={{ fontSize: 10 }}>
          {total} cases · grouped by area
        </span>
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
  result: TestResultLite | null;
  layerState: LayerState;
}

function ComparePane({ tab, step, visual, result, layerState }: ComparePaneProps) {
  if (!step) {
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
        Pick a case to compare.
      </div>
    );
  }

  if (layerState === 'absent') {
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="v-card" style={{ padding: 24, textAlign: 'center', maxWidth: 360 }}>
          <span className="label">{tab} not captured</span>
          <p style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-2)' }}>
            This test run didn&apos;t collect {tab} data. Enable {tab} capture in Playwright settings to see it here.
          </p>
        </div>
      </div>
    );
  }

  // diff or clean — render the layer-specific pane and let it differentiate.
  if (tab === 'visual') return <VisualPane step={step} visual={visual} clean={layerState === 'clean'} />;
  if (tab === 'dom') return <DomPane step={step} visual={visual} result={result} clean={layerState === 'clean'} />;
  if (tab === 'network') return <NetworkPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'console') return <ConsolePane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'a11y') return <A11yPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'perf') return <PerfPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'url') return <UrlPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'variable') return <VariablePane step={step} result={result} clean={layerState === 'clean'} />;
  return null;
}

function CleanBanner({ message }: { message: string }) {
  return (
    <div className="v-chip done" style={{ fontSize: 10, alignSelf: 'flex-start' }}>
      <span className="dot" />
      {message}
    </div>
  );
}

function VisualPane({ step, visual, clean }: { step: StepComparison; visual: VisualDiffLite | null; clean: boolean }) {
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
        {clean && <CleanBanner message="No visual diff — screenshots match baseline" />}
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
            {diffSrc ? <ImagePanel label="diff" src={diffSrc} /> : <ImagePanel label="current" src={currentSrc} />}
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

function DomPane({
  step,
  visual,
  result,
  clean,
}: {
  step: StepComparison;
  visual: VisualDiffLite | null;
  result: TestResultLite | null;
  clean: boolean;
}) {
  const dom = step.layers?.dom;
  const snapshot = result?.domSnapshot;
  const elementCount = Array.isArray(snapshot?.elements) ? snapshot.elements.length : 0;
  const screenshotSrc = visual?.currentImagePath ?? visual?.diffImagePath ?? visual?.baselineImagePath ?? null;

  // Image natural dimensions are the same coordinate space as the bboxes
  // (both come from the same Playwright page). We measure on load and use
  // that as the denominator for `%` overlay positioning.
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  type OverlayRect = { x: number; y: number; w: number; h: number; tone: 'added' | 'removed' | 'changed'; selector: string; tag: string };
  const overlays: OverlayRect[] = [];
  if (dom && imgSize) {
    for (const el of dom.removed) overlays.push(rectFor(el, 'removed', imgSize.w, imgSize.h));
    for (const el of dom.added) overlays.push(rectFor(el, 'added', imgSize.w, imgSize.h));
    for (const c of dom.changed) overlays.push(rectFor(c.current, 'changed', imgSize.w, imgSize.h));
  }

  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`No DOM diff — ${elementCount} elements captured, identical structure`} />}

      {/* Visual overlay — boxes drawn on the current screenshot at each
          changed element's bounding box. Mirrors the visual-diff Regions UI. */}
      {dom && screenshotSrc && (dom.added.length + dom.removed.length + dom.changed.length) > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label" style={{ fontSize: 10 }}>DOM overlay</span>
            <span className="v-chip done" style={{ fontSize: 9 }}>+{dom.added.length} added</span>
            <span className="v-chip regression" style={{ fontSize: 9 }}>−{dom.removed.length} removed</span>
            <span className="v-chip missed" style={{ fontSize: 9 }}>~{dom.changed.length} changed</span>
            <span style={{ flex: 1 }} />
            {imgSize && <span className="label" style={{ fontSize: 9 }}>{imgSize.w}×{imgSize.h}</span>}
          </div>
          <div style={{ position: 'relative', background: 'white', maxHeight: 600, overflow: 'auto' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshotSrc}
              alt="current"
              onLoad={(e) => {
                const img = e.currentTarget;
                setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {overlays.map((r, i) => {
                const color = r.tone === 'added' ? 'var(--c-teal)' : r.tone === 'removed' ? 'var(--c-red)' : 'var(--c-amber)';
                const isHovered = hovered === i;
                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      position: 'absolute',
                      left: `${r.x}%`,
                      top: `${r.y}%`,
                      width: `${r.w}%`,
                      height: `${r.h}%`,
                      border: `2px solid ${color}`,
                      background: `color-mix(in oklab, ${color} 14%, transparent)`,
                      borderRadius: 2,
                      pointerEvents: 'auto',
                      cursor: 'help',
                      boxShadow: isHovered ? `0 0 0 2px color-mix(in oklab, ${color} 35%, transparent)` : 'none',
                    }}
                    title={`${r.tone}: <${r.tag}> ${r.selector}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Element list (kept below the overlay so reviewers can correlate). */}
      {dom && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 10 }}>Element changes ({dom.added.length + dom.removed.length + dom.changed.length})</span>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {dom.removed.slice(0, 30).map((el, i) => (
              <DomRow key={`r${i}`} variant="removed" tag={el.tag} selector={el.selectors[0]?.value ?? ''} />
            ))}
            {dom.added.slice(0, 30).map((el, i) => (
              <DomRow key={`a${i}`} variant="added" tag={el.tag} selector={el.selectors[0]?.value ?? ''} />
            ))}
            {dom.changed.slice(0, 30).map((c, i) => (
              <DomRow
                key={`c${i}`}
                variant="changed"
                tag={c.current.tag}
                selector={c.current.selectors[0]?.value ?? ''}
                changeKinds={c.changes}
              />
            ))}
          </div>
        </div>
      )}

      {!dom && snapshot && (
        <div className="v-card" style={{ padding: 12 }}>
          <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>Captured snapshot · {elementCount} elements</div>
          <pre className="mono" style={{ margin: 0, fontSize: 11, lineHeight: 1.6, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', color: 'var(--fg-2)' }}>
{JSON.stringify(snapshot, null, 2).slice(0, 6000)}
          </pre>
        </div>
      )}
    </div>
  );
}

function rectFor(
  el: { boundingBox?: { x: number; y: number; width: number; height: number }; tag: string; selectors: Array<{ value: string }> },
  tone: 'added' | 'removed' | 'changed',
  vw: number,
  vh: number,
): { x: number; y: number; w: number; h: number; tone: 'added' | 'removed' | 'changed'; selector: string; tag: string } {
  const b = el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: vw > 0 ? (b.x / vw) * 100 : 0,
    y: vh > 0 ? (b.y / vh) * 100 : 0,
    w: vw > 0 ? (b.width / vw) * 100 : 0,
    h: vh > 0 ? (b.height / vh) * 100 : 0,
    tone,
    selector: el.selectors[0]?.value ?? '',
    tag: el.tag,
  };
}

function DomRow({
  variant,
  tag,
  selector,
  changeKinds,
}: {
  variant: 'added' | 'removed' | 'changed';
  tag: string;
  selector: string;
  changeKinds?: string[];
}) {
  const cls = variant === 'added' ? 'done' : variant === 'removed' ? 'regression' : 'missed';
  const sign = variant === 'added' ? '+' : variant === 'removed' ? '−' : '~';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}
    >
      <span className={`v-chip ${cls}`} style={{ fontSize: 9, padding: '0 5px', justifySelf: 'start' }}>{sign}</span>
      <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selector}>
        <span style={{ color: 'var(--fg-3)' }}>{`<${tag}>`}</span>{' '}
        <span style={{ color: 'var(--fg-1)' }}>{selector}</span>
      </span>
      <span style={{ display: 'flex', gap: 3 }}>
        {changeKinds?.map((k) => (
          <span key={k} className="v-chip" style={{ fontSize: 9, padding: '0 5px' }}>{k}</span>
        ))}
      </span>
    </div>
  );
}

function NetworkPane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const net = step.layers?.network;
  const requests = result?.networkRequests ?? [];
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`No network diff — ${requests.length} request${requests.length === 1 ? '' : 's'} captured, all match baseline`} />}
      {net && (
        <>
          <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <span className="label" style={{ fontSize: 9 }}>Δ</span>
              <span className="label" style={{ fontSize: 9 }}>Request</span>
              <span className="label" style={{ fontSize: 9 }}>Status</span>
            </div>
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
          <div className="label" style={{ padding: '0 4px' }}>
            +{net.added} new · {net.removed} removed · {net.changed} changed · {net.newErrorCount} new errors
          </div>
        </>
      )}
      {/* Always render the captured request list when we have it. */}
      {requests.length > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label" style={{ fontSize: 10 }}>Captured requests · {requests.length}</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {requests.slice(0, 200).map((r, i) => {
              const status = (r as { status?: number; statusCode?: number }).status ?? (r as { statusCode?: number }).statusCode ?? null;
              const method = (r as { method?: string }).method ?? 'GET';
              const url = (r as { url?: string }).url ?? '';
              const duration = (r as { durationMs?: number; timing?: { duration?: number } }).durationMs ?? (r as { timing?: { duration?: number } }).timing?.duration ?? null;
              const size = (r as { responseSize?: number; size?: number; bytes?: number }).responseSize ?? (r as { size?: number }).size ?? (r as { bytes?: number }).bytes ?? null;
              const cls = status != null && status >= 400 ? 'regression' : 'done';
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px 80px 80px', padding: '6px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center', fontSize: 11 }}>
                  <span className="mono" style={{ color: 'var(--fg-3)' }}>{method}</span>
                  <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-1)' }}>{url}</span>
                  {status != null ? (
                    <span className={`v-chip ${cls}`} style={{ fontSize: 9, padding: '1px 6px', justifySelf: 'start' }}>{status}</span>
                  ) : <span />}
                  <span className="mono" style={{ color: 'var(--fg-2)' }}>{duration != null ? `${Math.round(duration)}ms` : '—'}</span>
                  <span className="mono" style={{ color: 'var(--fg-2)' }}>{size != null ? formatBytes(size) : '—'}</span>
                </div>
              );
            })}
            {requests.length > 200 && (
              <div className="label" style={{ padding: 8, textAlign: 'center', fontSize: 10 }}>+{requests.length - 200} more not shown</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}kB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
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

function ConsolePane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const con = step.layers?.consoleDiff;
  const messages = result?.consoleErrors ?? [];
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={messages.length === 0 ? 'No console messages captured' : `${messages.length} console message${messages.length === 1 ? '' : 's'} — all match baseline`} />}
      {con && (con.newFingerprints.length > 0 || con.disappeared.length > 0) && (
        <div className="v-card" style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.85 }}>
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
      )}
      {messages.length > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 10 }}>Captured console output · {messages.length}</span>
          </div>
          <div style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6, maxHeight: 400, overflowY: 'auto', color: 'var(--fg-2)' }}>
            {messages.slice(0, 200).map((m, i) => (
              <div key={i} style={{ paddingBottom: 2 }}>{m}</div>
            ))}
            {messages.length > 200 && <div className="label" style={{ paddingTop: 6, fontSize: 10 }}>+{messages.length - 200} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function A11yPane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const a = step.layers?.a11y;
  const violations = result?.a11yViolations ?? [];
  const passes = result?.a11yPassesCount ?? null;
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`No new a11y issues — ${violations.length} violation${violations.length === 1 ? '' : 's'} captured${passes != null ? `, ${passes} rules passed` : ''}`} />}
      {a && (
        <>
          <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <span className="label" style={{ fontSize: 10 }}>New violations vs baseline</span>
            </div>
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
          <div className="label" style={{ padding: '0 4px' }}>
            crit {a.newBySeverity.critical} · ser {a.newBySeverity.serious} · mod {a.newBySeverity.moderate} · min {a.newBySeverity.minor}
          </div>
        </>
      )}
      {violations.length > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 10 }}>Captured violations · {violations.length}{passes != null ? ` · ${passes} passes` : ''}</span>
          </div>
          {violations.slice(0, 50).map((v, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 70px', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', gap: 8 }}>
              <span className="v-chip" style={{ fontSize: 9 }}>{v.impact}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.description}>{v.id}</span>
              {v.wcagLevel && <span className="v-chip info" style={{ fontSize: 9, justifySelf: 'start' }}>WCAG {v.wcagLevel}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PerfPane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const p = step.layers?.perf;
  const samples = useMemo(() => result?.webVitals ?? [], [result]);
  // Aggregate samples to one value per metric (mean) for the captured-no-diff view.
  const aggregated = useMemo(() => {
    if (samples.length === 0) return [] as Array<{ metric: string; value: number }>;
    const acc: Record<string, { sum: number; n: number }> = {};
    for (const s of samples) {
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'number') {
          if (!acc[k]) acc[k] = { sum: 0, n: 0 };
          acc[k].sum += v;
          acc[k].n += 1;
        }
      }
    }
    return Object.entries(acc).map(([metric, { sum, n }]) => ({ metric, value: sum / n }));
  }, [samples]);

  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`No perf drift — ${samples.length} sample${samples.length === 1 ? '' : 's'} captured, all within budget`} />}
      {p && p.deltas.length > 0 && (
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
      )}
      {aggregated.length > 0 && (
        <div className="v-card" style={{ padding: 12 }}>
          <div className="label" style={{ marginBottom: 6, fontSize: 10 }}>Captured Web Vitals · mean of {samples.length} sample{samples.length === 1 ? '' : 's'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {aggregated.map(({ metric, value }) => (
              <div key={metric} style={{ borderRadius: 6, background: 'var(--c-soft)', padding: '8px 10px' }}>
                <div className="label" style={{ fontSize: 9 }}>{metric.toUpperCase()}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
                  {metric === 'cls' ? value.toFixed(3) : Math.round(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UrlPane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const u = step.layers?.url;
  const trajectory = result?.urlTrajectory ?? [];
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
      {clean && <CleanBanner message={`No URL divergence — ${trajectory.length} URL${trajectory.length === 1 ? '' : 's'} captured, trajectory matches baseline`} />}
      {u && (
        <div className="v-card" style={{ padding: 12 }}>
          <div className="label">Diverged steps ({u.divergedSteps.length} of {u.totalStepsCompared})</div>
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
      )}
      {trajectory.length > 0 && (
        <div className="v-card" style={{ padding: 12 }}>
          <div className="label" style={{ marginBottom: 6, fontSize: 10 }}>Captured URL trajectory · {trajectory.length} step{trajectory.length === 1 ? '' : 's'}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.8 }}>
            {trajectory.map((t, i) => {
              const url = (t as { finalUrl?: string; url?: string }).finalUrl ?? (t as { url?: string }).url ?? '';
              const stepIndex = (t as { stepIndex?: number }).stepIndex ?? i;
              const redirectChain = (t as { redirectChain?: string[] }).redirectChain ?? [];
              return (
                <div key={i} style={{ paddingBottom: 4, borderBottom: i < trajectory.length - 1 ? '1px dashed var(--border)' : 'none', marginBottom: 4 }}>
                  <div><span className="label" style={{ fontSize: 9, marginRight: 6 }}>step {stepIndex}</span><span style={{ color: 'var(--fg-1)' }}>{url}</span></div>
                  {redirectChain.length > 1 && (
                    <div className="label" style={{ fontSize: 9, paddingLeft: 18 }}>+ {redirectChain.length - 1} redirect{redirectChain.length - 1 === 1 ? '' : 's'}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function VariablePane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const v = step.layers?.variable;
  const extracted = result?.extractedVariables ?? {};
  const assigned = result?.assignedVariables ?? {};
  const all = { ...assigned, ...extracted };
  const keys = Object.keys(all);
  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={keys.length === 0 ? 'No variables captured' : `${keys.length} variable${keys.length === 1 ? '' : 's'} captured — all match baseline`} />}
      {v && v.changes.length > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 10 }}>Variable diff</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 9 }}>path</span>
            <span className="label" style={{ fontSize: 9 }}>baseline</span>
            <span className="label" style={{ fontSize: 9 }}>current</span>
            <span className="label" style={{ fontSize: 9 }}>tier</span>
          </div>
          {v.changes.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.path}</span>
              <span className="mono" style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(c.baseline ?? '—')}</span>
              <span className="mono" style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(c.current ?? '—')}</span>
              <span className="v-chip" style={{ fontSize: 9 }}>{c.tier.replace('-', ' ')}</span>
            </div>
          ))}
        </div>
      )}
      {keys.length > 0 && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 10 }}>Captured variables · {keys.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="label" style={{ fontSize: 9 }}>name</span>
            <span className="label" style={{ fontSize: 9 }}>value</span>
            <span className="label" style={{ fontSize: 9 }}>source</span>
          </div>
          {keys.slice(0, 100).map((k) => {
            const source = k in extracted ? 'extract' : 'assign';
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', padding: '6px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                <span className="mono" style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{all[k]}</span>
                <span className="v-chip" style={{ fontSize: 9 }}>{source}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface IntentPanelProps {
  open: boolean;
  onClose: () => void;
  activeCase: CaseRow | null;
  onApproveLayer: (layer: EvidenceLayer) => void;
  onRejectLayer: (layer: EvidenceLayer) => void;
  /** Open the issue picker dialog (browse + create). */
  onOpenPicker: () => void;
  onCloseIssue: () => void;
}

function IntentPanel({ open, onClose, activeCase, onApproveLayer, onRejectLayer, onOpenPicker, onCloseIssue }: IntentPanelProps) {
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
          <button className="v-btn" style={{ justifyContent: 'flex-start' }} onClick={onOpenPicker}>
            <LinkIcon size={12} />Browse or file issue
          </button>
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
            <button className="v-btn ghost" style={{ justifyContent: 'flex-start' }} onClick={onOpenPicker}>
              <GitPullRequest size={12} />Re-link to a different issue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
