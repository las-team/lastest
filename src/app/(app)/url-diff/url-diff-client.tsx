'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { startUrlDiff } from '@/server/actions/url-diff';
import { useJobResult } from '@/components/queue/use-job-result';
import { Loader2, AlertCircle } from 'lucide-react';

type Viewport = '1280x720' | '1920x1080' | '375x667';

const PRESETS: Record<Viewport, { width: number; height: number }> = {
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 },
  '375x667': { width: 375, height: 667 },
};

interface UrlDiffResultShape {
  visual: {
    baselineRelPath: string;
    currentRelPath: string;
    diffRelPath: string;
    pixelDifference: number;
    percentageDifference: number;
    defaultKey?: string;
    variants?: Array<{
      key: string;
      label: string;
      diffRelPath: string;
      pixelDifference: number;
      percentageDifference: number;
    }>;
  };
  dom: {
    added: unknown[];
    removed: unknown[];
    changed: unknown[];
    unchangedCount?: number;
    summary?: string;
  };
  network: {
    added: Array<{ url: string; method: string }>;
    removed: Array<{ url: string; method: string }>;
    changedStatus: Array<{
      url: string;
      method: string;
      baseline?: { status: number };
      current?: { status: number };
    }>;
    changedSize: Array<{
      url: string;
      method: string;
      baseline?: { bytes: number };
      current?: { bytes: number };
    }>;
    slowdowns: Array<{
      url: string;
      method: string;
      baseline?: { durationMs: number };
      current?: { durationMs: number };
    }>;
    summary: {
      countA: number;
      countB: number;
      bytesA: number;
      bytesB: number;
      thirdPartyDomainsA: string[];
      thirdPartyDomainsB: string[];
    };
  };
  a11y: {
    newInB: Array<{ id: string; impact: string; help: string; nodes: number }>;
    fixedInB: Array<{ id: string; impact: string; help: string; nodes: number }>;
    regressed: Array<{ ruleId: string; nodesA: number; nodesB: number }>;
    improved: Array<{ ruleId: string; nodesA: number; nodesB: number }>;
    scoreA: { score: number; violatedRules: number; passedRules: number };
    scoreB: { score: number; violatedRules: number; passedRules: number };
    scoreDelta: number;
  };
  text: {
    status: 'unchanged' | 'changed' | 'baseline_only' | 'current_only' | 'skipped';
    summary: { added: number; removed: number; sameAsBaseline: boolean };
    lines: Array<{ op: 'add' | 'del' | 'eq'; line: string; oldLineNo?: number; newLineNo?: number }>;
  };
}

