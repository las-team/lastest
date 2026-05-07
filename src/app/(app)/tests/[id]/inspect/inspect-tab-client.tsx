'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeftRight, Microscope, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type {
  DiffEngineType,
  InspectionResult,
  InspectorClassification,
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
  hasScreenshot: boolean;
  hasDom: boolean;
  hasNetwork: boolean;
  hasVariables: boolean;
}

interface InspectTabClientProps {
  testId: string;
}

const SEVERITY_COLOR: Record<InspectorSeverity, string> = {
  unchanged: 'bg-emerald-500',
  minor: 'bg-amber-500',
  changed: 'bg-rose-500',
  unavailable: 'bg-zinc-300 dark:bg-zinc-600',
};

function severityLabel(s: InspectorSeverity): string {
  switch (s) {
    case 'unchanged':
      return 'no change';
    case 'minor':
      return 'minor';
    case 'changed':
      return 'changed';
    case 'unavailable':
      return 'n/a';
  }
}

function formatRunOption(run: RunOption): string {
  const ts = run.startedAt ? new Date(run.startedAt).toLocaleString() : '—';
  const status = run.status ?? '—';
  const browser = run.browser ?? 'chromium';
  return `${ts} · ${status} · ${browser}`;
}

function ChipStrip({ classification }: { classification: InspectorClassification }) {
  const order: Array<{ key: keyof InspectorClassification; label: string }> = [
    { key: 'visual', label: 'Visual' },
    { key: 'dom', label: 'DOM' },
    { key: 'text', label: 'Text' },
    { key: 'network', label: 'Network' },
    { key: 'variables', label: 'Variables' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {order.map(({ key, label }) => {
        const sev = classification[key];
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
            title={severityLabel(sev)}
          >
            <span className={`h-2 w-2 rounded-full ${SEVERITY_COLOR[sev]}`} />
            <span>{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function VisualPane({ result }: { result: InspectionResult }) {
  const v = result.visual;
  if (!v) return <p className="text-sm text-muted-foreground">Visual dimension not requested.</p>;
  if (v.error) return <p className="text-sm text-rose-500">{v.error}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <Badge variant="secondary">engine: {v.engine}</Badge>
        <Badge variant="secondary">{v.classification}</Badge>
        <Badge variant="secondary">{v.percentageDifference.toFixed(3)}% diff</Badge>
        <Badge variant="secondary">{v.pixelDifference.toLocaleString()} px</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {v.baselineImagePath ? (
          <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">Baseline</figcaption>
            <img
              src={`/api/storage/${v.baselineImagePath}`}
              alt="baseline"
              className="w-full rounded border"
            />
          </figure>
        ) : null}
        {v.currentImagePath ? (
          <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">Current</figcaption>
            <img
              src={`/api/storage/${v.currentImagePath}`}
              alt="current"
              className="w-full rounded border"
            />
          </figure>
        ) : null}
        {v.diffImagePath ? (
          <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">Diff</figcaption>
            <img
              src={`/api/storage/${v.diffImagePath}`}
              alt="diff"
              className="w-full rounded border"
            />
          </figure>
        ) : null}
      </div>
    </div>
  );
}

function DomPane({ result }: { result: InspectionResult }) {
  const d = result.dom;
  if (!d) return <p className="text-sm text-muted-foreground">DOM dimension not requested.</p>;
  if (d.error) return <p className="text-sm text-rose-500">{d.error}</p>;
  const { added, removed, changed, unchangedCount } = d.diff;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">+{added.length} added</Badge>
        <Badge variant="secondary">−{removed.length} removed</Badge>
        <Badge variant="secondary">~{changed.length} changed</Badge>
        <Badge variant="outline">{unchangedCount} unchanged</Badge>
      </div>
      {added.length > 0 && (
        <details open className="rounded border p-2">
          <summary className="cursor-pointer font-medium text-emerald-600">
            Added ({added.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {added.slice(0, 200).map((el, i) => (
              <li key={`a-${i}`}>
                <span className="text-emerald-600">+ </span>
                &lt;{el.tag}&gt;
                {el.id ? ` #${el.id}` : ''}
                {el.textContent ? ` — "${el.textContent.slice(0, 80)}"` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {removed.length > 0 && (
        <details open className="rounded border p-2">
          <summary className="cursor-pointer font-medium text-rose-600">
            Removed ({removed.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {removed.slice(0, 200).map((el, i) => (
              <li key={`r-${i}`}>
                <span className="text-rose-600">− </span>
                &lt;{el.tag}&gt;
                {el.id ? ` #${el.id}` : ''}
                {el.textContent ? ` — "${el.textContent.slice(0, 80)}"` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {changed.length > 0 && (
        <details open className="rounded border p-2">
          <summary className="cursor-pointer font-medium text-amber-600">
            Changed ({changed.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {changed.slice(0, 200).map((c, i) => (
              <li key={`c-${i}`}>
                <span className="text-amber-600">~ </span>
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
        <Badge variant="secondary">+{t.added} added lines</Badge>
        <Badge variant="secondary">−{t.removed} removed lines</Badge>
        <Badge variant="outline">
          {t.baselineLength} → {t.currentLength} text lines
        </Badge>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">Visible text is identical between the two runs.</p>
      ) : (
        <pre className="max-h-96 overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
          {visible
            .map(
              (l) =>
                `${l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '} ${l.line}`,
            )
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
  const interesting = n.rows.filter((r) => r.kind !== 'unchanged').slice(0, 500);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">+{n.summary.added} new</Badge>
        <Badge variant="secondary">−{n.summary.removed} dropped</Badge>
        <Badge variant="secondary">~{n.summary.changed} changed</Badge>
        <Badge variant="outline">{n.summary.unchanged} unchanged</Badge>
        {n.summary.failedDelta !== 0 ? (
          <Badge variant="destructive">failed Δ {n.summary.failedDelta > 0 ? '+' : ''}{n.summary.failedDelta}</Badge>
        ) : null}
      </div>
      {interesting.length === 0 ? (
        <p className="text-muted-foreground">No network differences.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Kind</th>
                <th className="px-2 py-1">Method</th>
                <th className="px-2 py-1">URL</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Δ ms</th>
                <th className="px-2 py-1">Δ size</th>
                <th className="px-2 py-1">Changes</th>
              </tr>
            </thead>
            <tbody>
              {interesting.map((row) => (
                <tr key={row.key} className="border-t">
                  <td className="px-2 py-1 font-mono">
                    {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '~'}
                  </td>
                  <td className="px-2 py-1 font-mono">{row.method}</td>
                  <td className="px-2 py-1 font-mono break-all">{row.url}</td>
                  <td className="px-2 py-1 font-mono">
                    {row.baseline?.status ?? '—'}
                    {row.current && row.baseline && row.current.status !== row.baseline.status
                      ? ` → ${row.current.status}`
                      : row.current
                        ? ` → ${row.current.status}`
                        : ''}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {row.durationDeltaMs !== undefined
                      ? `${row.durationDeltaMs > 0 ? '+' : ''}${row.durationDeltaMs}`
                      : '—'}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {row.sizeDelta !== undefined
                      ? `${row.sizeDelta > 0 ? '+' : ''}${row.sizeDelta}`
                      : '—'}
                  </td>
                  <td className="px-2 py-1">{row.changes.join(', ') || '—'}</td>
                </tr>
              ))}
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
    <div className="space-y-4 text-sm">
      <section>
        <h4 className="mb-2 font-medium">Extracted variables</h4>
        {ext.length === 0 ? (
          <p className="text-muted-foreground">No differences.</p>
        ) : (
          <table className="w-full border text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Key</th>
                <th className="px-2 py-1">Baseline</th>
                <th className="px-2 py-1">Current</th>
                <th className="px-2 py-1">Kind</th>
              </tr>
            </thead>
            <tbody>
              {ext.map((e) => (
                <tr key={`ex-${e.key}`} className="border-t">
                  <td className="px-2 py-1 font-mono">{e.key}</td>
                  <td className="px-2 py-1 font-mono break-all">{e.baseline ?? '∅'}</td>
                  <td className="px-2 py-1 font-mono break-all">{e.current ?? '∅'}</td>
                  <td className="px-2 py-1">{e.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h4 className="mb-2 font-medium">Assigned variables</h4>
        {asg.length === 0 ? (
          <p className="text-muted-foreground">No differences.</p>
        ) : (
          <table className="w-full border text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Key</th>
                <th className="px-2 py-1">Baseline</th>
                <th className="px-2 py-1">Current</th>
                <th className="px-2 py-1">Kind</th>
              </tr>
            </thead>
            <tbody>
              {asg.map((e) => (
                <tr key={`as-${e.key}`} className="border-t">
                  <td className="px-2 py-1 font-mono">{e.key}</td>
                  <td className="px-2 py-1 font-mono break-all">{e.baseline ?? '∅'}</td>
                  <td className="px-2 py-1 font-mono break-all">{e.current ?? '∅'}</td>
                  <td className="px-2 py-1">{e.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h4 className="mb-2 font-medium">Console errors</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">+{v.consoleErrors.added.length} new</Badge>
          <Badge variant="secondary">−{v.consoleErrors.removed.length} dropped</Badge>
          <Badge variant="outline">{v.consoleErrors.common} shared</Badge>
        </div>
        {v.consoleErrors.added.length > 0 ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/30 p-2 font-mono text-xs">
            {v.consoleErrors.added.map((line) => `+ ${line}`).join('\n')}
          </pre>
        ) : null}
      </section>
      <section>
        <h4 className="mb-2 font-medium">Runner logs</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">+{v.logs.addedCount} new</Badge>
          <Badge variant="secondary">−{v.logs.removedCount} dropped</Badge>
        </div>
        {v.logs.sample.length > 0 ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/30 p-2 font-mono text-xs">
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);

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

  const recompute = () => {
    if (!currentId || !baselineId) {
      toast.error('Pick a current and a baseline run first');
      return;
    }
    if (currentId === baselineId) {
      toast.error('Current and baseline must differ');
      return;
    }
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
          toast.success(
            `Inspection complete in ${(Date.now() - res.computedAtMs) === 0 ? '<1' : '~'}ms (cache key ${res.cacheKey.slice(0, 8)})`,
          );
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          toast.error('Inspection failed');
        });
    });
  };

  const runMap = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const currentRun = runMap.get(currentId);
  const baselineRun = runMap.get(baselineId);

  if (loading) return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  if (error && runs.length === 0)
    return <p className="text-sm text-rose-500">Failed to load runs: {error}</p>;
  if (runs.length < 2)
    return (
      <p className="text-sm text-muted-foreground">
        Need at least two prior runs of this test to compare. Found {runs.length}.
      </p>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Current run</label>
              <Select value={currentId} onValueChange={setCurrentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {formatRunOption(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={swap} title="Swap">
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Baseline run</label>
              <Select value={baselineId} onValueChange={setBaselineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {formatRunOption(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={recompute} disabled={pending} className="gap-2">
              {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
              Inspect
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">Visual engine:</span>
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
            {currentRun && baselineRun ? (
              <span className="text-muted-foreground">
                Current: {currentRun.hasScreenshot ? '✓screenshot' : '·'}
                {currentRun.hasDom ? ' ✓dom' : ''}
                {currentRun.hasNetwork ? ' ✓network' : ''}
                {currentRun.hasVariables ? ' ✓vars' : ''}
                {' · Baseline: '}
                {baselineRun.hasScreenshot ? '✓screenshot' : '·'}
                {baselineRun.hasDom ? ' ✓dom' : ''}
                {baselineRun.hasNetwork ? ' ✓network' : ''}
                {baselineRun.hasVariables ? ' ✓vars' : ''}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      {result ? (
        <div className="space-y-4">
          <ChipStrip classification={result.classification} />
          <Tabs defaultValue="visual">
            <TabsList>
              <TabsTrigger value="visual">Visual</TabsTrigger>
              <TabsTrigger value="dom">DOM</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="network">Network</TabsTrigger>
              <TabsTrigger value="variables">Variables</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="mt-4">
              <VisualPane result={result} />
            </TabsContent>
            <TabsContent value="dom" className="mt-4">
              <DomPane result={result} />
            </TabsContent>
            <TabsContent value="text" className="mt-4">
              <TextPane result={result} />
            </TabsContent>
            <TabsContent value="network" className="mt-4">
              <NetworkPane result={result} />
            </TabsContent>
            <TabsContent value="variables" className="mt-4">
              <VariablesPane result={result} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick two runs and click <strong>Inspect</strong> to compare them.
        </p>
      )}
    </div>
  );
}

