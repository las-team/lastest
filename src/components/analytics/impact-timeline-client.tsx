'use client';

import { useState, useTransition } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TrendingDown, TrendingUp, GitPullRequest, Bug, RefreshCw } from 'lucide-react';
import { getImpactTimelineData, syncIssuesManual } from '@/server/actions/analytics';

type TimelineEntry = {
  week: string;
  weekStart: number;
  count: number;
  closedCount: number;
};

type MergedPR = {
  id: string;
  title: string | null;
  author: string | null;
  mergedAt: Date | null;
  githubPrNumber: number | null;
};

type Summary = {
  firstMergedAt: Date | null;
  issuesBefore: number;
  issuesAfter: number;
  beforeRate?: number;
  afterRate?: number;
  percentChange: number;
  totalMergedPRs: number;
};

type ImpactData = {
  timeline: TimelineEntry[];
  mergedPRs: MergedPR[];
  authors: string[];
  summary: Summary;
};

interface Props {
  repositoryId: string | null;
  initialData: ImpactData | null;
}

export function ImpactTimelineClient({ repositoryId, initialData }: Props) {
  const [data, setData] = useState<ImpactData | null>(initialData);
  const [selectedAuthor, setSelectedAuthor] = useState<string>('all');
  const [isPending, startTransition] = useTransition();

  if (!repositoryId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Select a repository to view impact analytics.
      </div>
    );
  }

  const handleAuthorChange = (author: string) => {
    setSelectedAuthor(author);
    startTransition(async () => {
      const result = await getImpactTimelineData(
        repositoryId,
        author === 'all' ? undefined : author,
      );
      setData(result);
    });
  };

  const handleSync = () => {
    startTransition(async () => {
      await syncIssuesManual(repositoryId);
      const result = await getImpactTimelineData(
        repositoryId,
        selectedAuthor === 'all' ? undefined : selectedAuthor,
      );
      setData(result);
    });
  };

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <p>No issue data available. Connect a GitHub repo with issues labeled &quot;bug&quot;.</p>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
          Sync Issues
        </Button>
      </div>
    );
  }

  const { timeline, mergedPRs, authors, summary } = data;
  const isImproving = summary.percentChange < 0;

  // Prepare chart data — map week labels to readable format
  const chartData = timeline.map((entry) => ({
    week: entry.week,
    issues: entry.count,
    closed: entry.closedCount,
  }));

  // Map merged PRs to their week for reference lines
  const prWeeks = mergedPRs
    .filter((pr) => pr.mergedAt)
    .map((pr) => {
      const d = new Date(pr.mergedAt!);
      const year = d.getFullYear();
      const week = String(getWeekNumber(d)).padStart(2, '0');
      return {
        weekKey: `${year}-${week}`,
        label: `PR #${pr.githubPrNumber}: ${pr.title?.slice(0, 40) ?? 'Untitled'}`,
        author: pr.author,
      };
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PR Impact Timeline</h1>
          <p className="text-sm text-muted-foreground">
            Bug issues over time with PR merge markers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedAuthor} onValueChange={handleAuthorChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All authors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All authors</SelectItem>
              {authors.map((author) => (
                <SelectItem key={author} value={author}>
                  {author}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Issues Before
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{summary.issuesBefore}</span>
              {summary.beforeRate !== undefined && (
                <span className="text-xs text-muted-foreground">({summary.beforeRate}/wk)</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Issues After
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-chart-2" />
              <span className="text-2xl font-bold">{summary.issuesAfter}</span>
              {summary.afterRate !== undefined && (
                <span className="text-xs text-muted-foreground">({summary.afterRate}/wk)</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Change in Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {isImproving ? (
                <TrendingDown className="h-5 w-5 text-primary" />
              ) : (
                <TrendingUp className="h-5 w-5 text-destructive" />
              )}
              <span className={`text-2xl font-bold ${isImproving ? 'text-primary' : 'text-destructive'}`}>
                {summary.percentChange > 0 ? '+' : ''}{summary.percentChange}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Merged PRs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <GitPullRequest className="h-5 w-5 text-chart-3" />
              <span className="text-2xl font-bold">{summary.totalMergedPRs}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Story text */}
      {summary.firstMergedAt && isImproving && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <p className="text-sm">
              Since adopting Lastest
              {selectedAuthor !== 'all' ? ` (${selectedAuthor}'s contributions)` : ''},
              the weekly bug issue rate decreased by{' '}
              <strong className="text-primary">{Math.abs(summary.percentChange)}%</strong> —
              from {summary.beforeRate}/week to {summary.afterRate}/week across{' '}
              {summary.totalMergedPRs} merged PRs.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Bug Issues by Week</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No issue data to display.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <defs>
                  <linearGradient id="issueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.55 0.17 195)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="oklch(0.55 0.17 195)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="closedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.68 0.14 195)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="oklch(0.68 0.14 195)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="issues"
                  stroke="oklch(0.55 0.17 195)"
                  fill="url(#issueGradient)"
                  strokeWidth={2}
                  name="New Issues"
                />
                <Area
                  type="monotone"
                  dataKey="closed"
                  stroke="oklch(0.68 0.14 195)"
                  fill="url(#closedGradient)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  name="Closed"
                />
                {prWeeks.map((pr, i) => (
                  <ReferenceLine
                    key={i}
                    x={pr.weekKey}
                    stroke="oklch(0.65 0.15 280)"
                    strokeDasharray="3 3"
                    label={{
                      value: 'PR',
                      position: 'top',
                      fill: 'oklch(0.65 0.15 280)',
                      fontSize: 10,
                    }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* PR merge list */}
      {mergedPRs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Merged PRs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mergedPRs.map((pr) => (
                <div key={pr.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <GitPullRequest className="h-4 w-4 text-chart-3" />
                    <span className="font-medium">#{pr.githubPrNumber}</span>
                    <span className="text-muted-foreground truncate max-w-md">{pr.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    {pr.author && <span>{pr.author}</span>}
                    {pr.mergedAt && (
                      <span>{new Date(pr.mergedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
