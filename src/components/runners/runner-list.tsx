'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bot, MoreVertical, Trash2, RefreshCw, Copy, Check, Settings, Layers, Square, Tv2, Server } from 'lucide-react';
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
import { deleteRunner, regenerateRunnerToken, updateRunnerSettings, stopRunner } from '@/server/actions/runners';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';

interface RunnerListProps {
  runners: Runner[];
  systemRunners?: Runner[];
}

export function RunnerList({ runners, systemRunners = [] }: RunnerListProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parallelTests, setParallelTests] = useState(1);

  const handleDelete = async () => {
    if (!selectedRunner) return;
    setLoading(true);
    try {
      const result = await deleteRunner(selectedRunner.id);
      setDeleteDialogOpen(false);
      if (!('error' in result)) {
        router.refresh();
      }
    } catch {
      setDeleteDialogOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateToken = async () => {
    if (!selectedRunner) return;
    setLoading(true);
    try {
      const result = await regenerateRunnerToken(selectedRunner.id);
      if ('token' in result) {
        setNewToken(result.token);
      }
    } catch {
      // Server action threw — close dialog so it doesn't get stuck
      setTokenDialogOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedRunner) return;
    setLoading(true);
    const result = await updateRunnerSettings(selectedRunner.id, {
      maxParallelTests: parallelTests,
    });
    setLoading(false);
    if (!('error' in result)) {
      setSettingsDialogOpen(false);
      router.refresh();
    }
  };

  const handleStopRunner = async (runner: Runner) => {
    const result = await stopRunner(runner.id);
    if ('error' in result) {
      console.error('Failed to stop runner:', result.error);
    } else {
      // Refresh to show updated status
      setTimeout(() => router.refresh(), 1000);
    }
  };

  const openSettingsDialog = (runner: Runner) => {
    setSelectedRunner(runner);
    setParallelTests(runner.maxParallelTests ?? 1);
    setSettingsDialogOpen(true);
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
                {runner.type === 'embedded' ? (
                  <Tv2 className={`w-5 h-5 ${
                    runner.status === 'online' ? 'text-green-500' :
                    runner.status === 'busy' ? 'text-yellow-500' :
                    'text-muted-foreground'
                  }`} />
                ) : (
                  <Bot className={`w-5 h-5 ${
                    runner.status === 'online' ? 'text-green-500' :
                    runner.status === 'busy' ? 'text-yellow-500' :
                    'text-muted-foreground'
                  }`} />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{runner.name}</span>
                  {getStatusBadge(runner.status)}
                  {(runner.maxParallelTests ?? 1) > 1 && (
                    <Badge variant="outline" className="text-xs">
                      <Layers className="w-3 h-3 mr-1" />
                      {runner.maxParallelTests}x
                    </Badge>
                  )}
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
                {runner.status !== 'offline' && (
                  <DropdownMenuItem onClick={() => handleStopRunner(runner)}>
                    <Square className="w-4 h-4 mr-2" />
                    Stop Runner
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => openSettingsDialog(runner)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
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

        {/* System runners (read-only, host-provided) */}
        {systemRunners.map((runner) => (
          <div
            key={runner.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card opacity-80"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                runner.status === 'online' ? 'bg-blue-500/10' :
                runner.status === 'busy' ? 'bg-yellow-500/10' :
                'bg-muted'
              }`}>
                <Server className={`w-5 h-5 ${
                  runner.status === 'online' ? 'text-blue-500' :
                  runner.status === 'busy' ? 'text-yellow-500' :
                  'text-muted-foreground'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{runner.name}</span>
                  {getStatusBadge(runner.status)}
                  <Badge variant="outline" className="text-xs text-blue-500 border-blue-500/30">
                    System
                  </Badge>
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

      {/* Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Runner Settings</DialogTitle>
            <DialogDescription>
              Configure settings for &quot;{selectedRunner?.name}&quot;
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm">Parallel Tests</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Number of tests to run simultaneously on this runner
              </p>
              <div className="flex items-center gap-4">
                <Slider
                  value={[parallelTests]}
                  onValueChange={([value]) => setParallelTests(value)}
                  min={1}
                  max={8}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm font-medium w-8 text-center">{parallelTests}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings} disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
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
