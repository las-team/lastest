'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import type {
  StepComparison,
  EvidenceItem,
  EvidenceLayer,
  StepVerdict,
} from '@/lib/db/schema';

interface MultiLayerPanelProps {
  comparison: StepComparison;
}

const LAYER_LABELS: Record<EvidenceLayer, string> = {
  visual: 'Visual',
  dom: 'DOM',
  a11y: 'Accessibility',
  network: 'Network',
  console: 'Console',
  url: 'URL Trajectory',
  perf: 'Performance',
  variable: 'Variables',
};

function VerdictPill({ verdict }: { verdict: StepVerdict }) {
  const color =
    verdict === 'red' ? 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
    : verdict === 'yellow' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
    : 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30';
  const Icon = verdict === 'red' ? AlertCircle : verdict === 'yellow' ? AlertTriangle : CheckCircle;
  const label = verdict === 'red' ? 'Likely regression' : verdict === 'yellow' ? 'Review changes' : 'No regressions';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function SignalBadge({ signal }: { signal: 'high' | 'medium' | 'low' }) {
  const color =
    signal === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
    : signal === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${color}`}>
      {signal}
    </span>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium shrink-0">{LAYER_LABELS[item.layer] ?? item.layer}</span>
        <SignalBadge signal={item.signal} />
        <span className="text-muted-foreground truncate">{item.summary}</span>
      </div>
    </div>
  );
}

function NetworkLayerDetails({ network }: { network: NonNullable<StepComparison['layers']['network']> }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded border border-border bg-muted/30 p-2 text-center">
          <div className="text-xs text-muted-foreground">Added</div>
          <div className="font-mono text-base">{network.added}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 p-2 text-center">
          <div className="text-xs text-muted-foreground">Removed</div>
          <div className="font-mono text-base">{network.removed}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 p-2 text-center">
          <div className="text-xs text-muted-foreground">Changed</div>
          <div className="font-mono text-base">{network.changed}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 p-2 text-center">
          <div className="text-xs text-muted-foreground">New errors</div>
          <div className="font-mono text-base text-red-600">{network.newErrorCount}</div>
        </div>
      </div>
      {network.newServerErrors.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-red-600">New 5xx</div>
          <ul className="space-y-1">
            {network.newServerErrors.slice(0, 5).map((e, i) => (
              <li key={i} className="font-mono text-xs"><span className="text-red-600">{e.status}</span> {e.method} <span className="text-muted-foreground">{e.url}</span></li>
            ))}
          </ul>
        </div>
      )}
      {network.newClientErrors.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-amber-600">New 4xx</div>
          <ul className="space-y-1">
            {network.newClientErrors.slice(0, 5).map((e, i) => (
              <li key={i} className="font-mono text-xs"><span className="text-amber-600">{e.status}</span> {e.method} <span className="text-muted-foreground">{e.url}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConsoleLayerDetails({ console: c }: { console: NonNullable<StepComparison['layers']['consoleDiff']> }) {
  return (
    <div className="space-y-2 text-sm">
      {c.newFingerprints.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-red-600">New errors ({c.newFingerprints.length})</div>
          <ul className="space-y-1">
            {c.newFingerprints.slice(0, 5).map((f, i) => (
              <li key={i} className="font-mono text-xs text-muted-foreground">
                <span className="text-foreground">{f.sample}</span>
                {f.count > 1 && <span className="ml-1 text-muted-foreground">×{f.count}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.disappeared.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-green-600">Resolved ({c.disappeared.length})</div>
        </div>
      )}
    </div>
  );
}

function UrlLayerDetails({ url }: { url: NonNullable<StepComparison['layers']['url']> }) {
  if (url.divergedSteps.length === 0) {
    return <div className="text-sm text-muted-foreground">No URL trajectory changes.</div>;
  }
  return (
    <div className="space-y-2 text-sm">
      {url.divergedSteps.slice(0, 8).map((s, i) => (
        <div key={i} className="rounded border border-border bg-card p-2">
          <div className="text-xs font-medium">Step {s.stepIndex + 1}{s.stepLabel ? ` · ${s.stepLabel}` : ''}</div>
          <div className="mt-1 grid gap-1 font-mono text-xs">
            <div><span className="text-muted-foreground">baseline:</span> {s.baselineUrl}</div>
            <div><span className="text-muted-foreground">current: </span> {s.currentUrl}</div>
            {s.redirectChainChanged && (
              <div className="text-amber-600">Redirect chain changed</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function A11yLayerDetails({ a11y }: { a11y: NonNullable<StepComparison['layers']['a11y']> }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-4 gap-2">
        {(['critical', 'serious', 'moderate', 'minor'] as const).map(sev => (
          <div key={sev} className="rounded border border-border bg-muted/30 p-2 text-center">
            <div className="text-xs text-muted-foreground capitalize">{sev}</div>
            <div className="font-mono text-base">{a11y.newBySeverity[sev]}</div>
          </div>
        ))}
      </div>
      {a11y.newViolations.length > 0 && (
        <ul className="space-y-1">
          {a11y.newViolations.slice(0, 8).map((v, i) => (
            <li key={i} className="text-xs"><span className="font-medium">{v.id}</span> <span className="text-muted-foreground">({v.impact})</span> · {v.help}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PerfLayerDetails({ perf }: { perf: NonNullable<StepComparison['layers']['perf']> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="text-left">Metric</th>
          <th className="text-right">Baseline</th>
          <th className="text-right">Current</th>
          <th className="text-right">Δ</th>
          <th className="text-left">Status</th>
        </tr>
      </thead>
      <tbody>
        {perf.deltas.slice(0, 10).map((d, i) => (
          <tr key={i} className="border-t border-border">
            <td className="font-mono uppercase">{d.metric}</td>
            <td className="text-right font-mono">{d.baseline.toFixed(d.metric === 'cls' ? 3 : 0)}</td>
            <td className="text-right font-mono">{d.current.toFixed(d.metric === 'cls' ? 3 : 0)}</td>
            <td className={`text-right font-mono ${d.delta > 0 ? 'text-red-600' : 'text-green-600'}`}>{d.delta > 0 ? '+' : ''}{d.delta.toFixed(d.metric === 'cls' ? 3 : 0)}</td>
            <td>{d.budgetBreached ? <span className="text-red-600">budget</span> : d.drifted ? <span className="text-amber-600">drift</span> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VariableLayerDetails({ variable }: { variable: NonNullable<StepComparison['layers']['variable']> }) {
  return (
    <ul className="space-y-1 text-sm">
      {variable.changes.slice(0, 10).map((c, i) => (
        <li key={i} className="font-mono text-xs">
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase">{c.tier}</span>
          <span className="ml-2 font-medium">{c.path}</span>
          {c.tier !== 'structural-break' && (
            <span className="ml-2 text-muted-foreground">{JSON.stringify(c.baseline)} → {JSON.stringify(c.current)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MultiLayerPanel({ comparison }: MultiLayerPanelProps) {
  const [expanded, setExpanded] = useState(comparison.verdict !== 'green');
  const evidence = comparison.evidence as EvidenceItem[];
  const layers = comparison.layers as StepComparison['layers'];

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">Multi-layer comparison</span>
          <VerdictPill verdict={comparison.verdict} />
          <span className="text-sm text-muted-foreground">
            {evidence.length === 0 ? 'No layer changes' : `${evidence.length} layer(s) reporting`}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border p-4">
          {evidence.length === 0 ? (
            <div className="text-sm text-muted-foreground">All layers match the baseline.</div>
          ) : (
            <div className="space-y-2">
              {evidence.map((e, i) => (
                <EvidenceRow key={i} item={e} />
              ))}
            </div>
          )}
          {/* Per-layer detail blocks */}
          {layers.network && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Network details</summary>
              <div className="mt-3"><NetworkLayerDetails network={layers.network} /></div>
            </details>
          )}
          {layers.consoleDiff && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Console details</summary>
              <div className="mt-3"><ConsoleLayerDetails console={layers.consoleDiff} /></div>
            </details>
          )}
          {layers.url && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">URL trajectory details</summary>
              <div className="mt-3"><UrlLayerDetails url={layers.url} /></div>
            </details>
          )}
          {layers.a11y && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Accessibility details</summary>
              <div className="mt-3"><A11yLayerDetails a11y={layers.a11y} /></div>
            </details>
          )}
          {layers.perf && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Performance details</summary>
              <div className="mt-3"><PerfLayerDetails perf={layers.perf} /></div>
            </details>
          )}
          {layers.variable && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Variable details</summary>
              <div className="mt-3"><VariableLayerDetails variable={layers.variable} /></div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
