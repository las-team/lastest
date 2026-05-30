'use client';

/**
 * Build-level WCAG violation drill-in. Renders directly under the
 * A11yComplianceCard on the build detail page and inside the Verify
 * focus A11y pane. One collapsible row per rule (sorted by severity →
 * occurrence count), each carrying impact / WCAG-level badges, the
 * occurrence count, a "Learn more" link to deque university, and the
 * first sample test that hit the rule (with selector + failureSummary
 * when the harvester captured them).
 *
 * The grouped data is fetched server-side via the
 * `getBuildA11yViolations` server action; this component is purely a
 * renderer with a tiny download menu so QA can pull the same data as
 * CSV or JSON without leaving the page.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Download, ExternalLink, Accessibility } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { BuildA11yViolationRow } from '@/lib/db/queries/builds';

type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

interface A11yViolationsCardProps {
  buildId: string;
  rows: BuildA11yViolationRow[];
  /** Suppress the card wrapper (so this can be embedded inside the
   *  Verify focus pane, which already has its own surface). */
  embedded?: boolean;
}

const IMPACT_STYLE: Record<Severity, string> = {
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
  serious: 'bg-destructive/10 text-destructive border-destructive/20',
  moderate: 'bg-warning/15 text-warning-foreground border-warning/30',
  minor: 'bg-muted text-muted-foreground border-border',
};

function dequeUniversityUrl(rule: string, fallback: string): string {
  // axe-core always ships a helpUrl that points at deque university for
  // the rule (e.g. dequeuniversity.com/rules/axe/4.9/<rule>); use it
  // verbatim when present, otherwise synthesise a search URL so the
  // "Learn more" link always points somewhere useful.
  if (fallback) return fallback;
  return `https://dequeuniversity.com/rules/axe/latest/${encodeURIComponent(rule)}`;
}

function downloadBlob(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function A11yViolationsCard({ buildId, rows, embedded }: A11yViolationsCardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);

  const counts = useMemo(() => {
    const c = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const r of rows) c[r.impact] += 1;
    return c;
  }, [rows]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const downloadJson = () => {
    downloadBlob(
      `build-${buildId}-a11y-violations.json`,
      JSON.stringify({ buildId, violations: rows }, null, 2),
      'application/json',
    );
  };

  const downloadCsv = async () => {
    setIsDownloading(true);
    try {
      // Hit the API rather than re-implementing the CSV writer in the
      // browser — the server-side serialiser is the single source of
      // truth that the programmatic /a11y-violations?format=csv route
      // also uses.
      const res = await fetch(`/api/builds/${buildId}/a11y-violations?format=csv`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`CSV download failed (${res.status})`);
      const text = await res.text();
      downloadBlob(`build-${buildId}-a11y-violations.csv`, text, 'text/csv');
    } catch (err) {
      console.error('[a11y-violations-card] CSV download failed', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{rows.length} rule{rows.length === 1 ? '' : 's'} violated</span>
          {(['critical', 'serious', 'moderate', 'minor'] as Severity[])
            .filter((s) => counts[s] > 0)
            .map((s) => (
              <Badge key={s} variant="outline" className={cn('text-[10px]', IMPACT_STYLE[s])}>
                {counts[s]} {s}
              </Badge>
            ))}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={downloadJson} className="h-7 text-xs gap-1">
            <Download className="h-3 w-3" /> JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={downloadCsv}
            disabled={isDownloading}
            className="h-7 text-xs gap-1"
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      <div className="border rounded-md divide-y">
        {rows.map((r) => {
          const isOpen = expanded.has(r.id);
          return (
            <Collapsible key={r.id} open={isOpen} onOpenChange={() => toggle(r.id)}>
              <CollapsibleTrigger
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition"
                aria-label={`Toggle details for rule ${r.id}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <Badge variant="outline" className={cn('text-[10px] uppercase', IMPACT_STYLE[r.impact])}>
                  {r.impact}
                </Badge>
                {r.wcagLevel && (
                  <Badge variant="outline" className="text-[10px]">
                    WCAG {r.wcagLevel}
                  </Badge>
                )}
                <span className="font-mono text-xs font-medium truncate" title={r.id}>
                  {r.id}
                </span>
                <span className="text-xs text-muted-foreground truncate flex-1" title={r.help}>
                  · {r.help}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {r.occurrenceCount} test{r.occurrenceCount === 1 ? '' : 's'} · {r.totalNodes} node{r.totalNodes === 1 ? '' : 's'}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3 pt-1 bg-muted/30 space-y-2">
                {r.description && (
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                )}
                <a
                  href={dequeUniversityUrl(r.id, r.helpUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Learn more on Deque University
                  <ExternalLink className="h-3 w-3" />
                </a>
                {r.samples.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Sample occurrences
                    </div>
                    {r.samples.map((s, i) => (
                      <div
                        key={`${s.testResultId}-${i}`}
                        className="rounded border bg-background px-2 py-1.5 text-xs space-y-1"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.areaName && (
                            <span className="text-muted-foreground">{s.areaName} ·</span>
                          )}
                          {s.testId ? (
                            <Link
                              href={`/tests/${s.testId}`}
                              className="font-medium text-primary hover:underline truncate"
                              title={s.testName ?? s.testId}
                            >
                              {s.testName ?? s.testId}
                            </Link>
                          ) : (
                            <span className="font-medium truncate">{s.testName ?? '—'}</span>
                          )}
                          <span className="text-muted-foreground ml-auto">
                            {s.nodes} node{s.nodes === 1 ? '' : 's'}
                          </span>
                        </div>
                        {s.sampleNode?.target?.length ? (
                          <div className="font-mono text-[11px] text-foreground/80 break-all">
                            <span className="text-muted-foreground">selector:</span>{' '}
                            {s.sampleNode.target.join(' ')}
                          </div>
                        ) : null}
                        {s.sampleNode?.failureSummary ? (
                          <div className="text-[11px] text-muted-foreground whitespace-pre-line">
                            {s.sampleNode.failureSummary}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );

  if (embedded) {
    return body;
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Accessibility className="h-4 w-4" />
          WCAG Violations · {rows.length} rule{rows.length === 1 ? '' : 's'}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
