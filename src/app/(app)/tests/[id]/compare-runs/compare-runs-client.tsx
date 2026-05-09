'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, ArrowRightLeft, CheckCircle, Clock, GitBranch, GitCommit, ImageOff, Loader2, Minus, Plus, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  compareTwoRuns,
  type RunCompareCandidate,
  type RunComparisonResult,
} from '@/server/actions/compare-runs';

interface CompareRunsClientProps {
  testId: string;
  testName: string;
  candidates: RunCompareCandidate[];
  initialFromId: string | null;
  initialToId: string | null;
}

function formatDate(d: Date | string | null): string {
  if (!d) return 'unknown time';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function deltaMs(a: number | null, b: number | null): { delta: number; sign: '+' | '-' | '=' } | null {
  if (a == null || b == null) return null;
  const delta = b - a;
  if (delta === 0) return { delta: 0, sign: '=' };
  return { delta: Math.abs(delta), sign: delta > 0 ? '+' : '-' };
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

function describeCandidate(c: RunCompareCandidate): string {
  const date = c.startedAt ? formatDate(c.startedAt) : 'no timestamp';
  const branch = c.gitBranch ? ` · ${c.gitBranch}` : '';
  const commit = c.gitCommit && c.gitCommit !== 'unknown' ? ` @ ${c.gitCommit.slice(0, 7)}` : '';
  return `${date}${branch}${commit}`;
}

function CandidateRow({ c, side }: { c: RunCompareCandidate | null; side: 'from' | 'to' }) {
  if (!c) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Pick a {side === 'from' ? 'baseline' : 'comparison'} run.
      </div>
    );
  }
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <StatusBadge status={c.status} />
        <span className="text-muted-foreground">{formatDate(c.startedAt)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {c.gitBranch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {c.gitBranch}
          </span>
        )}
        {c.gitCommit && c.gitCommit !== 'unknown' && (
          <span className="inline-flex items-center gap-1 font-mono">
            <GitCommit className="h-3 w-3" />
            {c.gitCommit.slice(0, 7)}
          </span>
        )}
        {c.durationMs != null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(c.durationMs)}
          </span>
        )}
        {c.viewport && <span className="font-mono">{c.viewport}</span>}
        {c.browser && <span>{c.browser}</span>}
      </div>
    </div>
  );
}

function MetricDelta({
  label,
  fromValue,
  toValue,
  format = (n) => String(n),
  invert = false,
}: {
  label: string;
  fromValue: number;
  toValue: number;
  format?: (n: number) => string;
  invert?: boolean;
}) {
  const delta = toValue - fromValue;
  // For metrics where lower is better (errors, duration), `invert` reverses
  // the green/red mapping so improvements always read as green.
  let color = 'text-muted-foreground';
  if (delta > 0) color = invert ? 'text-destructive' : 'text-amber-600';
  if (delta < 0) color = invert ? 'text-green-600' : 'text-amber-600';
  if (delta === 0) color = 'text-muted-foreground';
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-3 text-sm">
        <span>{format(fromValue)}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span>{format(toValue)}</span>
        {delta !== 0 && (
          <span className={`font-medium ${color}`}>
            {delta > 0 ? <Plus className="h-3 w-3 inline" /> : <Minus className="h-3 w-3 inline" />}
            {format(Math.abs(delta))}
          </span>
        )}
        {delta === 0 && <span className="text-muted-foreground">no change</span>}
      </div>
    </div>
  );
}

