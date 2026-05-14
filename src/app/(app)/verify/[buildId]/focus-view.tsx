'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertOctagon,
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
  Settings,
  X,
  CheckCircle as CheckCircleIcon,
  Plus,
} from 'lucide-react';
import { closeIssueForCase, createIssueForCase, fetchLinkedIssueForCase } from '@/server/actions/verify-issues';
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
  /** Per-evidence decision (Expected / Needs fix). Owns optimistic update +
   *  persistence at the BoardFocusClient level so the panel state never
   *  drifts from the board. */
  onDecideLayer: (stepId: string, layer: EvidenceLayer, status: 'approved' | 'rejected' | 'snoozed') => void;
  /** Open the issue picker dialog for a specific case. The dialog itself is
   *  rendered once at the BoardFocusClient level. */
  onOpenIssuePicker: (stepId: string) => void;
  /** Pull a fresh /verify-status snapshot. Used after Close-issue so the
   *  chip flips to `closed` without a hard reload. */
  onRefresh?: () => void;
}

type CompareTab = EvidenceLayer | 'text' | 'run';

const COMPARE_TABS: { id: CompareTab; name: string }[] = [
  { id: 'run',      name: 'Run' },
  { id: 'visual',   name: 'Visual' },
  { id: 'text',     name: 'Text' },
  { id: 'dom',      name: 'DOM' },
  { id: 'network',  name: 'Network' },
  { id: 'console',  name: 'Console' },
  { id: 'a11y',     name: 'A11y' },
  { id: 'perf',     name: 'Perf' },
  { id: 'url',      name: 'URL' },
  { id: 'variable', name: 'Variables' },
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
  layer: CompareTab,
  step: StepComparison,
  result: TestResultLite | null,
  visual: VisualDiffLite | null,
): LayerState {
  if (layer !== 'text' && layer !== 'run' && step.evidence.some((e) => e.layer === layer)) return 'diff';
  switch (layer) {
    case 'run':
      if (!result?.status) return 'absent';
      if (result.status === 'failed') return 'diff';
      return 'clean';
    case 'visual':
      // Visual is captured whenever a visual diff record exists for the step
      // (even with 0 px difference) or a screenshot was taken.
      if (visual?.currentImagePath || visual?.baselineImagePath) return 'clean';
      return 'absent';
    case 'text': {
      const s = visual?.textDiffStatus;
      if (!s || s === 'skipped') return 'absent';
      if (s === 'changed' || s === 'baseline_only' || s === 'current_only') return 'diff';
      return 'clean';
    }
    case 'dom':
      return result?.domSnapshot ? 'clean' : 'absent';
    case 'network':
      // Capture is automatic — once the test ran, "no requests" is a clean
      // signal, not an absent layer. Same for console/perf/url below.
      if (!result?.status) return 'absent';
      return 'clean';
    case 'console':
      if (!result?.status) return 'absent';
      return 'clean';
    case 'a11y':
      // A11y requires the enableA11y toggle, so null/null means *not* run.
      return result?.a11yViolations != null || result?.a11yPassesCount != null ? 'clean' : 'absent';
    case 'perf':
      if (!result?.status) return 'absent';
      return 'clean';
    case 'url':
      if (!result?.status) return 'absent';
      return 'clean';
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
  // Issue panel is hidden by default — only opens when the reviewer takes a
  // negative action (Needs Improvement / Reject) or explicitly toggles it.
  const [intentOpen, setIntentOpen] = useState(false);
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

  const decideOneLayer = (layer: EvidenceLayer, status: 'approved' | 'rejected' | 'snoozed') => {
    if (!activeCase) return;
    props.onDecideLayer(activeCase.step.id, layer, status);
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
      props.onRefresh?.();
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
          {activeCase?.test ? (
            // Link to the test definition so reviewers can jump to the code
            // / spec / vars tabs without losing the case context.
            <a
              href={`/tests/${activeCase.test.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 14, fontWeight: 600, color: 'var(--fg-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              title={`Open test ${activeCase.test.name}`}
            >
              {activeCase.test.name}
              <ExternalLink size={11} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
            </a>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Pick a case from the sidebar
            </span>
          )}
          {activeCase && <StatusChipFor status={activeCase.status} />}
          {activeCase && <ErrorChip result={activeCase.result} />}
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
            <Github size={13} />{intentOpen ? 'Hide issue' : 'Show issue'}
          </button>
        </div>

        {/* Compare-kind tabs — 3 states:
              diff   → red/amber chip with delta (real diff present)
              clean  → green ✓ (layer captured, no diff)
              absent → dim (layer not captured at all by this run)
            The leading "Run" tab covers runner-level outcome (status,
            error, duration), so a runner exception is one click away from
            every other layer. */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
          {COMPARE_TABS.map((k) => {
            const isActive = tab === k.id;
            const layerState: LayerState = activeCase
              ? classifyLayer(k.id, activeCase.step, activeCase.result, activeCase.visual)
              : 'absent';
            // Run tab surfaces the failure message as its delta directly
            // from the test_result; other tabs use the step's layer deltas.
            const delta = k.id === 'run'
              ? (activeCase?.result?.status === 'failed'
                  ? firstLine((activeCase.result?.errorMessage ?? '').trim() || 'failed')
                  : null)
              : k.id === 'text'
                ? (() => {
                    const s = activeCase?.visual?.textDiffSummary;
                    if (!s || (s.added === 0 && s.removed === 0)) return null;
                    return `+${s.added} −${s.removed}`;
                  })()
                : activeCase?.step
                  ? layerDelta(activeCase.step, k.id)
                  : null;
            // All tabs clickable — `absent` panes explain *why* the layer
            // isn't captured + how to enable it, which is more useful than
            // a disabled button.
            const tabBorder = isActive
              ? 'color-mix(in oklab, var(--c-teal) 22%, transparent)'
              : 'var(--border)';
            const tabColor = isActive
              ? '#1F7B66'
              : layerState === 'absent' ? 'var(--fg-4)' : 'var(--fg-2)';
            return (
              <button
                key={k.id}
                onClick={() => setTab(k.id)}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isActive ? 'color-mix(in oklab, var(--c-teal) 12%, white)' : 'transparent',
                  border: `1px solid ${tabBorder}`,
                  color: tabColor,
                  fontWeight: isActive ? 600 : 400,
                  opacity: layerState === 'absent' ? 0.55 : 1,
                }}
                aria-label={`${k.name} — ${layerState === 'diff' ? 'diff' : layerState === 'clean' ? 'no diff (captured)' : 'not captured'}`}
              >
                <span>{k.name}</span>
                {/* Run tab uses a fail icon (no delta text) so the row stays
                    compact — full error lives inside the pane. Other tabs
                    keep their numeric delta. */}
                {k.id === 'run' && layerState === 'diff' && (
                  <span
                    aria-hidden
                    title={delta ?? 'Test failed'}
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'color-mix(in oklab, var(--c-red) 16%, white)',
                      color: 'var(--c-red)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, lineHeight: 1, fontWeight: 700,
                    }}
                  >
                    ✕
                  </span>
                )}
                {k.id !== 'run' && layerState === 'diff' && delta !== null && (
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--fg-3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={delta}
                  >
                    {delta}
                  </span>
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

        {/* Bottom action bar — OK / Needs Improvement / Reject. Each
            triage button reflects the case's current derived status with
            an active highlight, even when the user revisits a case already
            sorted into one of the columns. The latter two auto-open the
            Issue panel so the reviewer can compose context. */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--c-white)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(() => {
            const cur = activeCase?.status ?? null;
            const decide = (status: 'approved' | 'snoozed' | 'rejected', revealIssue: boolean) => {
              if (!activeCase) return;
              props.onMarkDecision(activeCase.step.id, status);
              if (revealIssue) setIntentOpen(true);
            };
            return (
              <>
                <TriageButton
                  label="OK"
                  icon={<Check size={13} />}
                  tone="success"
                  active={cur === 'done'}
                  disabled={pending || !activeCase}
                  onClick={() => decide('approved', false)}
                />
                <TriageButton
                  label="Needs Improvement"
                  icon={<AlertTriangle size={13} />}
                  tone="warning"
                  active={cur === 'missed'}
                  disabled={pending || !activeCase}
                  onClick={() => decide('snoozed', true)}
                />
                <TriageButton
                  label="Reject"
                  icon={<AlertOctagon size={13} />}
                  tone="danger"
                  active={cur === 'regression'}
                  disabled={pending || !activeCase}
                  onClick={() => decide('rejected', true)}
                />
              </>
            );
          })()}
          <span style={{ flex: 1 }} />
          {activeCase?.step.githubIssueUrl && activeCase.step.githubIssueState !== 'closed' && (
            <button className="v-btn ghost" disabled={pending} onClick={handleCloseIssue} style={{ minWidth: 0 }}>
              <CheckCircleIcon size={13} />Close issue
            </button>
          )}
          <span className="label">
            {activeCase?.feedback.length ?? 0} layer decision{activeCase?.feedback.length === 1 ? '' : 's'} on this case
          </span>
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
        onAfterCreate={props.onRefresh}
      />
    </div>
  );
}

function layerDelta(step: StepComparison, layer: CompareTab): string | null {
  if (layer === 'text') return null;
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

/** Triage button — visually reflects whether the case is currently in this
 *  decision state (i.e. clicking again is a no-op of the same action). The
 *  active treatment uses a stronger fill and a small ✓ marker so the user
 *  can see at a glance which decision is recorded, even after navigating
 *  away and back. */
function TriageButton({
  label, icon, tone, active, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  tone: 'success' | 'warning' | 'danger';
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const baseColor =
    tone === 'success' ? 'var(--c-teal)' :
    tone === 'warning' ? 'var(--c-amber)' :
    'var(--c-red)';
  const fg =
    tone === 'success' ? '#1F7B66' :
    tone === 'warning' ? '#8C5C19' :
    'var(--c-red)';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={active ? `Currently marked ${label}` : `Mark ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 8,
        minWidth: 132,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        lineHeight: 1,
        fontFamily: 'var(--font-sans)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        background: active
          ? `color-mix(in oklab, ${baseColor} 22%, white)`
          : `color-mix(in oklab, ${baseColor} 8%, white)`,
        border: `1px solid color-mix(in oklab, ${baseColor} ${active ? 55 : 25}%, transparent)`,
        color: fg,
        boxShadow: active ? `inset 0 0 0 1px color-mix(in oklab, ${baseColor} 35%, transparent)` : undefined,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      {icon}
      <span>{label}</span>
      {active && (
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: baseColor,
            color: 'white',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          ✓
        </span>
      )}
    </button>
  );
}

function StatusChipFor({ status }: { status: CaseStatus }) {
  const labels: Record<CaseStatus, string> = {
    regression: 'Broken', done: 'Verified', missed: 'Missed', unknown: 'Unsorted',
  };
  return <span className={`v-chip ${status}`}><span className="dot" />{labels[status]}</span>;
}

/** Hard-failure chip — shown whenever the underlying test_result.status is
 *  'failed'. Distinct from a regression/diff: the runner itself threw. The
 *  full error sits in the native title tooltip so reviewers don't have to
 *  drill anywhere to see it. */
function ErrorChip({ result }: { result: TestResultLite | null }) {
  if (!result || result.status !== 'failed') return null;
  const msg = (result.errorMessage ?? '').trim();
  const summary = msg.length > 0 ? firstLine(msg) : 'test failed';
  const tooltip = msg.length > 0 ? msg : 'Test failed (no error message captured)';
  return (
    <span
      className="v-chip regression"
      style={{ flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={tooltip}
    >
      <AlertOctagon size={11} />
      {summary}
    </span>
  );
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/, 1)[0] ?? s;
  return line.length > 64 ? line.slice(0, 61) + '…' : line;
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
              // Hard test failures get a red dot even if the derived case
              // status hasn't classified them yet — the runner threw, so the
              // case is broken regardless of any layer evidence.
              const failed = row.result?.status === 'failed';
              const dotColor =
                failed ? 'var(--c-red)' :
                row.status === 'regression' ? 'var(--c-red)' :
                row.status === 'done' ? 'var(--c-teal)' :
                row.status === 'missed' ? 'var(--c-amber)' : 'var(--fg-3)';
              const errMsg = (row.result?.errorMessage ?? '').trim();
              const dotTitle = failed
                ? (errMsg.length > 0 ? errMsg : 'Test failed')
                : undefined;
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
                  <span
                    style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 6, background: dotColor, flexShrink: 0 }}
                    title={dotTitle}
                    aria-label={failed ? 'test failed' : undefined}
                  />
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
    const hint = absentHint(tab, step?.testId ?? null);
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="v-card" style={{ padding: 24, textAlign: 'center', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <span className="label">{tab} not captured</span>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>
            {hint.message}
          </p>
          {hint.settingsHref && (
            <a
              href={hint.settingsHref}
              className="v-btn"
              style={{ textDecoration: 'none', minWidth: 0 }}
            >
              <Settings size={13} />{hint.settingsLabel ?? 'Open settings'}
            </a>
          )}
        </div>
      </div>
    );
  }

  // diff or clean — render the layer-specific pane and let it differentiate.
  if (tab === 'run') return <RunPane result={result} failed={layerState === 'diff'} />;
  if (tab === 'visual') return <VisualPane step={step} visual={visual} clean={layerState === 'clean'} />;
  if (tab === 'text') return <TextPane visual={visual} clean={layerState === 'clean'} />;
  if (tab === 'dom') return <DomPane step={step} visual={visual} result={result} clean={layerState === 'clean'} />;
  if (tab === 'network') return <NetworkPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'console') return <ConsolePane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'a11y') return <A11yPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'perf') return <PerfPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'url') return <UrlPane step={step} result={result} clean={layerState === 'clean'} />;
  if (tab === 'variable') return <VariablePane step={step} result={result} clean={layerState === 'clean'} />;
  return null;
}

