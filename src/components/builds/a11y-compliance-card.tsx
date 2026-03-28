'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accessibility, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface A11yComplianceCardProps {
  score: number | null;
  violationCount: number | null;
  criticalCount: number | null;
  totalRulesChecked: number | null;
  trend?: Array<{ id: string; a11yScore: number | null; createdAt: Date | null }>;
}

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-600';
  if (score >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

function getScoreBg(score: number): string {
  if (score >= 90) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 70) return 'bg-yellow-100 dark:bg-yellow-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

export function A11yComplianceCard({
  score,
  violationCount,
  criticalCount,
  totalRulesChecked,
  trend,
}: A11yComplianceCardProps) {
  if (score == null) return null;

  const passedRules = (totalRulesChecked ?? 0) - (violationCount ?? 0);
  const trendScores = trend?.map(t => t.a11yScore).filter((s): s is number => s != null) ?? [];
  const previousScore = trendScores.length >= 2 ? trendScores[trendScores.length - 2] : null;
  const scoreDelta = previousScore != null ? score - previousScore : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Accessibility className="h-4 w-4" />
          WCAG 2.2 AA Compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Score */}
        <div className="flex items-center gap-4">
          <div className={cn('flex items-center justify-center w-16 h-16 rounded-full', getScoreBg(score))}>
            <span className={cn('text-2xl font-bold', getScoreColor(score))}>{score}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {passedRules}/{totalRulesChecked ?? '?'} rules passed
              </span>
              {scoreDelta != null && scoreDelta !== 0 && (
                <Badge variant="outline" className={cn('text-xs', scoreDelta > 0 ? 'text-green-600' : 'text-red-600')}>
                  {scoreDelta > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                  {scoreDelta > 0 ? '+' : ''}{scoreDelta}
                </Badge>
              )}
              {scoreDelta === 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  <Minus className="h-3 w-3 mr-1" />
                  No change
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {(criticalCount ?? 0) > 0 && (
                <span className="text-red-600">{criticalCount} critical/serious</span>
              )}
              {(violationCount ?? 0) > 0 && (
                <span>{violationCount} total violations</span>
              )}
              {(violationCount ?? 0) === 0 && (
                <span className="text-green-600">No violations found</span>
              )}
            </div>
          </div>
        </div>

        {/* Trend sparkline */}
        {trendScores.length >= 2 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-muted-foreground mb-1">Recent trend</div>
            <div className="flex items-end gap-0.5 h-8">
              {trendScores.map((s, i) => {
                const height = Math.max(4, (s / 100) * 32);
                const isLatest = i === trendScores.length - 1;
                return (
                  <div
                    key={i}
                    className={cn(
                      'w-3 rounded-sm transition-all',
                      isLatest ? 'bg-primary' : 'bg-muted-foreground/30',
                      s >= 90 ? 'bg-green-500/60' : s >= 70 ? 'bg-yellow-500/60' : 'bg-red-500/60',
                      isLatest && (s >= 90 ? 'bg-green-500' : s >= 70 ? 'bg-yellow-500' : 'bg-red-500'),
                    )}
                    style={{ height: `${height}px` }}
                    title={`Score: ${s}`}
                  />
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
