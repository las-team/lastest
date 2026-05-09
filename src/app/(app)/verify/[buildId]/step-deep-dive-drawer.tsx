'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertTriangle, BellOff } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { decideLayer } from '@/server/actions/layer-feedback';
import type {
  StepComparison,
  StepLayerFeedback,
  EvidenceLayer,
  LayerFeedbackStatus,
} from '@/lib/db/schema';

interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface StepDeepDiveDrawerProps {
  step: StepComparison;
  buildId: string;
  test: TestLite | null;
  existingFeedback: StepLayerFeedback[];
  onClose: () => void;
}

const LAYER_ORDER: EvidenceLayer[] = ['visual', 'dom', 'network', 'console', 'a11y', 'perf', 'url', 'variable'];
const LAYER_LABEL: Record<EvidenceLayer, string> = {
  visual: 'Visual',
  dom: 'DOM',
  network: 'Network',
  console: 'Console',
  a11y: 'A11y',
  perf: 'Perf',
  url: 'URL',
  variable: 'Vars',
};

const SIGNAL_DOT: Record<string, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

const STATUS_LABEL: Record<LayerFeedbackStatus, string> = {
  pending: 'Pending',
  approved: 'Expected (baseline)',
  rejected: 'Needs fix',
  snoozed: 'Snoozed',
  auto_approved: 'Auto-approved',
};

export function StepDeepDiveDrawer({ step, buildId, test, existingFeedback, onClose }: StepDeepDiveDrawerProps) {
  const router = useRouter();
  // Default tab = first layer with a signal, falling back to first.
  const initialActive = step.evidence?.[0]?.layer ?? LAYER_ORDER[0];
  const [active, setActive] = useState<EvidenceLayer>(initialActive);
  // Local optimistic copy of feedback rows. Seed from props on first render
  // and apply local mutations on top. Server is source of truth via revalidate.
  const initialFeedback = useMemo(() => {
    const map: Record<string, StepLayerFeedback> = {};
    for (const f of existingFeedback) map[f.layer] = f;
    return map;
  }, [existingFeedback]);
  const [feedback, setFeedback] = useState<Record<string, StepLayerFeedback>>(initialFeedback);
  const [pending, startTransition] = useTransition();

  // Keyboard: 1–8 switch tab, esc close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= LAYER_ORDER.length) {
        setActive(LAYER_ORDER[idx - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const decide = (layer: EvidenceLayer, status: LayerFeedbackStatus, note?: string) => {
    startTransition(async () => {
      const result = await decideLayer({
        stepComparisonId: step.id,
        buildId,
        layer,
        status,
        note: note ?? null,
      });
      setFeedback((prev) => ({ ...prev, [layer]: result }));
      router.refresh();
    });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="!w-[800px] !max-w-[95vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${VERDICT_BG[step.verdict]}`} />
            {test?.name ?? 'Unknown test'}
            {step.stepLabel && <span className="text-muted-foreground font-normal">— {step.stepLabel}</span>}
          </SheetTitle>
          <SheetDescription>
            Verdict: <strong className="capitalize">{step.verdict}</strong> · Layers: {step.evidence.length} signals
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4">
          <Tabs value={active} onValueChange={(v) => setActive(v as EvidenceLayer)}>
            <TabsList className="grid grid-cols-8 w-full">
              {LAYER_ORDER.map((layer) => {
                const ev = step.evidence.find((e) => e.layer === layer);
                const fb = feedback[layer];
                return (
                  <TabsTrigger key={layer} value={layer} className="text-xs">
                    {LAYER_LABEL[layer]}
                    {ev && <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${SIGNAL_DOT[ev.signal] ?? 'bg-muted'}`} />}
                    {fb && <FeedbackTinyChip status={fb.status} />}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {LAYER_ORDER.map((layer) => (
              <TabsContent key={layer} value={layer} className="space-y-3 pt-3">
                <LayerBody step={step} layer={layer} />
                <LayerFeedbackPanel
                  status={feedback[layer]?.status ?? 'pending'}
                  pending={pending}
                  onDecide={(s, note) => decide(layer, s, note)}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const VERDICT_BG: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

function FeedbackTinyChip({ status }: { status: LayerFeedbackStatus }) {
  const map: Record<LayerFeedbackStatus, string> = {
    pending: 'bg-muted',
    approved: 'bg-emerald-500',
    auto_approved: 'bg-emerald-500',
    rejected: 'bg-rose-500',
    snoozed: 'bg-zinc-400',
  };
  return <span className={`ml-1 inline-block h-1 w-3 rounded-sm ${map[status]}`} />;
}

function LayerBody({ step, layer }: { step: StepComparison; layer: EvidenceLayer }) {
  const ev = step.evidence.find((e) => e.layer === layer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = step.layers as any;

  if (!ev) {
    return (
      <div className="rounded border bg-muted/40 p-4 text-sm text-muted-foreground">
        No signal on this layer for this step.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block h-2 w-2 rounded-full ${SIGNAL_DOT[ev.signal] ?? 'bg-muted'}`} />
          <span className="text-sm font-medium capitalize">{ev.signal} signal</span>
          <Badge variant="outline" className="text-[10px] capitalize">{ev.layer}</Badge>
        </div>
        <p className="text-sm">{ev.summary}</p>
      </div>

      {/* Layer-specific structured payload */}
      <details className="rounded border bg-muted/30">
        <summary className="cursor-pointer p-2 text-xs text-muted-foreground">Layer payload</summary>
        <pre className="text-[11px] p-2 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(layers?.[layer === 'console' ? 'consoleDiff' : layer] ?? {}, null, 2)}
        </pre>
      </details>

      {ev.details && (
        <details className="rounded border bg-muted/30">
          <summary className="cursor-pointer p-2 text-xs text-muted-foreground">Evidence details</summary>
          <pre className="text-[11px] p-2 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(ev.details, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function LayerFeedbackPanel({
  status,
  pending,
  onDecide,
}: {
  status: LayerFeedbackStatus;
  pending: boolean;
  onDecide: (status: LayerFeedbackStatus, note?: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Feedback</p>
        <Badge variant="outline" className="text-[10px]">Current: {STATUS_LABEL[status]}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" disabled={pending} onClick={() => onDecide('approved', note || undefined)}>
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Mark expected
        </Button>
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => onDecide('rejected', note || undefined)}>
          <AlertTriangle className="h-3 w-3 mr-1" />
          Needs fix
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide('snoozed', note || undefined)}>
          <BellOff className="h-3 w-3 mr-1" />
          Snooze
        </Button>
      </div>
      <Textarea
        placeholder="Optional note…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="text-xs"
        rows={2}
      />
    </div>
  );
}
