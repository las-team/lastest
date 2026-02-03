'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bot, MoreVertical, Trash2, RefreshCw, Copy, Check } from 'lucide-react';
import type { Runner } from '@/lib/db/schema';
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
import { deleteRunner, regenerateRunnerToken } from '@/server/actions/runners';
import { useRouter } from 'next/navigation';

interface RunnerListProps {
  runners: Runner[];
}

export function RunnerList({ runners }: RunnerListProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!selectedRunner) return;
    setLoading(true);
    const result = await deleteRunner(selectedRunner.id);
    setLoading(false);
    setDeleteDialogOpen(false);
    if (!('error' in result)) {
      router.refresh();
    }
  };

  const handleRegenerateToken = async () => {
    if (!selectedRunner) return;
    setLoading(true);
    const result = await regenerateRunnerToken(selectedRunner.id);
    setLoading(false);
    if ('token' in result) {
      setNewToken(result.token);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'online':
        return <Badge variant="default" className="bg-green-500">Online</Badge>;
      case 'busy':
        return <Badge variant="default" className="bg-yellow-500">Busy</Badge>;
      default:
        return <Badge variant="secondary">Offline</Badge>;
    }
  };

  return (
    <>
      <div className="space-y-2">
        {runners.map((runner) => (
          <div
            key={runner.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                runner.status === 'online' ? 'bg-green-500/10' :
                runner.status === 'busy' ? 'bg-yellow-500/10' :
                'bg-muted'
              }`}>
                <Bot className={`w-5 h-5 ${
                  runner.status === 'online' ? 'text-green-500' :
                  runner.status === 'busy' ? 'text-yellow-500' :
                  'text-muted-foreground'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{runner.name}</span>
                  {getStatusBadge(runner.status)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {runner.lastSeen ? (
                    <>Last seen {formatDistanceToNow(runner.lastSeen, { addSuffix: true })}</>
                  ) : (
                    <>Never connected</>
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
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedRunner(runner);
                    setNewToken(null);
                    setTokenDialogOpen(true);
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate Token
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    setSelectedRunner(runner);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Runner</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedRunner?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Token Dialog */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Token</DialogTitle>
            <DialogDescription>
              {newToken ? (
                'Copy this token now. It will not be shown again.'
              ) : (
                `Regenerating the token for "${selectedRunner?.name}" will invalidate the current token. The runner will need to be reconfigured with the new token.`
              )}
            </DialogDescription>
          </DialogHeader>

          {newToken && (
            <div className="relative">
              <div className="bg-muted p-3 rounded-md text-sm pr-12 font-mono break-all">
                {newToken}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={copyToken}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          )}

          <DialogFooter>
            {newToken ? (
              <Button onClick={() => setTokenDialogOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setTokenDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRegenerateToken} disabled={loading}>
                  {loading ? 'Regenerating...' : 'Regenerate'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
