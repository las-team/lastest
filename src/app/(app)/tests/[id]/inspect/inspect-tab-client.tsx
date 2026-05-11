'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle,
  Clock,
  GitBranch,
  GitCommit,
  ImageOff,
  Loader2,
  Microscope,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  DiffEngineType,
  InspectionResult,
  InspectorClassification,
  InspectorDimension,
  InspectorSeverity,
} from '@/lib/db/schema';

interface RunOption {
  id: string;
  testRunId: string | null;
  status: string | null;
  startedAt: Date | string | null;
  durationMs: number | null;
  viewport: string | null;
  browser: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
  hasScreenshot: boolean;
  hasDom: boolean;
  hasNetwork: boolean;
  hasVariables: boolean;
}

interface InspectTabClientProps {
  testId: string;
}

const SEVERITY_DOT: Record<InspectorSeverity, string> = {
  unchanged: 'bg-emerald-500',
  minor: 'bg-amber-500',
  changed: 'bg-rose-500',
  unavailable: 'bg-zinc-300 dark:bg-zinc-600',
};

const SEVERITY_LABEL: Record<InspectorSeverity, string> = {
  unchanged: 'no change',
  minor: 'minor',
  changed: 'changed',
  unavailable: 'n/a',
};

const DIMENSIONS: Array<{ key: keyof InspectorClassification; label: string }> = [
  { key: 'visual', label: 'Visual' },
  { key: 'dom', label: 'DOM' },
  { key: 'text', label: 'Text' },
  { key: 'network', label: 'Network' },
  { key: 'variables', label: 'Variables' },
];

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'passed') {
    return (
      <Badge className="bg-green-600 hover:bg-green-600">
        <CheckCircle className="h-3 w-3 mr-1" /> passed
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3 mr-1" /> failed
      </Badge>
    );
  }
  return <Badge variant="secondary">{status ?? 'unknown'}</Badge>;
}

function runShortLabel(r: RunOption): string {
  const ts = r.startedAt ? formatDate(r.startedAt) : 'no timestamp';
  const status = r.status ?? '—';
  return `${ts} · ${status}`;
}

function RunCard({ run, side }: { run: RunOption | undefined; side: 'baseline' | 'current' }) {
  if (!run) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        Pick a {side === 'baseline' ? 'baseline' : 'current'} run.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {run.gitBranch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {run.gitBranch}
          </span>
        )}
        {run.gitCommit && run.gitCommit !== 'unknown' && (
          <span className="inline-flex items-center gap-1 font-mono">
            <GitCommit className="h-3 w-3" />
            {run.gitCommit.slice(0, 7)}
          </span>
        )}
        {run.durationMs != null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(run.durationMs)}
          </span>
        )}
        {run.viewport && <span className="font-mono">{run.viewport}</span>}
        {run.browser && <span>{run.browser}</span>}
      </div>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        {run.hasScreenshot && <span className="rounded bg-muted px-1.5 py-0.5">screenshot</span>}
        {run.hasDom && <span className="rounded bg-muted px-1.5 py-0.5">dom</span>}
        {run.hasNetwork && <span className="rounded bg-muted px-1.5 py-0.5">network</span>}
        {run.hasVariables && <span className="rounded bg-muted px-1.5 py-0.5">vars</span>}
      </div>
    </div>
  );
}

function SeverityRow({
  classification,
  active,
  onSelect,
}: {
  classification: InspectorClassification;
  active: InspectorDimension;
  onSelect: (d: InspectorDimension) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DIMENSIONS.map(({ key, label }) => {
        const sev = classification[key];
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              isActive ? 'border-foreground/30 bg-accent' : 'hover:bg-muted/60'
            }`}
            title={`${label}: ${SEVERITY_LABEL[sev]}`}
          >
            <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[sev]}`} />
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground">{SEVERITY_LABEL[sev]}</span>
          </button>
        );
      })}
    </div>
  );
}