interface AbsentHint {
  message: string;
  /** Settings deep-link for toggleable layers — `/settings?highlight=<id>`
   *  switches to the right tab and flashes the relevant card. */
  settingsHref?: string;
  settingsLabel?: string;
}

function absentHint(layer: CompareTab, testId: string | null): AbsentHint {
  switch (layer) {
    case 'run':    return { message: 'No test result recorded for this case yet — the runner may not have started, or the test result row was deleted. Re-run the build to populate this tab.' };
    case 'visual': return { message: 'No screenshot captured for this step. Visual capture happens automatically — check the runner logs if a step run completed without a snapshot.' };
    case 'text':   return {
      message: 'Page text capture is off. Enable "Text diff" in Diff Sensitivity settings to capture innerText and surface line-level page-text diffs here.',
      settingsHref: '/settings?highlight=diff-sensitivity',
      settingsLabel: 'Open Diff Sensitivity settings',
    };
    case 'dom':    return {
      message: 'DOM snapshots are off. Enable "Capture DOM diff" in Playwright settings; it requires a baseline run before diffs appear.',
      settingsHref: '/settings?highlight=playwright',
      settingsLabel: 'Open Playwright settings',
    };
    case 'a11y':   return {
      message: 'A11y checks are off. Enable "Accessibility checks (axe-core)" in Playwright settings to see WCAG violations and pass counts.',
      settingsHref: '/settings?highlight=playwright',
      settingsLabel: 'Open Playwright settings',
    };
    case 'network': return { message: 'No network requests recorded for this step. Network capture is automatic, so this usually means the step didn\'t fire any requests.' };
    case 'console': return { message: 'No console output captured. Console capture is automatic — this step ran without any logs/warnings/errors.' };
    case 'perf':   return { message: 'No Web Vitals samples for this step. Perf capture is automatic — short-lived steps may not produce LCP/CLS/INP measurements.' };
    case 'url':    return { message: 'No URL trajectory recorded. URL capture is automatic — this usually means the step didn\'t navigate.' };
    case 'variable': return {
      message: 'No test variables were extracted or assigned for this step. Add extract / assign variables on the test definition to surface them here.',
      // Vars are configured per-test, not in global settings — link to the
      // test detail page's Vars tab via the URL-hash deep-link.
      settingsHref: testId ? `/tests/${testId}#vars` : undefined,
      settingsLabel: 'Open test Vars',
    };
  }
}

