'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Plus, Copy, Check, Trash2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createApiToken, revokeApiToken } from '@/server/actions/api-tokens';
import { useRouter } from 'next/navigation';

export interface ApiTokenRow {
  id: string;
  label: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

export function ApiTokensSection({ tokens, serverUrl }: { tokens: ApiTokenRow[]; serverUrl: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const handleCreate = async () => {
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await createApiToken(label.trim());
    setLoading(false);
    if ('error' in result) {
      setError(result.error);
    } else {
      setCreatedToken(result.token);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setLabel('');
    setError(null);
    if (createdToken) {
      setCreatedToken(null);
      router.refresh();
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? Any clients using it will stop working.')) return;
    await revokeApiToken(id);
    router.refresh();
  };

  const copy = async (text: string, which: 'token' | 'cmd') => {
    await navigator.clipboard.writeText(text);
    if (which === 'token') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  const cmd = createdToken
    ? `claude mcp add lastest -- npx -y @lastest/mcp-server@latest --url ${serverUrl} --api-key ${createdToken}`
    : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> API Keys ({tokens.length})
          </p>
          <p className="text-xs text-muted-foreground">For the MCP server, VS Code extension, and custom scripts.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                {createdToken ? 'API Key Created' : 'Create API Key'}
              </DialogTitle>
              <DialogDescription>
                {createdToken
                  ? 'Copy this key now. It will not be shown again.'
                  : 'Create a long-lived key for an MCP client, the VS Code extension, or a script.'}
              </DialogDescription>
            </DialogHeader>

            {createdToken ? (
              <div className="space-y-4">
                <div className="relative">
                  <div className="bg-muted p-3 rounded-md text-sm pr-12 font-mono break-all">{createdToken}</div>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => copy(createdToken, 'token')}>
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-sm">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-1">Save it now</p>
                  <p className="text-muted-foreground">
                    This key authenticates as your user against the Lastest API. Store it securely and revoke it from this page if compromised.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Add to Claude Code</p>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">{cmd}</pre>
                    <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => copy(cmd, 'cmd')}>
                      {copiedCmd ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground opacity-75">
                    For Claude Desktop, Cursor, and other clients see the{' '}
                    <a className="underline" href="https://github.com/las-team/lastest/wiki/MCP-Server" target="_blank" rel="noreferrer">
                      MCP Server wiki
                    </a>
                    .
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key-label">Label</Label>
                  <Input
                    id="api-key-label"
                    placeholder="e.g., Claude Code laptop, CI bot"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                    }}
                  />
                  <p className="text-sm text-muted-foreground">A name to recognize this key later.</p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            <DialogFooter>
              {createdToken ? (
                <Button onClick={handleClose}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleClose}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={loading}>
                    {loading ? 'Creating...' : 'Create'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {tokens.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground border rounded-md">
          <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No API keys yet</p>
          <p className="text-xs">Create one to connect the MCP server or VS Code extension.</p>
        </div>
      ) : (
        <div className="border rounded-md divide-y">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{t.label ?? 'Unnamed key'}</p>
                <p className="text-xs text-muted-foreground">
                  Created {t.createdAt ? formatDistanceToNow(t.createdAt, { addSuffix: true }) : '—'}
                  {' · '}
                  {t.lastUsedAt ? `last used ${formatDistanceToNow(t.lastUsedAt, { addSuffix: true })}` : 'never used'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleRevoke(t.id)} className="text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
