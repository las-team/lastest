'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, Pin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { setBuildManualScope } from '@/server/actions/change-map';
import type {
  Build,
  ChangeMap,
  StepComparison,
  StepLayerFeedback,
  EvidenceLayer,
  StepVerdict,
} from '@/lib/db/schema';
import { StepDeepDiveDrawer } from './step-deep-dive-drawer';

interface AreaLite { id: string; name: string; parentId: string | null }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface VerifyBuildClientProps {
  build: Build;
  branch: string | null;
  changeMap: ChangeMap | null;
  stepComparisons: StepComparison[];
  areas: AreaLite[];
  tests: TestLite[];
  verdictCounts: { green: number; yellow: number; red: number };
  layerFeedback: StepLayerFeedback[];
}

const SOURCE_LABELS: Record<string, string> = {
  code: 'code',
  ai: 'ai',
  signals: 'signals',
  manual: 'manual',
};

const RISK_DOT: Record<string, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-rose-500',
};

const VERDICT_DOT: Record<StepVerdict, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

export function VerifyBuildClient({
  build,
  branch,
  changeMap,
  stepComparisons,
  areas,
  tests,
  verdictCounts,
  layerFeedback,
}: VerifyBuildClientProps) {
  const router = useRouter();
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [scopeUiOpen, setScopeUiOpen] = useState(false);
  const [scopeSaving, startScopeSave] = useTransition();

  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const changedAreaIds = useMemo(
    () => new Set(changeMap?.areas.filter((a) => a.sources.includes('code') || a.sources.includes('manual')).map((a) => a.areaId) ?? []),
    [changeMap],
  );

  const stepsByLane = useMemo(() => {
    const regression: StepComparison[] = [];
    const intent: StepComparison[] = [];
    for (const sc of stepComparisons) {
      if (sc.verdict === 'green') continue;
      const test = testById.get(sc.testId);
      const isInChangedArea = test?.functionalAreaId && changedAreaIds.has(test.functionalAreaId);
      // Regression gate: red/yellow signals in *unchanged* areas — those are
      // accidental side-effects we didn't intend to ship.
      if (!isInChangedArea) {
        regression.push(sc);
      } else {
        // Intent gate: same-area deltas are presumably the change being verified.
        intent.push(sc);
      }
    }
    return { regression, intent };
  }, [stepComparisons, testById, changedAreaIds]);

  const handleManualScope = (areaIds: string[]) => {
    startScopeSave(async () => {
      await setBuildManualScope(build.id, areaIds);
      router.refresh();
    });
  };

  const openStep = stepComparisons.find((s) => s.id === openStepId) ?? null;
  const openStepFeedback = layerFeedback.filter((f) => f.stepComparisonId === openStepId);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* Header */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <Link href="/verify" className="text-sm text-muted-foreground inline-flex items-center mb-2">
              <ArrowLeft className="h-3 w-3 mr-1" /> All builds
            </Link>
            <h1 className="text-2xl font-semibold">Verify build #{build.id.slice(0, 8)}</h1>
            <p className="text-sm text-muted-foreground">
              {branch ?? 'unknown branch'} · {build.completedAt ? new Date(build.completedAt).toLocaleString() : 'in progress'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <VerdictBadgeStrip counts={verdictCounts} />
          </div>
        </header>

        {/* Change Map */}
        {changeMap && (
          <ChangeMapPanel
            changeMap={changeMap}
            allAreas={areas}
            scopeUiOpen={scopeUiOpen}
            onToggleScope={() => setScopeUiOpen((v) => !v)}
            onApplyScope={handleManualScope}
            saving={scopeSaving}
          />
        )}

        {/* Two-column gates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <GateColumn
            title="Regression gate"
            subtitle="Anything broken that shouldn't be?"
            icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
            steps={stepsByLane.regression}
            tests={testById}
            areas={areaById}
            layerFeedback={layerFeedback}
            onOpen={setOpenStepId}
          />
          <GateColumn
            title="Intent gate"
            subtitle="Did we deliver what we said we'd deliver?"
            icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
            steps={stepsByLane.intent}
            tests={testById}
            areas={areaById}
            layerFeedback={layerFeedback}
            onOpen={setOpenStepId}
          />
        </div>
      </div>

      {openStep && (
        <StepDeepDiveDrawer
          step={openStep}
          buildId={build.id}
          test={testById.get(openStep.testId) ?? null}
          existingFeedback={openStepFeedback}
          onClose={() => setOpenStepId(null)}
        />
      )}
    </div>
  );
}

function VerdictBadgeStrip({ counts }: { counts: { green: number; yellow: number; red: number } }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />{counts.green}
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />{counts.yellow}
      <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />{counts.red}
    </span>
  );
}

function ChangeMapPanel({
  changeMap,
  allAreas,
  scopeUiOpen,
  onToggleScope,
  onApplyScope,
  saving,
}: {
  changeMap: ChangeMap;
  allAreas: AreaLite[];
  scopeUiOpen: boolean;
  onToggleScope: () => void;
  onApplyScope: (ids: string[]) => void;
  saving: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(changeMap.manuallyScopedAreaIds));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Change Map</p>
            <h2 className="text-lg font-medium">{changeMap.intentSummary || 'No intent summary available'}</h2>
            {changeMap.riskSummary && (
              <p className="text-sm text-muted-foreground mt-1">⚠ {changeMap.riskSummary}</p>
            )}
            {changeMap.aiSkipped && (
              <p className="text-xs text-muted-foreground italic">AI summary skipped: {changeMap.aiSkippedReason}</p>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            +{changeMap.files.length} files · {changeMap.areas.length} areas · {changeMap.tests.length} tests · {changeMap.steps.length} steps
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={onToggleScope}>
            <Pin className="h-3 w-3 mr-1" />
            {scopeUiOpen ? 'Hide focus' : 'Focus on…'}
          </Button>
        </div>

        {scopeUiOpen && (
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">Pin areas to elevate them in the change-map ranking. Triggers AI re-summary.</p>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {allAreas.map((a) => (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
                    selected.has(a.id) ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                  }`}
                >
                  {a.name}
                  {selected.has(a.id) && <X className="h-3 w-3" />}
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                disabled={saving}
                onClick={() => onApplyScope(Array.from(selected))}
              >
                {saving ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {changeMap.areas.map((area) => (
            <details key={area.areaId} className="rounded border bg-background open:bg-muted/40">
              <summary className="cursor-pointer list-none p-2 flex items-center gap-2">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                <span className={`inline-block h-2 w-2 rounded-full ${RISK_DOT[area.risk] ?? 'bg-muted'}`} />
                <span className="text-sm font-medium">{area.areaName}</span>
                {area.sources.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                    {SOURCE_LABELS[s] ?? s}
                  </Badge>
                ))}
              </summary>
              {area.aiNarrative.length > 0 && (
                <ul className="px-6 py-2 space-y-1 text-sm list-disc">
                  {area.aiNarrative.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GateColumn({
  title,
  subtitle,
  icon,
  steps,
  tests,
  areas,
  layerFeedback,
  onOpen,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  steps: StepComparison[];
  tests: Map<string, TestLite>;
  areas: Map<string, AreaLite>;
  layerFeedback: StepLayerFeedback[];
  onOpen: (id: string) => void;
}) {
  const feedbackByStep = useMemo(() => {
    const m = new Map<string, StepLayerFeedback[]>();
    for (const f of layerFeedback) {
      if (!m.has(f.stepComparisonId)) m.set(f.stepComparisonId, []);
      m.get(f.stepComparisonId)!.push(f);
    }
    return m;
  }, [layerFeedback]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <div>
            <h2 className="font-medium">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{steps.length}</span>
        </div>
        <ul className="space-y-1.5">
          {steps.length === 0 && (
            <li className="text-sm text-muted-foreground border border-dashed rounded p-3">No items.</li>
          )}
          {steps.map((sc) => {
            const test = tests.get(sc.testId);
            const area = test?.functionalAreaId ? areas.get(test.functionalAreaId) : null;
            const fb = feedbackByStep.get(sc.id) ?? [];
            return (
              <li key={sc.id}>
                <button
                  className="w-full text-left rounded border p-2 hover:bg-muted/50 flex items-center gap-2"
                  onClick={() => onOpen(sc.id)}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${VERDICT_DOT[sc.verdict]}`} />
                  <span className="text-sm font-medium truncate">{test?.name ?? 'Unknown test'}</span>
                  {sc.stepLabel && (
                    <span className="text-xs text-muted-foreground truncate">{sc.stepLabel}</span>
                  )}
                  {area && (
                    <Badge variant="outline" className="ml-auto text-[10px]">{area.name}</Badge>
                  )}
                  <LayerStrip evidence={sc.evidence ?? []} feedback={fb} />
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function LayerStrip({
  evidence,
  feedback,
}: {
  evidence: StepComparison['evidence'];
  feedback: StepLayerFeedback[];
}) {
  const layers: EvidenceLayer[] = ['visual', 'dom', 'network', 'console', 'a11y', 'perf', 'url', 'variable'];
  const evidenceByLayer = new Map(evidence.map((e) => [e.layer, e]));
  const feedbackByLayer = new Map(feedback.map((f) => [f.layer, f]));
  return (
    <span className="inline-flex items-center gap-0.5 ml-2">
      {layers.map((layer) => {
        const ev = evidenceByLayer.get(layer);
        const fb = feedbackByLayer.get(layer);
        let color = 'bg-muted';
        if (ev?.signal === 'high') color = 'bg-rose-500';
        else if (ev?.signal === 'medium') color = 'bg-amber-500';
        else if (ev?.signal === 'low') color = 'bg-emerald-500';
        if (fb?.status === 'approved' || fb?.status === 'auto_approved') color = 'bg-emerald-500';
        if (fb?.status === 'rejected') color = 'bg-rose-700';
        if (fb?.status === 'snoozed') color = 'bg-zinc-400';
        return (
          <span
            key={layer}
            className={`inline-block h-1.5 w-1.5 rounded-full ${color}`}
            title={`${layer}: ${ev?.summary ?? 'no signal'} ${fb ? `(${fb.status})` : ''}`}
          />
        );
      })}
    </span>
  );
}
