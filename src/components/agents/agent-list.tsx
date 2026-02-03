'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bot, MoreVertical, Trash2, RefreshCw, Copy, Check } from 'lucide-react';
import type { Agent } from '@/lib/db/schema';
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
import { deleteAgent, regenerateAgentToken } from '@/server/actions/agents';
import { useRouter } from 'next/navigation';

interface AgentListProps {
  agents: Agent[];
}

export function AgentList({ agents }: AgentListProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!selectedAgent) return;
    setLoading(true);
    const result = await deleteAgent(selectedAgent.id);
    setLoading(false);
    setDeleteDialogOpen(false);
    if (!('error' in result)) {
      router.refresh();
    }
  };

  const handleRegenerateToken = async () => {
    if (!selectedAgent) return;
    setLoading(true);
    const result = await regenerateAgentToken(selectedAgent.id);
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
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                agent.status === 'online' ? 'bg-green-500/10' :
                agent.status === 'busy' ? 'bg-yellow-500/10' :
                'bg-muted'
              }`}>
                <Bot className={`w-5 h-5 ${
                  agent.status === 'online' ? 'text-green-500' :
                  agent.status === 'busy' ? 'text-yellow-500' :
                  'text-muted-foreground'
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  {getStatusBadge(agent.status)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {agent.lastSeen ? (
                    <>Last seen {formatDistanceToNow(agent.lastSeen, { addSuffix: true })}</>
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
                    setSelectedAgent(agent);
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
                    setSelectedAgent(agent);
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
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedAgent?.name}&quot;? This action cannot be undone.
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
                `Regenerating the token for "${selectedAgent?.name}" will invalidate the current token. The agent will need to be reconfigured with the new token.`
              )}
            </DialogDescription>
          </DialogHeader>

          {newToken && (
            <div className="relative">
              <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto pr-12">
                <code className="break-all">{newToken}</code>
              </pre>
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
