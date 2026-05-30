'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Palette, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DesignSystemComplianceCardProps {
  score: number | null;
  violationCount: number | null;
  criticalCount: number | null;
  totalRulesChecked: number | null;
  trend?: Array<{ id: string; designSystemScore: number | null; createdAt: Date | null }>;
}

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-success';
  if (score >= 70) return 'text-warning';
  return 'text-destructive';
}

function getScoreBg(score: number): string {
  if (score >= 90) return 'bg-success/15';
  if (score >= 70) return 'bg-warning/15';
  return 'bg-destructive/15';
}

export function DesignSystemComplianceCard({
  score,
  violationCount,
  criticalCount,
  totalRulesChecked,
  trend,
}: DesignSystemComplianceCardProps) {
  if (score == null) return null;

  const passedRules = (totalRulesChecked ?? 0) - (violationCount ?? 0);
  const trendScores = trend?.map((t) => t.designSystemScore).filter((s): s is number => s != null) ?? [];
  const previousScore = trendScores.length >= 2 ? trendScores[trendScores.length - 2] : null;
  const scoreDelta = previousScore != null ? score - previousScore : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4" />
          Design System Compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          <div className={cn('flex items-center justify-center w-16 h-16 rounded-full', getScoreBg(score))}>
            <span className={cn('text-2xl font-bold', getScoreColor(score))}>{score}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {totalRulesChecked ? `${passedRules}/${totalRulesChecked} token checks passed` : 'No token data collected'}
              </span>
              {scoreDelta != null && scoreDelta !== 0 && (
                <Badge variant="outline" className={cn('text-xs', scoreDelta > 0 ? 'text-success' : 'text-destructive')}>
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
                <span className="text-destructive">{criticalCount} critical off-token</span>
              )}
              {(violationCount ?? 0) > 0 && (
                <span>{violationCount} total off-token values</span>
              )}
              {(violationCount ?? 0) === 0 && (
                <span className="text-success">All sampled values on-token</span>
              )}
            </div>
          </div>
        </div>

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
                      s >= 90 ? 'bg-success/60' : s >= 70 ? 'bg-warning/60' : 'bg-destructive/60',
                      isLatest && (s >= 90 ? 'bg-success' : s >= 70 ? 'bg-warning' : 'bg-destructive'),
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
