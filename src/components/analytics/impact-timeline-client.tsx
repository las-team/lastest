'use client';

import { useState, useTransition, useRef, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TrendingDown, TrendingUp, GitPullRequest, Bug } from 'lucide-react';
import { getImpactTimelineData } from '@/server/actions/analytics';

type TimelineEntry = {
  week: string;
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
  lastMergedAt?: Date | null;
  issuesBefore: number;
  issuesAfter: number;
  beforeRate?: number;
  afterRate?: number;
  percentChange: number;
  totalMergedPRs: number;
  totalIssues?: number;
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

type ChartPoint = {
  weekLabel: string;
  weekKey: string;
  issues: number;
  closed: number;
  prs: { number: number | null; title: string | null; author: string | null }[];
};

function weekKeyToDate(weekKey: string): Date {
  const [yearStr, weekStr] = weekKey.split('-');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

function formatWeekLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function buildContinuousTimeline(
  timeline: TimelineEntry[],
  mergedPRs: MergedPR[],
): ChartPoint[] {
  if (timeline.length === 0 && mergedPRs.length === 0) return [];

  const dataMap = new Map<string, { issues: number; closed: number }>();
  for (const entry of timeline) {
    dataMap.set(entry.week, { issues: entry.count, closed: entry.closedCount });
  }

  const prMap = new Map<string, { number: number | null; title: string | null; author: string | null }[]>();
  for (const pr of mergedPRs) {
    if (!pr.mergedAt) continue;
    const d = new Date(pr.mergedAt);
    const wk = `${d.getUTCFullYear()}-${String(getWeekNumber(d)).padStart(2, '0')}`;
    if (!prMap.has(wk)) prMap.set(wk, []);
    prMap.get(wk)!.push({ number: pr.githubPrNumber, title: pr.title, author: pr.author });
  }

  const allKeys = [...dataMap.keys(), ...prMap.keys()].sort();
  if (allKeys.length === 0) return [];

  const startDate = weekKeyToDate(allKeys[0]);
  const endDate = weekKeyToDate(allKeys[allKeys.length - 1]);

  const points: ChartPoint[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const year = current.getUTCFullYear();
    const wn = getWeekNumber(current);
    const key = `${year}-${String(wn).padStart(2, '0')}`;
    const d = dataMap.get(key);
    const prs = prMap.get(key) ?? [];

    points.push({
      weekKey: key,
      weekLabel: formatWeekLabel(current),
      issues: d?.issues ?? 0,
      closed: d?.closed ?? 0,
      prs,
    });

    current.setUTCDate(current.getUTCDate() + 7);
  }

  return points;
}

/** Compute before/after metrics based on a split index in the chart data */
function computeMetrics(chartData: ChartPoint[], splitIndex: number) {
  const before = chartData.slice(0, splitIndex);
  const after = chartData.slice(splitIndex);

  const issuesBefore = before.reduce((sum, p) => sum + p.issues, 0);
  const issuesAfter = after.reduce((sum, p) => sum + p.issues, 0);

  const beforeWeeks = Math.max(1, before.length);
  const afterWeeks = Math.max(1, after.length);

  const beforeRate = issuesBefore / beforeWeeks;
  const afterRate = issuesAfter / afterWeeks;

  const percentChange = beforeRate > 0
    ? Math.round(((afterRate - beforeRate) / beforeRate) * 100)
    : 0;

  const splitLabel = chartData[splitIndex]?.weekLabel ?? '';

  return {
    issuesBefore,
    issuesAfter,
    beforeRate: Math.round(beforeRate * 10) / 10,
    afterRate: Math.round(afterRate * 10) / 10,
    percentChange,
    splitLabel,
    beforeWeeks,
    afterWeeks,
  };
}

function CustomTooltip(props: Record<string, unknown>) {
  const active = props.active as boolean | undefined;
  const payload = props.payload as Array<{ payload: ChartPoint }> | undefined;
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-md text-sm min-w-[180px]">
      <p className="font-medium mb-1">Week of {point.weekLabel}</p>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'oklch(0.55 0.17 195)' }} />
        <span>Opened: <strong>{point.issues}</strong></span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'oklch(0.68 0.14 195)' }} />
        <span>Closed: <strong>{point.closed}</strong></span>
      </div>
      {point.prs.length > 0 && (
        <div className="mt-2 pt-2 border-t space-y-1">
          {point.prs.map((pr, i) => (
            <div key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitPullRequest className="h-3 w-3 shrink-0" style={{ color: 'oklch(0.65 0.15 280)' }} />
              <span className="truncate">#{pr.number} {pr.title?.slice(0, 35)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ImpactTimelineClient({ repositoryId, initialData }: Props) {
  const [data, setData] = useState<ImpactData | null>(initialData);
  const [selectedAuthor, setSelectedAuthor] = useState<string>('all');
  const [isPending, startTransition] = useTransition();
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBrushChange = useCallback((range: { startIndex?: number; endIndex?: number }) => {
    if (range && typeof range.startIndex === 'number') {
      // Debounce: update cards only after user stops dragging for 150ms
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSplitIndex(range.startIndex!);
      }, 150);
    }
  }, []);

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
      setSplitIndex(null);
    });
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No issue data available. Connect a GitHub repo with issues.
      </div>
    );
  }

  const { timeline, mergedPRs, authors, summary } = data;

  const chartData = buildContinuousTimeline(timeline, mergedPRs);

  // Use slider split or fall back to midpoint
  const effectiveSplit = splitIndex ?? Math.floor(chartData.length / 2);
  const metrics = chartData.length > 0
    ? computeMetrics(chartData, effectiveSplit)
    : null;

  const isImproving = metrics ? metrics.percentChange < 0 : false;
  const splitWeekLabel = chartData[effectiveSplit]?.weekLabel ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PR Impact Timeline</h1>
          <p className="text-sm text-muted-foreground">
            Drag the left slider handle to set the comparison point
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
        </div>
      </div>

      {/* Summary Cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Issues before {splitWeekLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{metrics.issuesBefore}</span>
                <span className="text-xs text-muted-foreground">
                  ({metrics.beforeRate}/wk over {metrics.beforeWeeks}wk)
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Issues from {splitWeekLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-chart-2" />
                <span className="text-2xl font-bold">{metrics.issuesAfter}</span>
                <span className="text-xs text-muted-foreground">
                  ({metrics.afterRate}/wk over {metrics.afterWeeks}wk)
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rate Change
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
                  {metrics.percentChange > 0 ? '+' : ''}{metrics.percentChange}%
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
      )}

      {/* Story text */}
      {metrics && isImproving && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <p className="text-sm">
              Comparing before and after {splitWeekLabel}
              {selectedAuthor !== 'all' ? ` (filtered to ${selectedAuthor})` : ''},
              the issue rate decreased by{' '}
              <strong className="text-primary">{Math.abs(metrics.percentChange)}%</strong> —
              from {metrics.beforeRate}/wk to {metrics.afterRate}/wk.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Issues by Week</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No issue data to display.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={500}>
              <AreaChart data={chartData} margin={{ top: 30, right: 30, left: 0, bottom: 10 }}>
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="weekLabel"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  angle={-35}
                  textAnchor="end"
                  height={60}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                {/* Split point reference line */}
                {chartData[effectiveSplit] && (
                  <ReferenceLine
                    x={chartData[effectiveSplit].weekLabel}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    label={{
                      value: 'Split',
                      position: 'top',
                      fill: 'hsl(var(--foreground))',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="issues"
                  stroke="oklch(0.55 0.17 195)"
                  fill="url(#issueGradient)"
                  strokeWidth={2}
                  name="Opened"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="closed"
                  stroke="oklch(0.68 0.14 195)"
                  fill="url(#closedGradient)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  name="Closed"
                  dot={false}
                />
                {chartData.map((point) =>
                  point.prs.length > 0 ? (
                    <ReferenceLine
                      key={point.weekKey}
                      x={point.weekLabel}
                      stroke="oklch(0.65 0.15 280)"
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                      label={{
                        value: `${point.prs.length} PR${point.prs.length > 1 ? 's' : ''}`,
                        position: 'top',
                        fill: 'oklch(0.65 0.15 280)',
                        fontSize: 10,
                      }}
                    />
                  ) : null,
                )}
                <Brush
                  dataKey="weekLabel"
                  height={35}
                  stroke="hsl(var(--border))"
                  fill="transparent"
                  travellerWidth={10}
                  tickFormatter={() => ''}
                  onChange={handleBrushChange}
                >
                  <AreaChart data={chartData}>
                    <Area
                      type="monotone"
                      dataKey="issues"
                      stroke="oklch(0.55 0.17 195)"
                      fill="oklch(0.55 0.17 195 / 0.1)"
                      strokeWidth={1}
                      dot={false}
                    />
                  </AreaChart>
                </Brush>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* PR merge list */}
      {mergedPRs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Merged PRs ({mergedPRs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto">
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
                      <span>{formatDate(pr.mergedAt)}</span>
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