function CleanBanner({ message }: { message: string }) {
  return (
    <div className="v-chip done" style={{ fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span className="dot" />
      {message}
    </div>
  );
}

function RunPane({ result, failed }: { result: TestResultLite | null; failed: boolean }) {
  if (!result) {
    return (
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="v-card" style={{ padding: 24, textAlign: 'center', maxWidth: 360, color: 'var(--fg-3)' }}>
          <span className="label">No test result on this case</span>
        </div>
      </div>
    );
  }

  const status = result.status ?? 'unknown';
  const errMsg = (result.errorMessage ?? '').trim();
  const watermark = result.totalSteps && result.lastReachedStep != null
    ? `${result.lastReachedStep + 1}/${result.totalSteps}`
    : null;

  // Extract a "trace" tail from the error message — Playwright errors have
  // their callsite a few lines down. Show the full message in a code block.
  const errLines = errMsg.split(/\r?\n/);
  const headline = errLines[0] || (failed ? 'Test failed' : '');
  const body = errLines.slice(1).join('\n').trim();

  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Status row — always visible */}
      <div className="v-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            className={`v-chip ${
              status === 'passed' ? 'done' :
              status === 'failed' ? 'regression' :
              status === 'skipped' ? 'unknown' :
              'info'
            }`}
            style={{ fontSize: 10 }}
          >
            <span className="dot" />
            {status}
          </span>
          {result.isFlaky && <span className="v-chip missed" style={{ fontSize: 9 }}>flaky</span>}
          {result.retryOf && <span className="v-chip" style={{ fontSize: 9 }}>retry</span>}
          <span style={{ flex: 1 }} />
          {result.durationMs != null && (
            <span className="label" style={{ fontSize: 9 }}>{Math.round(result.durationMs)} ms</span>
          )}
          {result.browser && (
            <span className="label" style={{ fontSize: 9 }}>{result.browser}</span>
          )}
        </div>
        {watermark && (
          <div className="label" style={{ fontSize: 10 }}>
            reached step {watermark}
          </div>
        )}
      </div>

      {/* Failed: show the error inline. Passed: show a green confirmation. */}
      {failed ? (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertOctagon size={13} style={{ color: 'var(--c-red)' }} />
            <span className="label" style={{ fontSize: 10 }}>Runner exception</span>
          </div>
          {headline && (
            <div style={{ padding: '10px 12px', borderBottom: body ? '1px solid var(--border)' : undefined, fontSize: 13, fontWeight: 500, color: 'var(--c-red)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {headline}
            </div>
          )}
          {body && (
            <pre className="mono" style={{
              margin: 0,
              padding: '10px 12px',
              background: 'var(--c-white)',
              fontSize: 11,
              lineHeight: 1.55,
              maxHeight: 360,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--fg-2)',
            }}>{body}</pre>
          )}
          {!errMsg && (
            <div className="label" style={{ padding: 12, fontSize: 10 }}>
              Test failed but no error message was captured.
            </div>
          )}
        </div>
      ) : (
        <CleanBanner
          message={
            status === 'passed'
              ? `Test passed${result.durationMs != null ? ` in ${Math.round(result.durationMs)}ms` : ''}`
              : status === 'skipped'
                ? 'Test was skipped'
                : `Test status: ${status}`
          }
        />
      )}
    </div>
  );
}

function TextPane({ visual, clean }: { visual: VisualDiffLite | null; clean: boolean }) {
  // The text-diff content lives on disk at baseline/currentTextPath. Fetch
  // both via the same /screenshots-style URL the paths point at, then run a
  // simple line-by-line diff in the browser.
  const [baselineText, setBaselineText] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const baseSrc = visual?.baselineTextPath ?? null;
  const curSrc = visual?.currentTextPath ?? null;

  useEffect(() => {
    let cancelled = false;
    const load = async (url: string | null): Promise<string | null> => {
      if (!url) return null;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    };
    Promise.all([load(baseSrc), load(curSrc)]).then(([b, c]) => {
      if (cancelled) return;
      setBaselineText(b);
      setCurrentText(c);
      setLoading(false);
      if (!b && !c) setError('Could not load captured page text');
    });
    return () => { cancelled = true; };
  }, [baseSrc, curSrc]);

  const status = visual?.textDiffStatus ?? null;
  const lines = useMemo(() => simpleLineDiff(baselineText ?? '', currentText ?? ''), [baselineText, currentText]);

  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`Page text matches baseline (${(currentText ?? '').length} chars captured)`} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {status && (
          <span className={`v-chip ${
            status === 'unchanged' ? 'done' :
            status === 'changed' ? 'regression' :
            status === 'baseline_only' || status === 'current_only' ? 'missed' :
            status === 'baseline_establishing' ? 'done' :
            'unknown'
          }`} style={{ fontSize: 9 }}>{status.replace(/_/g, ' ')}</span>
        )}
        {!loading && baselineText !== null && (
          <span className="label" style={{ fontSize: 9 }}>baseline · {baselineText.length} chars</span>
        )}
        {!loading && currentText !== null && (
          <span className="label" style={{ fontSize: 9 }}>current · {currentText.length} chars</span>
        )}
      </div>
      {loading && (
        <div className="v-card" style={{ padding: 16, color: 'var(--fg-3)' }}>Loading captured text…</div>
      )}
      {error && (
        <div className="v-card" style={{ padding: 16 }}>
          <span className="v-chip regression">{error}</span>
        </div>
      )}
      {!loading && (baselineText || currentText) && (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label" style={{ fontSize: 10 }}>Line diff</span>
            <span style={{ flex: 1 }} />
            <span className="v-chip done" style={{ fontSize: 9 }}>+{lines.filter((l) => l.op === 'add').length} added</span>
            <span className="v-chip regression" style={{ fontSize: 9 }}>−{lines.filter((l) => l.op === 'del').length} removed</span>
          </div>
          <div style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.55, maxHeight: 480, overflow: 'auto', background: 'var(--c-white)' }}>
            {lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '14px 1fr',
                  gap: 6,
                  padding: '0 4px',
                  background:
                    l.op === 'add' ? 'color-mix(in oklab, var(--c-teal) 8%, white)' :
                    l.op === 'del' ? 'color-mix(in oklab, var(--c-red) 8%, white)' :
                    'transparent',
                  color:
                    l.op === 'add' ? '#1F7B66' :
                    l.op === 'del' ? 'var(--c-red)' :
                    'var(--fg-2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <span style={{ color: 'var(--fg-3)', userSelect: 'none' }}>{l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}</span>
                <span>{l.line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Minimal line-by-line diff — pairs equal lines, marks insertions/removals.
 *  Not LCS-optimal but fine for short page-text snapshots. */
function simpleLineDiff(baseline: string, current: string): { op: 'add' | 'del' | 'eq'; line: string }[] {
  const a = baseline.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const setA = new Set(a);
  const setB = new Set(b);
  const out: { op: 'add' | 'del' | 'eq'; line: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: 'eq', line: a[i] });
      i++; j++;
    } else if (j < b.length && !setA.has(b[j])) {
      out.push({ op: 'add', line: b[j] });
      j++;
    } else if (i < a.length && !setB.has(a[i])) {
      out.push({ op: 'del', line: a[i] });
      i++;
    } else if (i < a.length) {
      out.push({ op: 'del', line: a[i] });
      i++;
    } else {
      out.push({ op: 'add', line: b[j] });
      j++;
    }
  }
  return out;
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

  // Overlay metric chip (rendered on top of the screenshot itself).
  // Even with 0% diff we surface "100% match" rather than nothing.
  const metricChip = (() => {
    if (visualEvidence) {
      const pct = visualEvidence.percentageDifference ?? '?';
      const px = visualEvidence.pixelDifference;
      const tone = parseFloat(String(pct)) > 1 ? 'regression' : 'missed';
      return { tone, label: `${pct}% diff · ${px} px` };
    }
    if (visual && (visual.pixelDifference === 0 || (visual.percentageDifference != null && parseFloat(visual.percentageDifference) === 0))) {
      return { tone: 'done' as const, label: '100% match' };
    }
    return null;
  })();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-white)', flexWrap: 'wrap' }}>
        <div className="v-tabs">
          <button className={`v-tab ${mode === 'slider' ? 'active' : ''}`} onClick={() => setMode('slider')}>Slider</button>
          <button className={`v-tab ${mode === 'side' ? 'active' : ''}`} onClick={() => setMode('side')}>Side by side</button>
          <button className={`v-tab ${mode === 'overlay' ? 'active' : ''}`} onClick={() => setMode('overlay')}>Overlay</button>
        </div>
        <span style={{ flex: 1 }} />
        {/* Right-side cluster: status chips + Regions button. Inline so the
            chips stay on one line each (whiteSpace nowrap), and so the group
            wraps as a unit instead of items breaking into a vertical stack. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {clean && <CleanBanner message="No visual diff — screenshots match baseline" />}
          {metricChip && (
            <span className={`v-chip ${metricChip.tone}`} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span className="dot" />
              {metricChip.label}
            </span>
          )}
          {visual?.classification && (
            <span className="v-chip" style={{ fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>{visual.classification}</span>
          )}
          <button className="v-btn sm" style={{ flexShrink: 0 }}><Layers size={11} />Regions</button>
        </div>
      </div>
      <div style={{ flex: 1, padding: 16, background: 'var(--c-soft-2)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', minHeight: 0, overflowY: 'auto', position: 'relative' }}>
        {!hasBaseline && !hasCurrent && (
          <div className="v-card" style={{ width: '100%', padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
            No screenshots captured for this step.
          </div>
        )}
        {mode === 'slider' && hasBaseline && hasCurrent && (
          <SliderViewer baseline={baselineSrc} current={currentSrc} pct={sliderPct} onPctChange={setSliderPct} />
        )}
        {/* Slider needs both images. Fall back to whichever exists when the
            other is missing (first-run cases have no baseline; aborted runs
            may have no current) so the user still sees a screenshot instead
            of an empty pane. */}
        {mode === 'slider' && !(hasBaseline && hasCurrent) && (hasBaseline || hasCurrent) && (
          <div style={{ width: '100%' }}>
            <ImagePanel
              label={hasCurrent ? 'current (no baseline yet)' : 'baseline (no current capture)'}
              src={hasCurrent ? currentSrc : baselineSrc}
            />
          </div>
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

        {/* Screenshot-overlay metric — pinned to the top-right of the image
            area so reviewers always see a verdict at a glance, even at 0% diff. */}
        {metricChip && (hasBaseline || hasCurrent) && (
          <span
            className={`v-chip ${metricChip.tone}`}
            style={{
              position: 'absolute',
              top: 24,
              right: 28,
              fontSize: 11,
              boxShadow: '0 2px 6px rgba(31,42,51,0.18)',
              zIndex: 5,
            }}
          >
            <span className="dot" />
            {metricChip.label}
          </span>
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
        <img src={src} alt={label} style={{ display: 'block', width: '100%', height: 'auto', background: 'white' }} />
      ) : (
        <div style={{ width: '100%', height: small ? 120 : 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }} className="label">
          missing
        </div>
      )}
    </div>
  );
}

function SliderViewer({ baseline, current, pct, onPctChange }: { baseline: string; current: string; pct: number; onPctChange: (n: number) => void }) {
  // Both images render at width:100% with natural-aspect height. The current
  // image lives in an `inset: 0` overlay so its layout box matches the
  // baseline exactly — clipPath then reveals it on the right of the slider.
  // (Earlier rev applied `maxHeight + objectFit: contain` to the images,
  // which letterboxed each independently and broke the overlay alignment.)
  return (
    <div className="v-card" style={{ width: '100%', padding: 0, position: 'relative', overflow: 'hidden', minHeight: 320, background: 'white' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={baseline} alt="baseline" draggable={false} style={{ display: 'block', width: '100%', height: 'auto' }} />
      {/* current clipped — revealed on the right of the slider line */}
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${pct}%)`, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt="current" draggable={false} style={{ display: 'block', width: '100%', height: 'auto' }} />
      </div>
      {/* slider input — invisible but pointer-events:auto so dragging the
          handle works. Layered above images via z-index, but cannot block
          their visibility (opacity:0). */}
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onPctChange(parseInt(e.target.value, 10))}
        aria-label="Compare slider"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', zIndex: 3 }}
      />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: 2, background: 'var(--c-teal)', pointerEvents: 'none', zIndex: 4 }}>
        <div style={{ position: 'absolute', top: '50%', left: -12, width: 26, height: 26, borderRadius: '50%', background: 'var(--c-white)', border: '2px solid var(--c-teal)', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MoveHorizontal size={12} />
        </div>
      </div>
      <span className="label" style={{ position: 'absolute', top: 6, left: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', zIndex: 5, fontSize: 9 }}>baseline</span>
      <span className="label" style={{ position: 'absolute', top: 6, right: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.85)', zIndex: 5, fontSize: 9 }}>current</span>
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
  // Multi-layer scorer doesn't populate step.layers.dom yet — fall back to
  // the DOM diff that builds.ts writes into visual_diff.metadata.domDiff.
  const dom = step.layers?.dom ?? visual?.domDiff ?? null;
  const snapshot = result?.domSnapshot;
  const elementCount = Array.isArray(snapshot?.elements) ? snapshot.elements.length : 0;
  // Prefer the CURRENT screenshot for the overlay — bounding boxes were
  // captured against current's coordinate system. The diff PNG often hides
  // pixel content under highlight masks, so it's a worse base for overlays.
  const screenshotSrc = visual?.currentImagePath ?? visual?.baselineImagePath ?? visual?.diffImagePath ?? null;

  // Image natural dimensions are the same coordinate space as the bboxes
  // (both come from the same Playwright page). We measure on load and use
  // that as the denominator for `%` overlay positioning.
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  type OverlayRect = { x: number; y: number; w: number; h: number; tone: 'added' | 'removed' | 'changed'; selector: string; tag: string; text: string };
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
        <div className="v-card" style={{ padding: 0, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label" style={{ fontSize: 10 }}>DOM overlay</span>
            <span className="v-chip done" style={{ fontSize: 9 }}>+{dom.added.length} added</span>
            <span className="v-chip regression" style={{ fontSize: 9 }}>−{dom.removed.length} removed</span>
            <span className="v-chip missed" style={{ fontSize: 9 }}>~{dom.changed.length} changed</span>
            <span style={{ flex: 1 }} />
            {imgSize && <span className="label" style={{ fontSize: 9 }}>{imgSize.w}×{imgSize.h}</span>}
          </div>
          <div style={{ position: 'relative', background: 'white' }}>
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
                // Pin the popover to whichever side has more room — flips
                // to the right of the rect when the rect sits on the left
                // half, otherwise to the left, so it never gets clipped.
                const pinRight = r.x < 50;
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
                      boxShadow: isHovered ? `0 0 0 2px color-mix(in oklab, ${color} 35%, transparent)` : 'none',
                      zIndex: isHovered ? 2 : 1,
                    }}
                  >
                    {isHovered && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          [pinRight ? 'left' : 'right']: '100%',
                          [pinRight ? 'marginLeft' : 'marginRight']: 6,
                          minWidth: 220,
                          maxWidth: 320,
                          padding: '8px 10px',
                          background: 'var(--c-white)',
                          border: `1px solid ${color}`,
                          borderRadius: 6,
                          boxShadow: '0 6px 18px rgba(31,42,51,0.18)',
                          fontSize: 11,
                          lineHeight: 1.5,
                          color: 'var(--fg-1)',
                          pointerEvents: 'none',
                          zIndex: 10,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <span className={`v-chip ${r.tone === 'added' ? 'done' : r.tone === 'removed' ? 'regression' : 'missed'}`} style={{ fontSize: 9, padding: '0 5px' }}>
                            {r.tone}
                          </span>
                          <span className="mono" style={{ color: 'var(--fg-3)' }}>{`<${r.tag}>`}</span>
                        </div>
                        {r.selector && (
                          <div className="mono" style={{ wordBreak: 'break-all', color: 'var(--fg-1)', fontSize: 10.5 }}>
                            {r.selector}
                          </div>
                        )}
                        {r.text && (
                          <div style={{ marginTop: 4, color: 'var(--fg-2)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                            {r.text.length > 240 ? r.text.slice(0, 237) + '…' : r.text}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Element list — grouped by Added / Removed / Changed so reviewers
          can scan each set, with full text content for each element. */}
      {dom && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dom.added.length > 0 && (
            <div className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="v-chip done" style={{ fontSize: 9 }}>added</span>
                <span className="label" style={{ fontSize: 10 }}>{dom.added.length}</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {dom.added.map((el, i) => (
                  <DomRow
                    key={`a${i}`}
                    variant="added"
                    tag={el.tag}
                    selector={el.selectors[0]?.value ?? ''}
                    text={el.textContent}
                  />
                ))}
              </div>
            </div>
          )}
          {dom.removed.length > 0 && (
            <div className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="v-chip regression" style={{ fontSize: 9 }}>removed</span>
                <span className="label" style={{ fontSize: 10 }}>{dom.removed.length}</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {dom.removed.map((el, i) => (
                  <DomRow
                    key={`r${i}`}
                    variant="removed"
                    tag={el.tag}
                    selector={el.selectors[0]?.value ?? ''}
                    text={el.textContent}
                  />
                ))}
              </div>
            </div>
          )}
          {dom.changed.length > 0 && (
            <div className="v-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="v-chip missed" style={{ fontSize: 9 }}>changed</span>
                <span className="label" style={{ fontSize: 10 }}>{dom.changed.length}</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {dom.changed.map((c, i) => (
                  <DomRow
                    key={`c${i}`}
                    variant="changed"
                    tag={c.current.tag}
                    selector={c.current.selectors[0]?.value ?? ''}
                    text={c.current.textContent}
                    changeKinds={c.changes}
                  />
                ))}
              </div>
            </div>
          )}
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
  el: { boundingBox?: { x: number; y: number; width: number; height: number }; tag: string; textContent?: string; selectors: Array<{ value: string }> },
  tone: 'added' | 'removed' | 'changed',
  vw: number,
  vh: number,
): { x: number; y: number; w: number; h: number; tone: 'added' | 'removed' | 'changed'; selector: string; tag: string; text: string } {
  const b = el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: vw > 0 ? (b.x / vw) * 100 : 0,
    y: vh > 0 ? (b.y / vh) * 100 : 0,
    w: vw > 0 ? (b.width / vw) * 100 : 0,
    h: vh > 0 ? (b.height / vh) * 100 : 0,
    tone,
    selector: el.selectors[0]?.value ?? '',
    tag: el.tag,
    text: (el.textContent ?? '').trim(),
  };
}

function DomRow({
  variant,
  tag,
  selector,
  text,
  changeKinds,
}: {
  variant: 'added' | 'removed' | 'changed';
  tag: string;
  selector: string;
  text?: string;
  changeKinds?: string[];
}) {
  const cls = variant === 'added' ? 'done' : variant === 'removed' ? 'regression' : 'missed';
  const sign = variant === 'added' ? '+' : variant === 'removed' ? '−' : '~';
  const trimmedText = (text ?? '').trim();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        alignItems: 'start',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}
    >
      <span className={`v-chip ${cls}`} style={{ fontSize: 9, padding: '0 5px', justifySelf: 'start', marginTop: 1 }}>{sign}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-3)' }}>
          {`<${tag}>`}
        </span>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-1)' }} title={selector}>
          {selector || <span style={{ color: 'var(--fg-3)' }}>(no selector)</span>}
        </span>
        {trimmedText.length > 0 && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)', fontStyle: 'italic' }} title={trimmedText}>
            {trimmedText.length > 120 ? trimmedText.slice(0, 117) + '…' : trimmedText}
          </span>
        )}
      </div>
      <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
        {changeKinds?.map((k) => (
          <span key={k} className="v-chip" style={{ fontSize: 9, padding: '0 5px' }}>{k}</span>
        ))}
      </span>
    </div>
  );
}

type StatusGroup = '2xx' | '3xx' | '4xx' | '5xx' | 'err' | 'other';

function statusGroupOf(req: import('@/lib/db/schema').NetworkRequest): StatusGroup {
  if (req.failed) return 'err';
  const s = req.status;
  if (s == null || s === 0) return 'other';
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500 && s < 600) return '5xx';
  return 'other';
}

