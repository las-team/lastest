'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Tv2, MoreVertical, Trash2, Unlock } from 'lucide-react';
import type { EmbeddedSession } from '@/lib/db/schema';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { releaseEmbeddedSession, destroyEmbeddedSession } from '@/server/actions/embedded-sessions';
import { useRouter } from 'next/navigation';

interface EmbeddedSessionListProps {
  sessions: EmbeddedSession[];
  isAdmin?: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ready':
      return <Badge variant="default" className="bg-green-500">Ready</Badge>;
    case 'busy':
      return <Badge variant="default" className="bg-yellow-500">Busy</Badge>;
    case 'starting':
      return <Badge variant="default" className="bg-blue-500">Starting</Badge>;
    case 'stopping':
      return <Badge variant="secondary">Stopping</Badge>;
    case 'stopped':
      return <Badge variant="secondary">Stopped</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function EmbeddedSessionList({ sessions, isAdmin = false }: EmbeddedSessionListProps) {
  const router = useRouter();
  const [destroyDialogOpen, setDestroyDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<EmbeddedSession | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRelease = async (session: EmbeddedSession) => {
    setLoading(true);
    const result = await releaseEmbeddedSession(session.id);
    setLoading(false);
    if (!('error' in result)) {
      router.refresh();
    }
  };

  const handleDestroy = async () => {
    if (!selectedSession) return;
    setLoading(true);
    const result = await destroyEmbeddedSession(selectedSession.id);
    setDestroyDialogOpen(false);
    setLoading(false);
    if (!('error' in result)) {
      router.refresh();
    }
  };

  return (
    <>
      <div className="space-y-2">
        {sessions.map((session) => (
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
                <Tv2 className={`w-5 h-5 ${
                  session.status === 'ready' ? 'text-green-500' :
                  session.status === 'busy' ? 'text-yellow-500' :
                  'text-muted-foreground'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium font-mono text-sm">{session.id.slice(0, 8)}</span>
                  {getStatusBadge(session.status)}
                  {session.viewport && (
                    <span className="text-xs text-muted-foreground">
                      {session.viewport.width}x{session.viewport.height}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {session.streamUrl && (
                    <span className="font-mono text-xs">{session.streamUrl}</span>
                  )}
                  {session.lastActivityAt && (
                    <span className="ml-2">
                      · Active {formatDistanceToNow(session.lastActivityAt, { addSuffix: true })}
                    </span>
                  )}
                  {session.userId && (
                    <span className="ml-2">· Claimed by user</span>
                  )}
                </div>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {session.status === 'busy' && (
                  <DropdownMenuItem onClick={() => handleRelease(session)} disabled={loading}>
                    <Unlock className="w-4 h-4 mr-2" />
                    Release
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => {
                        setSelectedSession(session);
                        setDestroyDialogOpen(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Destroy
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* Destroy Confirmation Dialog */}
      <Dialog open={destroyDialogOpen} onOpenChange={setDestroyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy Embedded Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to destroy this embedded browser session? This will remove the session record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDestroyDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDestroy} disabled={loading}>
              {loading ? 'Destroying...' : 'Destroy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