function PairView({ pair }: { pair: RunComparisonResult['pairs'][number] }) {
  const [view, setView] = useState<'side' | 'diff'>('side');
  const hasBoth = !!pair.fromPath && !!pair.toPath;
  const hasDiff = !!pair.diffPath;
  const pct = pair.percentageDifference;

  let badge = null as React.ReactNode;
  if (pair.error) {
    badge = <Badge variant="destructive">error</Badge>;
  } else if (!hasBoth) {
    badge = <Badge variant="outline">only in {pair.fromPath ? 'baseline' : 'current'}</Badge>;
  } else if (pct != null && pct < 0.01) {
    badge = <Badge className="bg-green-600 hover:bg-green-600">unchanged</Badge>;
  } else if (pct != null) {
    badge = <Badge variant="secondary">{pct.toFixed(2)}% diff</Badge>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm truncate">{pair.label}</CardTitle>
            {pair.error && (
              <CardDescription className="text-destructive">{pair.error}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge}
            {hasBoth && hasDiff && (
              <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  type="button"
                  className={`px-2 py-1 ${view === 'side' ? 'bg-accent' : 'hover:bg-muted'}`}
                  onClick={() => setView('side')}
                >
                  Side-by-side
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 border-l border-border ${view === 'diff' ? 'bg-accent' : 'hover:bg-muted'}`}
                  onClick={() => setView('diff')}
                >
                  Diff overlay
                </button>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {view === 'side' && (
          <div className="grid grid-cols-2 gap-3">
            <ImagePane label="Baseline" path={pair.fromPath} />
            <ImagePane label="Current" path={pair.toPath} />
          </div>
        )}
        {view === 'diff' && hasDiff && (
          <div className="grid grid-cols-3 gap-3">
            <ImagePane label="Baseline" path={pair.fromPath} />
            <ImagePane label="Diff" path={pair.diffPath} highlight />
            <ImagePane label="Current" path={pair.toPath} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImagePane({ label, path, highlight }: { label: string; path: string | null; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <a href={path} target="_blank" rel="noopener noreferrer">
          <img
            src={path}
            alt={label}
            className={`w-full rounded border ${highlight ? 'border-amber-500' : 'border-border'} hover:opacity-90 transition-opacity`}
          />
        </a>
      ) : (
        <div className="aspect-video rounded border border-dashed border-border flex items-center justify-center text-muted-foreground gap-2">
          <ImageOff className="h-4 w-4" />
          <span className="text-xs">missing</span>
        </div>
      )}
    </div>
  );
}

export function CompareRunsClient({
  testId,
  testName,
  candidates,
  initialFromId,
  initialToId,
}: CompareRunsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Default selection: most recent run (index 0) → "to" (current), runner-up → "from" (baseline).
  const defaultTo = initialToId || candidates[0]?.id || '';
  const defaultFrom = initialFromId
    || (candidates[1]?.id ?? (candidates[0] && candidates[0].id !== defaultTo ? candidates[0].id : ''));

  const [fromId, setFromId] = useState(defaultFrom);
  const [toId, setToId] = useState(defaultTo);
  const [comparison, setComparison] = useState<RunComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fromCandidate = useMemo(() => candidates.find((c) => c.id === fromId) ?? null, [candidates, fromId]);
  const toCandidate = useMemo(() => candidates.find((c) => c.id === toId) ?? null, [candidates, toId]);

  const runComparison = useCallback(
    (a: string, b: string) => {
      if (!a || !b) return;
      if (a === b) {
        setError('Pick two different runs to compare');
        setComparison(null);
        return;
      }
      setError(null);
      startTransition(async () => {
        try {
          const result = await compareTwoRuns(testId, a, b);
          setComparison(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setComparison(null);
          toast.error(`Compare failed: ${msg}`);
        }
      });
    },
    [testId],
  );

  // Reflect the picker selection in the URL so the comparison is shareable
  // and the page is restorable on reload. `?from=…&to=…` are the only params
  // we care about — anything else is preserved.
  useEffect(() => {
    if (!fromId || !toId) return;
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    if (sp.get('from') === fromId && sp.get('to') === toId) return;
    sp.set('from', fromId);
    sp.set('to', toId);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [fromId, toId, router, searchParams]);

  // Auto-run on mount (or whenever picker values change) so the user sees
  // a result immediately if defaults are present. Deferred to a macrotask so
  // React doesn't see the transition's setState as happening inside the
  // effect body.
  useEffect(() => {
    if (!fromId || !toId || fromId === toId) return;
    const id = setTimeout(() => runComparison(fromId, toId), 0);
    return () => clearTimeout(id);
  }, [fromId, toId, runComparison]);

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  if (candidates.length === 0) {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Compare runs · {testName}</CardTitle>
            <CardDescription>This test has no recorded runs yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Run this test at least twice and come back to diff its history without rebuilding.
            </p>
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link href={`/tests?test=${encodeURIComponent(testId)}`}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back to test
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (candidates.length === 1) {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Compare runs · {testName}</CardTitle>
            <CardDescription>Only one run on file — at least two are needed to compare.</CardDescription>
          </CardHeader>
          <CardContent>
            <CandidateRow c={candidates[0]} side="to" />
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link href={`/tests?test=${encodeURIComponent(testId)}`}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back to test
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pairsWithChange = comparison
    ? comparison.pairs.filter((p) => (p.percentageDifference ?? 0) > 0.01 || !p.fromPath || !p.toPath || !!p.error)
    : [];
  const pairsUnchanged = comparison
    ? comparison.pairs.filter((p) => p.fromPath && p.toPath && !p.error && (p.percentageDifference ?? 0) <= 0.01)
    : [];

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Compare runs</h1>
            <p className="text-sm text-muted-foreground">
              Diff stored screenshots from two existing runs of <span className="font-medium">{testName}</span> — no build required.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/tests?test=${encodeURIComponent(testId)}`}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to test
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick two runs</CardTitle>
            <CardDescription>Defaults to the most recent run vs. the one before it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Baseline (from)</label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a run" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={c.id === toId}>
                        {describeCandidate(c)} · {c.status ?? 'unknown'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CandidateRow c={fromCandidate} side="from" />
              </div>

              <div className="flex justify-center pb-2">
                <Button variant="ghost" size="icon" onClick={swap} title="Swap baseline and current">
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Current (to)</label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a run" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={c.id === fromId}>
                        {describeCandidate(c)} · {c.status ?? 'unknown'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CandidateRow c={toCandidate} side="to" />
              </div>
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}

            <div className="flex items-center gap-2">
              <Button onClick={() => runComparison(fromId, toId)} disabled={pending || !fromId || !toId || fromId === toId} size="sm">
                {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {pending ? 'Comparing…' : 'Compare'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Comparison is computed on demand from already-captured screenshots.
              </span>
            </div>
          </CardContent>
        </Card>

        {comparison && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Run-level deltas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Status</div>
                    <div className="flex items-center gap-2 text-sm">
                      <StatusBadge status={comparison.fromMeta.status} />
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <StatusBadge status={comparison.toMeta.status} />
                    </div>
                  </div>
                  <MetricDelta
                    label="Duration"
                    fromValue={comparison.fromMeta.durationMs ?? 0}
                    toValue={comparison.toMeta.durationMs ?? 0}
                    format={(n) => formatDuration(n)}
                    invert
                  />
                  <MetricDelta
                    label="Console errors"
                    fromValue={comparison.fromMeta.consoleErrorCount}
                    toValue={comparison.toMeta.consoleErrorCount}
                    invert
                  />
                  <MetricDelta
                    label="A11y violations"
                    fromValue={comparison.fromMeta.a11yViolationCount}
                    toValue={comparison.toMeta.a11yViolationCount}
                    invert
                  />
                </div>

                {(comparison.newConsoleErrors.length > 0 || comparison.resolvedConsoleErrors.length > 0) && (
                  <>
                    <Separator className="my-4" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                          New console errors ({comparison.newConsoleErrors.length})
                        </div>
                        {comparison.newConsoleErrors.length === 0 ? (
                          <div className="text-muted-foreground text-xs">none</div>
                        ) : (
                          <ul className="space-y-1">
                            {comparison.newConsoleErrors.slice(0, 8).map((m, i) => (
                              <li key={i} className="text-destructive text-xs font-mono break-all">{m}</li>
                            ))}
                            {comparison.newConsoleErrors.length > 8 && (
                              <li className="text-xs text-muted-foreground">
                                +{comparison.newConsoleErrors.length - 8} more…
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                          Resolved console errors ({comparison.resolvedConsoleErrors.length})
                        </div>
                        {comparison.resolvedConsoleErrors.length === 0 ? (
                          <div className="text-muted-foreground text-xs">none</div>
                        ) : (
                          <ul className="space-y-1">
                            {comparison.resolvedConsoleErrors.slice(0, 8).map((m, i) => (
                              <li key={i} className="text-green-700 dark:text-green-400 text-xs font-mono break-all">{m}</li>
                            ))}
                            {comparison.resolvedConsoleErrors.length > 8 && (
                              <li className="text-xs text-muted-foreground">
                                +{comparison.resolvedConsoleErrors.length - 8} more…
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">
                  Screenshot diffs ({pairsWithChange.length} changed, {pairsUnchanged.length} unchanged)
                </h2>
              </div>
              {pairsWithChange.length === 0 && pairsUnchanged.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    Neither run captured any screenshots — nothing to diff visually.
                  </CardContent>
                </Card>
              )}
              {pairsWithChange.map((pair) => (
                <PairView key={pair.label} pair={pair} />
              ))}
              {pairsUnchanged.length > 0 && (
                <details className="rounded-md border border-border">
                  <summary className="cursor-pointer p-3 text-sm">
                    {pairsUnchanged.length} unchanged screenshot{pairsUnchanged.length === 1 ? '' : 's'}
                  </summary>
                  <div className="p-3 space-y-3 border-t border-border">
                    {pairsUnchanged.map((pair) => (
                      <PairView key={pair.label} pair={pair} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </>
        )}

        {!comparison && !pending && !error && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              Pick two runs above and hit Compare.
            </CardContent>
          </Card>
        )}

        {pending && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Diffing screenshots…
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
