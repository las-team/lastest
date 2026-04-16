import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tv2 } from 'lucide-react';
import type { EmbeddedSession, Runner } from '@/lib/db/schema';
import { formatDistanceToNow } from 'date-fns';

interface BrowserPoolCardProps {
  sessions: EmbeddedSession[];
  systemRunners: Runner[];
}

export function BrowserPoolCard({ sessions, systemRunners }: BrowserPoolCardProps) {
  const readyCount = sessions.filter((s) => s.status === 'ready').length;
  const busyCount = sessions.filter((s) => s.status === 'busy').length;
  const total = sessions.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Tv2 className="w-5 h-5" />
              Browser Pool
            </CardTitle>
            <CardDescription>
              System browsers auto-assigned for test execution.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {readyCount}/{total} available
            </Badge>
            {busyCount > 0 && (
              <Badge variant="default" className="bg-yellow-500 text-xs">
                {busyCount} busy
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sessions.map((session) => {
            const runner = systemRunners.find((r) => r.id === session.runnerId);
            return (
              <div
                key={session.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    session.status === 'ready' ? 'bg-green-500/10' :
                    session.status === 'busy' ? 'bg-yellow-500/10' :
                    'bg-muted'
                  }`}>
                    <Tv2 className={`w-4 h-4 ${
                      session.status === 'ready' ? 'text-green-500' :
                      session.status === 'busy' ? 'text-yellow-500' :
                      'text-muted-foreground'
                    }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {runner?.name || `EB-${session.id.slice(0, 6)}`}
                      </span>
                      <StatusBadge status={session.status} />
                      {session.viewport && (
                        <span className="text-xs text-muted-foreground">
                          {session.viewport.width}x{session.viewport.height}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {session.status === 'busy' && session.busySince && (
                        <span>Busy for {formatDistanceToNow(session.busySince)}</span>
                      )}
                      {session.status === 'ready' && session.lastActivityAt && (
                        <span>Idle since {formatDistanceToNow(session.lastActivityAt, { addSuffix: true })}</span>
                      )}
                      {session.status !== 'ready' && session.status !== 'busy' && (
                        <span>{session.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ready':
      return <Badge variant="default" className="bg-green-500 text-[10px] px-1.5 py-0">Ready</Badge>;
    case 'busy':
      return <Badge variant="default" className="bg-yellow-500 text-[10px] px-1.5 py-0">Busy</Badge>;
    case 'starting':
      return <Badge variant="default" className="bg-blue-500 text-[10px] px-1.5 py-0">Starting</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{status}</Badge>;
  }
}