function VisualPane({ result }: { result: InspectionResult }) {
  const v = result.visual;
  if (!v) return <p className="text-sm text-muted-foreground">Visual dimension not requested.</p>;
  if (v.error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-500">{v.error}</p>
        {(v.baselineImagePath || v.currentImagePath) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ImagePane label="Baseline" path={v.baselineImagePath} />
            <ImagePane label="Current" path={v.currentImagePath} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">engine: {v.engine}</Badge>
        <Badge variant="secondary">{v.classification}</Badge>
        <Badge variant="secondary">{v.percentageDifference.toFixed(3)}% diff</Badge>
        <Badge variant="secondary">{v.pixelDifference.toLocaleString()} px</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ImagePane label="Baseline" path={v.baselineImagePath} />
        <ImagePane label="Diff" path={v.diffImagePath} highlight />
        <ImagePane label="Current" path={v.currentImagePath} />
      </div>
    </div>
  );
}

function ImagePane({
  label,
  path,
  highlight,
}: {
  label: string;
  path: string | null;
  highlight?: boolean;
}) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {path ? (
        <a href={path} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={path}
            alt={label}
            className={`w-full rounded border transition-opacity hover:opacity-90 ${
              highlight ? 'border-amber-500' : 'border-border'
            }`}
          />
        </a>
      ) : (
        <div className="flex aspect-video items-center justify-center gap-2 rounded border border-dashed text-muted-foreground">
          <ImageOff className="h-4 w-4" />
          <span className="text-xs">missing</span>
        </div>
      )}
    </figure>
  );
}