export function UrlDiffClient() {
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [viewport, setViewport] = useState<Viewport>('1280x720');
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const { job, isComplete, isFailed, error } = useJobResult(jobId, { pollInterval: 2000 });

  const result = useMemo<UrlDiffResultShape | null>(() => {
    if (!isComplete || !job?.metadata) return null;
    const meta = job.metadata as Record<string, unknown>;
    return (meta.urlDiffResult as UrlDiffResultShape | undefined) ?? null;
  }, [isComplete, job]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlA || !urlB) {
      toast.error('Both URLs are required');
      return;
    }
    setSubmitting(true);
    setJobId(null);
    try {
      const { jobId: newJobId } = await startUrlDiff({
        urlA,
        urlB,
        viewport: PRESETS[viewport],
        isCookieSession: true,
      });
      setJobId(newJobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start URL Diff');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <header>
        <h1 className="text-2xl font-bold">URL Diff</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Compare two URLs across visual, DOM, network, and accessibility dimensions.
        </p>
      </header>

      <Card className="p-6">
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="urlA">URL A (baseline)</Label>
              <Input
                id="urlA"
                type="url"
                placeholder="https://example.com"
                value={urlA}
                onChange={(e) => setUrlA(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="urlB">URL B (current)</Label>
              <Input
                id="urlB"
                type="url"
                placeholder="https://example.org"
                value={urlB}
                onChange={(e) => setUrlB(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="grid gap-2">
              <Label>Viewport</Label>
              <Select value={viewport} onValueChange={(v) => setViewport(v as Viewport)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1280x720">Desktop · 1280×720</SelectItem>
                  <SelectItem value="1920x1080">Desktop HD · 1920×1080</SelectItem>
                  <SelectItem value="375x667">Mobile · 375×667</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={submitting || (!!jobId && !isComplete && !isFailed)}>
              {submitting || (jobId && !isComplete && !isFailed) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Diffing
                </>
              ) : (
                'Compare URLs'
              )}
            </Button>
          </div>
        </form>
      </Card>

      {jobId && !result && !isFailed && (
        <Card className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <div>
            <div className="font-medium">Capturing both URLs in parallel…</div>
            <div className="text-sm text-muted-foreground">
              {job?.label} · step {job?.completedSteps ?? 0}/{job?.totalSteps ?? 4}
            </div>
          </div>
        </Card>
      )}

      {(isFailed || error) && (
        <Card className="p-6 border-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <div className="font-medium">URL Diff failed</div>
              <div className="text-sm text-muted-foreground mt-1">{job?.error || error}</div>
            </div>
          </div>
        </Card>
      )}

      {result && <UrlDiffResultView result={result} />}
    </div>
  );
}

function UrlDiffResultView({ result }: { result: UrlDiffResultShape }) {
  return (
    <Tabs defaultValue="visual" className="w-full">
      <TabsList>
        <TabsTrigger value="visual">
          Visual{' '}
          <Badge variant="secondary" className="ml-2">
            {result.visual.percentageDifference.toFixed(1)}%
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="dom">
          DOM{' '}
          <Badge variant="secondary" className="ml-2">
            {result.dom.added.length + result.dom.removed.length + result.dom.changed.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="network">
          Network{' '}
          <Badge variant="secondary" className="ml-2">
            {result.network.added.length + result.network.removed.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="a11y">
          A11y / WCAG{' '}
          <Badge variant="secondary" className="ml-2">
            {result.a11y.scoreDelta >= 0 ? '+' : ''}
            {result.a11y.scoreDelta}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="text">
          Text{' '}
          <Badge variant="secondary" className="ml-2">
            +{result.text.summary.added}/-{result.text.summary.removed}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="visual">
        <VisualTab visual={result.visual} />
      </TabsContent>

      <TabsContent value="dom">
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Added" value={result.dom.added.length} />
            <Stat label="Removed" value={result.dom.removed.length} />
            <Stat label="Changed" value={result.dom.changed.length} />
          </div>
          {result.dom.summary && (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded max-h-96 overflow-auto">
              {result.dom.summary}
            </pre>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="network">
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <SideStat
              title="A"
              count={result.network.summary.countA}
              bytes={result.network.summary.bytesA}
              thirdParties={result.network.summary.thirdPartyDomainsA}
            />
            <SideStat
              title="B"
              count={result.network.summary.countB}
              bytes={result.network.summary.bytesB}
              thirdParties={result.network.summary.thirdPartyDomainsB}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Added" value={result.network.added.length} />
            <Stat label="Removed" value={result.network.removed.length} />
            <Stat label="Status changed" value={result.network.changedStatus.length} />
            <Stat label="Slowdowns" value={result.network.slowdowns.length} />
          </div>
          {result.network.changedStatus.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">Status changes</div>
              <div className="text-xs font-mono space-y-1 max-h-64 overflow-auto">
                {result.network.changedStatus.map((c, i) => (
                  <div key={i} className="truncate">
                    <span className="text-muted-foreground">{c.method}</span>{' '}
                    <span className="text-destructive">{c.baseline?.status}→{c.current?.status}</span>{' '}
                    {c.url}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="a11y">
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <ScoreCard label="A" score={result.a11y.scoreA.score} violations={result.a11y.scoreA.violatedRules} />
            <ScoreCard label="B" score={result.a11y.scoreB.score} violations={result.a11y.scoreB.violatedRules} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="New violations" value={result.a11y.newInB.length} />
            <Stat label="Fixed" value={result.a11y.fixedInB.length} />
            <Stat label="Regressed" value={result.a11y.regressed.length} />
            <Stat label="Improved" value={result.a11y.improved.length} />
          </div>
          {result.a11y.newInB.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">New in B</div>
              <div className="text-xs space-y-1 max-h-64 overflow-auto">
                {result.a11y.newInB.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <Badge variant="outline">{v.impact}</Badge>
                    <span className="font-mono">{v.id}</span>
                    <span className="text-muted-foreground">×{v.nodes}</span>
                    <span className="truncate">{v.help}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="text">
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Lines added" value={result.text.summary.added} />
            <Stat label="Lines removed" value={result.text.summary.removed} />
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-sm capitalize">
                {result.text.status.replace(/_/g, ' ')}
              </div>
            </div>
          </div>
          {result.text.lines.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              {result.text.status === 'unchanged'
                ? 'Page text is identical between A and B.'
                : result.text.status === 'skipped'
                  ? 'Text capture not available for this run.'
                  : 'No line-level diff to render.'}
            </div>
          ) : (
            <pre className="text-xs font-mono bg-muted p-3 rounded max-h-96 overflow-auto">
              {result.text.lines.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.op === 'add'
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : l.op === 'del'
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                        : 'opacity-60'
                  }
                >
                  {l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '} {l.line}
                </div>
              ))}
            </pre>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function VisualTab({ visual }: { visual: UrlDiffResultShape['visual'] }) {
  const variants =
    visual.variants && visual.variants.length > 0
      ? visual.variants
      : [
          {
            key: 'pixelmatch',
            label: 'Pixelmatch',
            diffRelPath: visual.diffRelPath,
            pixelDifference: visual.pixelDifference,
            percentageDifference: visual.percentageDifference,
          },
        ];
  const [selectedKey, setSelectedKey] = useState(visual.defaultKey ?? variants[0]!.key);
  const selected = variants.find((v) => v.key === selectedKey) ?? variants[0]!;
  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <Button
            key={v.key}
            type="button"
            size="sm"
            variant={v.key === selected.key ? 'default' : 'outline'}
            onClick={() => setSelectedKey(v.key)}
          >
            {v.label}
            <span className="ml-2 opacity-70">{v.percentageDifference.toFixed(1)}%</span>
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScreenshotPanel label="A (baseline)" rel={visual.baselineRelPath} />
        <ScreenshotPanel label="B (current)" rel={visual.currentRelPath} />
        <ScreenshotPanel label={`Diff · ${selected.label}`} rel={selected.diffRelPath} />
      </div>
      <div className="text-sm text-muted-foreground">
        {selected.pixelDifference.toLocaleString()} pixels different ·{' '}
        {selected.percentageDifference.toFixed(2)}% of content area
      </div>
    </Card>
  );
}

function ScreenshotPanel({ label, rel }: { label: string; rel: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <a href={`/api/media${rel}`} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/media${rel}`} alt={label} className="w-full h-auto border rounded" />
      </a>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-mono">{value}</div>
    </div>
  );
}

function SideStat({
  title,
  count,
  bytes,
  thirdParties,
}: {
  title: string;
  count: number;
  bytes: number;
  thirdParties: string[];
}) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-lg font-mono">{count} requests</div>
      <div className="text-xs text-muted-foreground">{(bytes / 1024).toFixed(1)} KB</div>
      <div className="text-xs text-muted-foreground mt-1">
        {thirdParties.length} 3rd-party domain{thirdParties.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function ScoreCard({ label, score, violations }: { label: string; score: number; violations: number }) {
  return (
    <div className="border rounded p-4 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold mt-1">{score}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {violations} violation{violations === 1 ? '' : 's'}
      </div>
    </div>
  );
}