const STATUS_GROUP_TONE: Record<StatusGroup, string> = {
  '2xx': 'done',
  '3xx': 'info',
  '4xx': 'missed',
  '5xx': 'regression',
  'err': 'regression',
  'other': 'unknown',
};

function NetworkPane({ step, result, clean }: { step: StepComparison; result: TestResultLite | null; clean: boolean }) {
  const net = step.layers?.network;
  const requests = useMemo(() => result?.networkRequests ?? [], [result]);

  // Filters
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<StatusGroup>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Per-group counts for the filter chips — always show the underlying total
  // so the user can see what's available to filter on.
  const counts = useMemo(() => {
    const byMethod = new Map<string, number>();
    const byStatus: Record<StatusGroup, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, 'err': 0, 'other': 0 };
    const byType = new Map<string, number>();
    for (const r of requests) {
      byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + 1);
      byStatus[statusGroupOf(r)] += 1;
      const t = r.resourceType || 'other';
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    return {
      byMethod: Array.from(byMethod.entries()).sort((a, b) => b[1] - a[1]),
      byStatus,
      byType: Array.from(byType.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [requests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (methodFilter.size > 0 && !methodFilter.has(r.method)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(statusGroupOf(r))) return false;
        if (typeFilter.size > 0 && !typeFilter.has(r.resourceType || 'other')) return false;
        if (q && !r.url.toLowerCase().includes(q) && !r.method.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [requests, search, methodFilter, statusFilter, typeFilter]);

  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };

  const toggleExpanded = (i: number) => setExpanded((s) => toggle(s, i));

  const filtersActive = search.length > 0 || methodFilter.size > 0 || statusFilter.size > 0 || typeFilter.size > 0;

  return (
    <div style={{ flex: 1, padding: 14, background: 'var(--c-soft-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clean && <CleanBanner message={`No network diff — ${requests.length} request${requests.length === 1 ? '' : 's'} captured, all match baseline`} />}
      {net && (
        <>
          <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 100px', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <span className="label" style={{ fontSize: 9 }}>Δ vs baseline</span>
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
      {requests.length === 0 ? (
        <div className="v-card" style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>
          <span className="label">No requests captured</span>
          <p style={{ fontSize: 11, marginTop: 6 }}>Enable network capture in Playwright settings to see request data here.</p>
        </div>
      ) : (
        <div className="v-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Filter / search header */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="label" style={{ fontSize: 10 }}>
                Captured requests · {filtered.length}{filtered.length !== requests.length ? ` / ${requests.length}` : ''}
              </span>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="filter URL / method"
                  style={{
                    width: '100%', padding: '5px 8px 5px 24px', fontSize: 11,
                    border: '1px solid var(--border)', borderRadius: 6,
                    background: 'var(--c-white)', color: 'var(--fg-1)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>
              {filtersActive && (
                <button
                  className="v-btn sm ghost"
                  onClick={() => {
                    setSearch('');
                    setMethodFilter(new Set());
                    setStatusFilter(new Set());
                    setTypeFilter(new Set());
                  }}
                >
                  <X size={11} />Reset
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span className="label" style={{ fontSize: 9 }}>Status:</span>
              {(['2xx', '3xx', '4xx', '5xx', 'err', 'other'] as StatusGroup[]).map((g) => {
                const n = counts.byStatus[g];
                if (n === 0) return null;
                const active = statusFilter.has(g);
                return (
                  <button
                    key={g}
                    onClick={() => setStatusFilter(toggle(statusFilter, g))}
                    className={`v-chip ${STATUS_GROUP_TONE[g]}`}
                    style={{ cursor: 'pointer', fontSize: 9, padding: '1px 6px', opacity: active ? 1 : 0.55 }}
                  >
                    {g} · {n}
                  </button>
                );
              })}
              <span style={{ width: 8 }} />
              <span className="label" style={{ fontSize: 9 }}>Method:</span>
              {counts.byMethod.map(([m, n]) => {
                const active = methodFilter.has(m);
                return (
                  <button
                    key={m}
                    onClick={() => setMethodFilter(toggle(methodFilter, m))}
                    className="v-chip"
                    style={{ cursor: 'pointer', fontSize: 9, padding: '1px 6px', opacity: active ? 1 : 0.55 }}
                  >
                    {m} · {n}
                  </button>
                );
              })}
              {counts.byType.length > 1 && (
                <>
                  <span style={{ width: 8 }} />
                  <span className="label" style={{ fontSize: 9 }}>Type:</span>
                  {counts.byType.map(([t, n]) => {
                    const active = typeFilter.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(toggle(typeFilter, t))}
                        className="v-chip"
                        style={{ cursor: 'pointer', fontSize: 9, padding: '1px 6px', opacity: active ? 1 : 0.55 }}
                      >
                        {t} · {n}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          {/* Column header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '20px 60px 1fr 70px 70px 70px 70px',
            padding: '6px 12px', borderBottom: '1px solid var(--border)',
            background: 'var(--c-soft)',
          }}>
            <span />
            <span className="label" style={{ fontSize: 9 }}>Method</span>
            <span className="label" style={{ fontSize: 9 }}>URL</span>
            <span className="label" style={{ fontSize: 9 }}>Status</span>
            <span className="label" style={{ fontSize: 9 }}>Type</span>
            <span className="label" style={{ fontSize: 9 }}>Dur</span>
            <span className="label" style={{ fontSize: 9 }}>Size</span>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div className="label" style={{ padding: 16, textAlign: 'center', fontSize: 10 }}>No requests match the current filters</div>
            )}
            {filtered.slice(0, 500).map(({ r, i }) => (
              <NetworkRequestRow
                key={i}
                req={r}
                expanded={expanded.has(i)}
                onToggle={() => toggleExpanded(i)}
              />
            ))}
            {filtered.length > 500 && (
              <div className="label" style={{ padding: 8, textAlign: 'center', fontSize: 10 }}>+{filtered.length - 500} more not shown</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NetworkRequestRow({
  req,
  expanded,
  onToggle,
}: {
  req: import('@/lib/db/schema').NetworkRequest;
  expanded: boolean;
  onToggle: () => void;
}) {
  const group = statusGroupOf(req);
  const tone = STATUS_GROUP_TONE[group];
  const statusLabel = req.failed
    ? (req.errorText ? `err · ${req.errorText.slice(0, 24)}` : 'failed')
    : (req.status > 0 ? String(req.status) : '—');
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 60px 1fr 70px 70px 70px 70px',
          padding: '6px 12px', borderBottom: '1px solid var(--border)',
          alignItems: 'center', fontSize: 11,
          width: '100%', textAlign: 'left',
          background: expanded ? 'color-mix(in oklab, var(--c-teal) 4%, white)' : 'transparent',
          border: 0,
          cursor: 'pointer',
        }}
        title={req.url}
      >
        <ChevronRight
          size={11}
          style={{ transition: 'transform 100ms ease', transform: expanded ? 'rotate(90deg)' : 'none', color: 'var(--fg-3)' }}
        />
        <span className="mono" style={{ color: 'var(--fg-2)' }}>{req.method}</span>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-1)' }}>{req.url}</span>
        <span className={`v-chip ${tone}`} style={{ fontSize: 9, padding: '1px 6px', justifySelf: 'start', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={statusLabel}>
          {statusLabel}
        </span>
        <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 10 }}>{req.resourceType || '—'}</span>
        <span className="mono" style={{ color: 'var(--fg-2)' }}>{req.duration != null ? `${Math.round(req.duration)}ms` : '—'}</span>
        <span className="mono" style={{ color: 'var(--fg-2)' }}>{req.responseSize != null ? formatBytes(req.responseSize) : '—'}</span>
      </button>
      {expanded && <NetworkRequestDetails req={req} />}
    </>
  );
}

function NetworkRequestDetails({ req }: { req: import('@/lib/db/schema').NetworkRequest }) {
  const reqHeaders = req.requestHeaders ?? {};
  const respHeaders = req.responseHeaders ?? {};
  const hasReqHeaders = Object.keys(reqHeaders).length > 0;
  const hasRespHeaders = Object.keys(respHeaders).length > 0;
  return (
    <div style={{
      padding: '10px 14px 14px 38px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--c-soft)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Top metadata strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {req.startTime != null && (
          <span className="label" style={{ fontSize: 9 }}>
            Started {new Date(req.startTime).toLocaleTimeString()}
          </span>
        )}
        {req.failed && req.errorText && (
          <span className="v-chip regression" style={{ fontSize: 9 }}>
            <AlertOctagon size={10} />{req.errorText}
          </span>
        )}
      </div>

      {hasReqHeaders && <HeadersBlock title="Request headers" headers={reqHeaders} />}
      {req.postData && <BodyBlock title="Request body" body={req.postData} />}
      {hasRespHeaders && <HeadersBlock title="Response headers" headers={respHeaders} />}
      {req.responseBody && <BodyBlock title="Response body" body={req.responseBody} />}
      {!hasReqHeaders && !hasRespHeaders && !req.postData && !req.responseBody && (
        <div className="label" style={{ fontSize: 9, color: 'var(--fg-3)' }}>
          No headers / body captured for this request.
        </div>
      )}
    </div>
  );
}

function HeadersBlock({ title, headers }: { title: string; headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  return (
    <div>
      <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>{title} · {entries.length}</div>
      <div className="v-card" style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.6, maxHeight: 180, overflowY: 'auto' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, padding: '1px 0' }}>
            <span style={{ color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
            <span style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body: string }) {
  // Try to pretty-print JSON; fall back to raw text.
  const pretty = (() => {
    const trimmed = body.trim();
    if (!trimmed) return body;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { /* fall through */ }
    }
    return body;
  })();
  const truncated = pretty.length > 8000;
  return (
    <div>
      <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>
        {title} · {body.length} chars{truncated ? ' (truncated to 8k)' : ''}
      </div>
      <pre className="mono" style={{
        margin: 0, padding: '8px 10px',
        background: 'var(--c-white)',
        border: '1px solid var(--border)', borderRadius: 6,
        fontSize: 10.5, lineHeight: 1.55,
        maxHeight: 240, overflow: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        color: 'var(--fg-1)',
      }}>{pretty.slice(0, 8000)}</pre>
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
  /** Open the issue picker dialog (browse existing issues). */
  onOpenPicker: () => void;
  onCloseIssue: () => void;
  /** Called after a successful "Create issue" submission so the parent can
   *  refresh case state — the chip flips to "auto" without a reload. */
  onAfterCreate?: () => void;
}

type EvidenceItemType = StepComparison['evidence'][number];

/** Linked GH issue summary — shows the title + body fetched via the
 *  fetchLinkedIssueForCase server action. Body is the most useful piece of
 *  context for the reviewer (often contains repro steps / expected
 *  behaviour) so we render it inline instead of forcing a tab to GitHub. */
function LinkedIssueCard({
  stepId,
  issueUrl,
  issueNumber,
  issueState,
}: {
  stepId: string;
  issueUrl: string;
  issueNumber: number | null;
  issueState: StepIssueState | null;
}) {
  const [detail, setDetail] = useState<{ title: string; body: string; state: 'open' | 'closed' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLinkedIssueForCase(stepId).then((res) => {
      if (cancelled) return;
      if (!res.ok) { setError(res.error ?? 'Failed to load issue'); setLoading(false); return; }
      if (res.issue) setDetail({ title: res.issue.title, body: res.issue.body, state: res.issue.state });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [stepId]);

  const tone = issueState === 'closed' ? 'done' : issueState === 'auto' ? 'regression' : 'info';
  const trimmedBody = (detail?.body ?? '').trim();
  const isLong = trimmedBody.length > 480;
  const visibleBody = expanded || !isLong ? trimmedBody : trimmedBody.slice(0, 460) + '…';

  return (
    <div className="v-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`v-chip ${tone}`} style={{ fontSize: 10 }}>
          #{issueNumber} {issueState ?? 'linked'}
        </span>
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mono"
          style={{ fontSize: 11, color: 'var(--c-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {issueUrl.replace(/^https?:\/\//, '')}
        </a>
      </div>
      {loading && (
        <div className="label" style={{ fontSize: 10 }}>loading description…</div>
      )}
      {error && (
        <span className="v-chip regression" style={{ fontSize: 9 }}>{error}</span>
      )}
      {detail && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', lineHeight: 1.4 }}>
            {detail.title}
          </div>
          {trimmedBody.length > 0 ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--fg-2)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--c-soft)',
                borderRadius: 6,
                padding: '8px 10px',
                maxHeight: expanded ? 360 : 'unset',
                overflow: expanded ? 'auto' : 'hidden',
              }}
            >
              {visibleBody}
            </div>
          ) : (
            <div className="label" style={{ fontSize: 9 }}>no description</div>
          )}
          {isLong && (
            <button
              className="v-btn sm ghost"
              style={{ alignSelf: 'flex-start', fontSize: 11 }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Collapse' : `Expand (${trimmedBody.length} chars)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function IntentPanel({ open, onClose, activeCase, onApproveLayer, onRejectLayer, onOpenPicker, onCloseIssue, onAfterCreate }: IntentPanelProps) {
  if (!open) return null;
  const evidence = activeCase?.step.evidence ?? [];
  const issueUrl = activeCase?.step.githubIssueUrl ?? null;
  const issueNumber = activeCase?.step.githubIssueNumber ?? null;
  const issueState = activeCase?.step.githubIssueState ?? null;
  return (
    <div style={{ width: 320, background: 'var(--c-white)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Github size={14} />
        <span className="label">Issue</span>
        <span style={{ flex: 1 }} />
        <button className="v-btn ghost icon" onClick={onClose}><X size={13} /></button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
        {/* Real issue card if linked */}
        {issueUrl && activeCase && (
          <LinkedIssueCard
            stepId={activeCase.step.id}
            issueUrl={issueUrl}
            issueNumber={issueNumber}
            issueState={issueState}
          />
        )}

        {/* Compose new issue — always available, even when one is already
            linked (lets reviewers file a follow-up). */}
        {activeCase && (
          <ComposeIssueCard
            key={activeCase.step.id}
            stepId={activeCase.step.id}
            testName={activeCase.test?.name ?? null}
            stepLabel={activeCase.step.stepLabel ?? null}
            evidence={evidence}
            reviewerNote={activeCase.step.reviewerNote ?? null}
            onAfterCreate={onAfterCreate}
            hasLinkedIssue={!!issueUrl}
          />
        )}

        {/* Per-evidence approve/reject — kept as a secondary control for
            granular decisions. The bottom action bar covers the bulk path. */}
        {evidence.length > 0 && (() => {
          // Collapse evidence to unique layers — one decision per layer.
          const uniqueLayers: typeof evidence = [];
          const seen = new Set<EvidenceLayer>();
          for (const e of evidence) {
            if (seen.has(e.layer)) continue;
            seen.add(e.layer);
            uniqueLayers.push(e);
          }
          const fbByLayer = new Map<EvidenceLayer, NonNullable<typeof activeCase>['feedback'][number]>();
          for (const f of activeCase?.feedback ?? []) {
            fbByLayer.set(f.layer, f);
          }
          const decidedCount = uniqueLayers.filter((e) => {
            const fb = fbByLayer.get(e.layer);
            return fb?.status === 'approved' || fb?.status === 'auto_approved' || fb?.status === 'rejected';
          }).length;
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div className="label">Per-layer decisions</div>
                <span className="label" style={{ fontSize: 9, color: 'var(--fg-3)' }}>
                  {decidedCount} / {uniqueLayers.length}
                </span>
              </div>
              {uniqueLayers.map((e, i) => {
                const fb = fbByLayer.get(e.layer);
                const decided: 'approved' | 'rejected' | null =
                  fb?.status === 'approved' || fb?.status === 'auto_approved'
                    ? 'approved'
                    : fb?.status === 'rejected'
                      ? 'rejected'
                      : null;
                return (
                  <div
                    key={i}
                    className="v-card"
                    style={{
                      padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
                      borderColor: decided === 'approved'
                        ? 'color-mix(in oklab, var(--c-teal) 35%, transparent)'
                        : decided === 'rejected'
                          ? 'color-mix(in oklab, var(--c-red) 35%, transparent)'
                          : undefined,
                      background: decided === 'approved'
                        ? 'color-mix(in oklab, var(--c-teal) 5%, var(--c-white))'
                        : decided === 'rejected'
                          ? 'color-mix(in oklab, var(--c-red) 5%, var(--c-white))'
                          : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={`v-chip ${e.signal === 'high' ? 'regression' : e.signal === 'medium' ? 'missed' : 'done'}`} style={{ fontSize: 9 }}>
                        {e.layer} · {e.signal}
                      </span>
                      {decided === 'approved' && (
                        <span className="v-chip done" style={{ fontSize: 9 }}>
                          <Check size={10} />marked expected
                        </span>
                      )}
                      {decided === 'rejected' && (
                        <span className="v-chip regression" style={{ fontSize: 9 }}>
                          <AlertTriangle size={10} />marked needs fix
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>{e.summary}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button
                        className={'v-btn sm ' + (decided === 'approved' ? 'success' : '')}
                        onClick={() => onApproveLayer(e.layer)}
                        aria-pressed={decided === 'approved'}
                      >
                        <Check size={11} />{decided === 'approved' ? 'Expected ✓' : 'Expected'}
                      </button>
                      <button
                        className={'v-btn sm ' + (decided === 'rejected' ? 'danger' : '')}
                        onClick={() => onRejectLayer(e.layer)}
                        aria-pressed={decided === 'rejected'}
                      >
                        <AlertTriangle size={11} />{decided === 'rejected' ? 'Needs fix ✓' : 'Needs fix'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}

        <div className="label" style={{ marginTop: 6 }}>more actions</div>
        <button className="v-btn" style={{ justifyContent: 'flex-start' }} onClick={onOpenPicker}>
          <LinkIcon size={12} />{issueUrl ? 'Re-link to a different issue' : 'Browse existing issues'}
        </button>
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
          </>
        )}
      </div>
    </div>
  );
}

/** Compose-new-issue card. Lets reviewers describe what's wrong in their
 *  own words and pick which captured evidence to attach. Submits via
 *  createIssueForCase with a body composed entirely client-side. */
function ComposeIssueCard({
  stepId,
  testName,
  stepLabel,
  evidence,
  reviewerNote,
  onAfterCreate,
  hasLinkedIssue,
}: {
  stepId: string;
  testName: string | null;
  stepLabel: string | null;
  evidence: EvidenceItemType[];
  reviewerNote: string | null;
  onAfterCreate?: () => void;
  hasLinkedIssue: boolean;
}) {
  const uniqueEvidence = useMemo(() => {
    const seen = new Set<EvidenceLayer>();
    const out: EvidenceItemType[] = [];
    for (const e of evidence) {
      if (seen.has(e.layer)) continue;
      seen.add(e.layer);
      out.push(e);
    }
    return out;
  }, [evidence]);

  const [text, setText] = useState(reviewerNote ?? '');
  const [includeLayers, setIncludeLayers] = useState<Set<EvidenceLayer>>(
    () => new Set(uniqueEvidence.map((e) => e.layer)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleLayer = (layer: EvidenceLayer) => {
    setIncludeLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const composeBody = (): string => {
    const lines: string[] = [];
    if (text.trim().length > 0) lines.push(text.trim());
    const picked = uniqueEvidence.filter((e) => includeLayers.has(e.layer));
    if (picked.length > 0) {
      lines.push('', '## Evidence');
      for (const e of picked) {
        lines.push(`- **${e.layer}** (${e.signal}): ${e.summary}`);
      }
    }
    if (testName || stepLabel) {
      lines.push('', '## Context');
      if (testName) lines.push(`- Test: ${testName}`);
      if (stepLabel) lines.push(`- Step: ${stepLabel}`);
    }
    return lines.join('\n');
  };

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const titleBase = testName ?? 'verify case';
    const titleStep = stepLabel ? ` — ${stepLabel}` : '';
    const titleHint = text.trim().split(/\r?\n/, 1)[0]?.slice(0, 60) ?? '';
    const title = titleHint
      ? `[Verify] ${titleBase}${titleStep}: ${titleHint}`
      : `[Verify] ${titleBase}${titleStep}`;
    const res = await createIssueForCase({
      stepComparisonId: stepId,
      title,
      body: composeBody(),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to create issue');
      return;
    }
    onAfterCreate?.();
  };

  const canSubmit = !submitting && (text.trim().length > 0 || includeLayers.size > 0);

  return (
    <div className="v-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Plus size={12} style={{ color: 'var(--fg-2)' }} />
        <span className="label">{hasLinkedIssue ? 'File a follow-up issue' : 'File a new issue'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="label" style={{ fontSize: 9 }}>What&apos;s wrong?</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Short description, repro steps, expected vs actual…"
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--c-white)',
            color: 'var(--fg-1)',
            resize: 'vertical',
            minHeight: 70,
          }}
        />
      </div>

      {uniqueEvidence.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label" style={{ fontSize: 9 }}>Include evidence ({includeLayers.size}/{uniqueEvidence.length})</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {uniqueEvidence.map((e, i) => {
              const checked = includeLayers.has(e.layer);
              return (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: checked ? 'color-mix(in oklab, var(--c-teal) 4%, white)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLayer(e.layer)}
                    style={{ marginTop: 2, accentColor: 'var(--c-teal)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span className={`v-chip ${e.signal === 'high' ? 'regression' : e.signal === 'medium' ? 'missed' : 'done'}`} style={{ fontSize: 9, padding: '0 5px' }}>
                        {e.layer} · {e.signal}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.45, marginTop: 2 }}>
                      {e.summary}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <span className="v-chip regression" style={{ fontSize: 9, alignSelf: 'flex-start' }}>{error}</span>
      )}

      <button
        type="button"
        className="v-btn primary"
        onClick={handleCreate}
        disabled={!canSubmit}
        style={{ alignSelf: 'flex-start' }}
      >
        <Plus size={12} />{submitting ? 'Filing…' : 'Create issue'}
      </button>
    </div>
  );
}
