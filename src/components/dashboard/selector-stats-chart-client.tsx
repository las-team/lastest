'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Maximize2 } from 'lucide-react';
import type { SelectorTypeStats } from '@/lib/db/queries';

interface Props {
  stats: SelectorTypeStats[];
}

const SUCCESS_COLOR = 'oklch(0.75 0.10 155 / 0.7)';
const FAILURE_COLOR = 'oklch(0.70 0.10 25 / 0.7)';

function CustomTooltip(props: Record<string, unknown>) {
  const active = props.active as boolean | undefined;
  const payload = props.payload as Array<{ payload: SelectorTypeStats; name: string; value: number; color: string }> | undefined;
  if (!active || !payload?.length) return null;

  const stat = payload[0]?.payload;
  if (!stat) return null;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-md text-sm min-w-[180px]">
      <p className="font-medium mb-1 capitalize">{stat.selectorType}</p>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SUCCESS_COLOR }} />
        <span>Successes: <strong>{stat.totalSuccesses}</strong></span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: FAILURE_COLOR }} />
        <span>Failures: <strong>{stat.totalFailures}</strong></span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        Success Rate: {stat.successRate}%
        {stat.avgResponseTimeMs != null && ` · Avg: ${stat.avgResponseTimeMs}ms`}
      </div>
    </div>
  );
}

function SelectorChart({ stats, height }: { stats: SelectorTypeStats[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={stats} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="selectorType"
          tick={{ fontSize: height > 250 ? 12 : 10 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
          allowDecimals={false}
        />
        <Tooltip content={<CustomTooltip />} />
        {height > 250 && <Legend />}
        <Bar
          dataKey="totalSuccesses"
          stackId="a"
          fill={SUCCESS_COLOR}
          name="Successes"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="totalFailures"
          stackId="a"
          fill={FAILURE_COLOR}
          name="Failures"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SelectorStatsChartClient({ stats }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Selector Stats</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(true)}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <SelectorChart stats={stats} height={200} />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selector Statistics</DialogTitle>
          </DialogHeader>

          <SelectorChart stats={stats} height={400} />

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4 text-right">Successes</th>
                  <th className="py-2 pr-4 text-right">Failures</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 pr-4 text-right">Avg Response</th>
                  <th className="py-2 text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.selectorType} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium capitalize">{s.selectorType}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: SUCCESS_COLOR }}>{s.totalSuccesses}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: FAILURE_COLOR }}>{s.totalFailures}</td>
                    <td className="py-2 pr-4 text-right">{s.totalAttempts}</td>
                    <td className="py-2 pr-4 text-right">{s.avgResponseTimeMs != null ? `${s.avgResponseTimeMs}ms` : '—'}</td>
                    <td className="py-2 text-right">{s.successRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