function DomPane({ result }: { result: InspectionResult }) {
  const d = result.dom;
  if (!d) return <p className="text-sm text-muted-foreground">DOM dimension not requested.</p>;
  if (d.error) return <p className="text-sm text-rose-500">{d.error}</p>;
  const { added, removed, changed, unchangedCount } = d.diff;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          +{added.length} added
        </Badge>
        <Badge variant="secondary" className="bg-rose-600/10 text-rose-700 dark:text-rose-400">
          −{removed.length} removed
        </Badge>
        <Badge variant="secondary" className="bg-amber-600/10 text-amber-700 dark:text-amber-400">
          ~{changed.length} changed
        </Badge>
        <Badge variant="outline">{unchangedCount} unchanged</Badge>
      </div>
      {added.length === 0 && removed.length === 0 && changed.length === 0 ? (
        <p className="text-muted-foreground">DOM trees match — no structural differences.</p>
      ) : (
        <div className="space-y-3">
          {added.length > 0 && (
            <details open className="rounded-md border bg-muted/20">
              <summary className="cursor-pointer px-3 py-2 font-medium text-emerald-600 dark:text-emerald-400">
                Added ({added.length})
              </summary>
              <ul className="max-h-72 space-y-1 overflow-y-auto border-t bg-background px-3 py-2 font-mono text-xs">
                {added.slice(0, 200).map((el, i) => (
                  <li key={`a-${i}`}>
                    <span className="text-emerald-600 dark:text-emerald-400">+ </span>
                    &lt;{el.tag}&gt;
                    {el.id ? ` #${el.id}` : ''}
                    {el.textContent ? ` — "${el.textContent.slice(0, 80)}"` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {removed.length > 0 && (
            <details open className="rounded-md border bg-muted/20">
              <summary className="cursor-pointer px-3 py-2 font-medium text-rose-600 dark:text-rose-400">
                Removed ({removed.length})
              </summary>
              <ul className="max-h-72 space-y-1 overflow-y-auto border-t bg-background px-3 py-2 font-mono text-xs">
                {removed.slice(0, 200).map((el, i) => (
                  <li key={`r-${i}`}>
                    <span className="text-rose-600 dark:text-rose-400">− </span>
                    &lt;{el.tag}&gt;
                    {el.id ? ` #${el.id}` : ''}
                    {el.textContent ? ` — "${el.textContent.slice(0, 80)}"` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {changed.length > 0 && (
            <details open className="rounded-md border bg-muted/20">
              <summary className="cursor-pointer px-3 py-2 font-medium text-amber-600 dark:text-amber-400">
                Changed ({changed.length})
              </summary>
              <ul className="max-h-72 space-y-1 overflow-y-auto border-t bg-background px-3 py-2 font-mono text-xs">
                {changed.slice(0, 200).map((c, i) => (
                  <li key={`c-${i}`}>
                    <span className="text-amber-600 dark:text-amber-400">~ </span>
                    &lt;{c.current.tag}&gt; [{c.changes.join(', ')}]
                    {c.changes.includes('text') ? (
                      <span>
                        {' '}
                        &ldquo;{c.baseline.textContent?.slice(0, 40) ?? ''}&rdquo; → &ldquo;
                        {c.current.textContent?.slice(0, 40) ?? ''}&rdquo;
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function TextPane({ result }: { result: InspectionResult }) {
  const t = result.text;
  if (!t) return <p className="text-sm text-muted-foreground">Text dimension not requested.</p>;
  if (t.error) return <p className="text-sm text-rose-500">{t.error}</p>;
  const visible = t.lines.filter((l) => l.op !== 'eq').slice(0, 500);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          +{t.added} added
        </Badge>
        <Badge variant="secondary" className="bg-rose-600/10 text-rose-700 dark:text-rose-400">
          −{t.removed} removed
        </Badge>
        <Badge variant="outline">
          {t.baselineLength} → {t.currentLength} text lines
        </Badge>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">Visible text is identical between the two runs.</p>
      ) : (
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed">
          {visible
            .map((l) => `${l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '} ${l.line}`)
            .join('\n')}
        </pre>
      )}
    </div>
  );
}

function NetworkPane({ result }: { result: InspectionResult }) {
  const n = result.network;
  if (!n) return <p className="text-sm text-muted-foreground">Network dimension not requested.</p>;
  if (n.error) return <p className="text-sm text-rose-500">{n.error}</p>;
  const failedDelta = n.summary.failedCountB - n.summary.failedCountA;
  const groups: Array<{ kind: string; rows: typeof n.added }> = [
    { kind: 'added', rows: n.added },
    { kind: 'removed', rows: n.removed },
    { kind: 'changedStatus', rows: n.changedStatus },
    { kind: 'changedSize', rows: n.changedSize },
    { kind: 'slowdowns', rows: n.slowdowns },
  ];
  const interesting = groups.flatMap((g) =>
    g.rows.slice(0, 500).map((row) => ({ ...row, _kind: g.kind })),
  );
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          +{n.added.length} new
        </Badge>
        <Badge variant="secondary" className="bg-rose-600/10 text-rose-700 dark:text-rose-400">
          −{n.removed.length} dropped
        </Badge>
        <Badge variant="secondary">{n.changedStatus.length} status</Badge>
        <Badge variant="secondary">{n.changedSize.length} size</Badge>
        <Badge variant="secondary">{n.slowdowns.length} slowdowns</Badge>
        <Badge variant="outline">
          {n.summary.countA} → {n.summary.countB} reqs
        </Badge>
        {failedDelta !== 0 ? (
          <Badge variant="destructive">
            failed Δ {failedDelta > 0 ? '+' : ''}
            {failedDelta}
          </Badge>
        ) : null}
      </div>
      {interesting.length === 0 ? (
        <p className="text-muted-foreground">No network differences.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-2 py-1.5">Kind</th>
                <th className="px-2 py-1.5">Method</th>
                <th className="px-2 py-1.5">URL</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Δ ms</th>
                <th className="px-2 py-1.5">Δ bytes</th>
              </tr>
            </thead>
            <tbody>
              {interesting.map((row, i) => {
                const dMs =
                  row.baseline && row.current
                    ? row.current.durationMs - row.baseline.durationMs
                    : undefined;
                const dBytes =
                  row.baseline && row.current
                    ? row.current.bytes - row.baseline.bytes
                    : undefined;
                return (
                  <tr key={`${row._kind}-${i}-${row.url}`} className="border-t">
                    <td className="px-2 py-1.5 font-mono">{row._kind}</td>
                    <td className="px-2 py-1.5 font-mono">{row.method}</td>
                    <td className="break-all px-2 py-1.5 font-mono">{row.url}</td>
                    <td className="px-2 py-1.5 font-mono">
                      {row.baseline?.status ?? '—'}
                      {row.current && row.baseline && row.current.status !== row.baseline.status
                        ? ` → ${row.current.status}`
                        : row.current && !row.baseline
                          ? ` → ${row.current.status}`
                          : ''}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {dMs !== undefined ? `${dMs > 0 ? '+' : ''}${dMs}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {dBytes !== undefined ? `${dBytes > 0 ? '+' : ''}${dBytes}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VariablesPane({ result }: { result: InspectionResult }) {
  const v = result.variables;
  if (!v) return <p className="text-sm text-muted-foreground">Variables dimension not requested.</p>;
  if (v.error) return <p className="text-sm text-rose-500">{v.error}</p>;
  const ext = v.extracted.filter((e) => e.kind !== 'unchanged');
  const asg = v.assigned.filter((e) => e.kind !== 'unchanged');
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h4 className="font-medium">Extracted variables</h4>
        {ext.length === 0 ? (
          <p className="text-muted-foreground">No differences.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1.5">Key</th>
                  <th className="px-2 py-1.5">Baseline</th>
                  <th className="px-2 py-1.5">Current</th>
                  <th className="px-2 py-1.5">Kind</th>
                </tr>
              </thead>
              <tbody>
                {ext.map((e) => (
                  <tr key={`ex-${e.key}`} className="border-t">
                    <td className="px-2 py-1.5 font-mono">{e.key}</td>
                    <td className="break-all px-2 py-1.5 font-mono">{e.baseline ?? '∅'}</td>
                    <td className="break-all px-2 py-1.5 font-mono">{e.current ?? '∅'}</td>
                    <td className="px-2 py-1.5">{e.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Assigned variables</h4>
        {asg.length === 0 ? (
          <p className="text-muted-foreground">No differences.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1.5">Key</th>
                  <th className="px-2 py-1.5">Baseline</th>
                  <th className="px-2 py-1.5">Current</th>
                  <th className="px-2 py-1.5">Kind</th>
                </tr>
              </thead>
              <tbody>
                {asg.map((e) => (
                  <tr key={`as-${e.key}`} className="border-t">
                    <td className="px-2 py-1.5 font-mono">{e.key}</td>
                    <td className="break-all px-2 py-1.5 font-mono">{e.baseline ?? '∅'}</td>
                    <td className="break-all px-2 py-1.5 font-mono">{e.current ?? '∅'}</td>
                    <td className="px-2 py-1.5">{e.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Console errors</h4>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="secondary"
            className="bg-rose-600/10 text-rose-700 dark:text-rose-400"
          >
            +{v.consoleErrors.added.length} new
          </Badge>
          <Badge
            variant="secondary"
            className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
          >
            −{v.consoleErrors.removed.length} resolved
          </Badge>
          <Badge variant="outline">{v.consoleErrors.common} shared</Badge>
        </div>
        {v.consoleErrors.added.length > 0 ? (
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
            {v.consoleErrors.added.map((line) => `+ ${line}`).join('\n')}
          </pre>
        ) : null}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Runner logs</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">+{v.logs.addedCount} new</Badge>
          <Badge variant="secondary">−{v.logs.removedCount} dropped</Badge>
        </div>
        {v.logs.sample.length > 0 ? (
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
            {v.logs.sample.map((line) => `+ ${line}`).join('\n')}
          </pre>
        ) : null}
      </section>
    </div>
  );
}

export function InspectTabClient({ testId }: InspectTabClientProps) {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const [baselineId, setBaselineId] = useState<string>('');
  const [engine, setEngine] = useState<DiffEngineType>('pixelmatch');
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [activeDim, setActiveDim] = useState<InspectorDimension>('visual');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const lastRanRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tests/${testId}/inspect`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
        } else {
          const list: RunOption[] = json.runs ?? [];
          setRuns(list);
          if (list.length >= 1) setCurrentId(list[0].id);
          if (list.length >= 2) setBaselineId(list[1].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const swap = () => {
    const c = currentId;
    setCurrentId(baselineId);
    setBaselineId(c);
  };

  const recompute = useCallback(
    (force = false) => {
      if (!currentId || !baselineId) return;
      if (currentId === baselineId) {
        setError('Current and baseline must differ');
        setResult(null);
        return;
      }
      const key = `${baselineId}|${currentId}|${engine}`;
      if (!force && lastRanRef.current === key) return;
      lastRanRef.current = key;
      startTransition(() => {
        setError(null);
        fetch(`/api/tests/${testId}/inspect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            currentResultId: currentId,
            baselineResultId: baselineId,
            engine,
          }),
        })
          .then(async (r) => {
            const json = await r.json();
            if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
            return json as InspectionResult;
          })
          .then((res) => {
            setResult(res);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setResult(null);
            lastRanRef.current = null;
            toast.error(`Inspection failed: ${msg}`);
          });
      });
    },
    [testId, currentId, baselineId, engine],
  );

  // Auto-run on mount or when picker changes — defer to a macrotask so React
  // doesn't see the transition's setState as happening inside the effect body.
  useEffect(() => {
    if (!currentId || !baselineId || currentId === baselineId) return;
    const id = setTimeout(() => recompute(false), 0);
    return () => clearTimeout(id);
  }, [currentId, baselineId, engine, recompute]);

  const runMap = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const currentRun = runMap.get(currentId);
  const baselineRun = runMap.get(baselineId);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading runs…
      </div>
    );
  }
  if (error && runs.length === 0) {
    return <p className="text-sm text-rose-500">Failed to load runs: {error}</p>;
  }
  if (runs.length < 2) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Need at least two prior runs of this test to inspect. Found {runs.length}.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Compare runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Baseline
                </label>
              </div>
              <Select value={baselineId} onValueChange={setBaselineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a baseline run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {runShortLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RunCard run={baselineRun} side="baseline" />
            </div>
            <div className="flex items-center justify-center pt-6 lg:pt-10">
              <Button
                variant="outline"
                size="icon"
                onClick={swap}
                title="Swap baseline and current"
                aria-label="Swap baseline and current"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current
                </label>
              </div>
              <Select value={currentId} onValueChange={setCurrentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a current run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {runShortLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RunCard run={currentRun} side="current" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
            <span className="text-muted-foreground">Visual engine</span>
            <Select value={engine} onValueChange={(v) => setEngine(v as DiffEngineType)}>
              <SelectTrigger className="h-7 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pixelmatch">pixelmatch</SelectItem>
                <SelectItem value="ssim">ssim</SelectItem>
                <SelectItem value="butteraugli">butteraugli</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              {pending && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Inspecting…
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => recompute(true)}
                disabled={pending || !currentId || !baselineId || currentId === baselineId}
                className="gap-1.5"
              >
                {pending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Microscope className="h-3.5 w-3.5" />
                )}
                Re-inspect
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && !pending ? (
        <Card>
          <CardContent className="p-4 text-sm text-rose-500">{error}</CardContent>
        </Card>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <SeverityRow
            classification={result.classification}
            active={activeDim}
            onSelect={setActiveDim}
          />
          <Tabs value={activeDim} onValueChange={(v) => setActiveDim(v as InspectorDimension)}>
            <TabsList className="hidden">
              {DIMENSIONS.map(({ key, label }) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Card>
              <CardContent className="pt-4">
                <TabsContent value="visual" className="mt-0">
                  <VisualPane result={result} />
                </TabsContent>
                <TabsContent value="dom" className="mt-0">
                  <DomPane result={result} />
                </TabsContent>
                <TabsContent value="text" className="mt-0">
                  <TextPane result={result} />
                </TabsContent>
                <TabsContent value="network" className="mt-0">
                  <NetworkPane result={result} />
                </TabsContent>
                <TabsContent value="variables" className="mt-0">
                  <VariablesPane result={result} />
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </div>
      ) : pending ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
            Comparing baseline against current…
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
