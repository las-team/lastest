'use client';

import { useState } from 'react';
import { Plus, Copy, Check, Bot } from 'lucide-react';
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
import { createRunner } from '@/server/actions/runners';
import { useRouter } from 'next/navigation';

export function CreateRunnerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createRunner(name.trim());

    setLoading(false);

    if ('error' in result) {
      setError(result.error);
    } else {
      setToken(result.token);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCommand = async () => {
    if (!token) return;
    const serverUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const command = `npx @lastest/runner start -t ${token} -s ${serverUrl}`;
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const handleClose = () => {
    setOpen(false);
    setName('');
    setToken(null);
    setError(null);
    if (token) {
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleClose();
      } else {
        setOpen(true);
      }
    }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Create Runner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            {token ? 'Runner Created' : 'Create Runner'}
          </DialogTitle>
          <DialogDescription>
            {token ? (
              'Copy this token now. It will not be shown again.'
            ) : (
              'Create a new runner to run tests remotely on your machine.'
            )}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-4">
            <div className="relative">
              <div className="bg-muted p-3 rounded-md text-sm pr-12 font-mono break-all">
                {token}
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

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-sm">
              <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                Important
              </p>
              <p className="text-muted-foreground">
                This token provides access to run tests on behalf of your team.
                Keep it secure and never share it publicly.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Quick Start</p>
              <p className="text-xs text-muted-foreground">
                Install Playwright first: <code className="bg-muted px-1 py-0.5 rounded text-xs">npx playwright install chromium</code>
              </p>
              <div className="relative">
                <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
{`npx @lastest/runner start \\\n  -t ${token} \\\n  -s ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}`}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={copyCommand}
                >
                  {copiedCommand ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Runner Name</Label>
              <Input
                id="name"
                placeholder="e.g., My Laptop, CI Server, Local Dev"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreate();
                  }
                }}
              />
              <p className="text-sm text-muted-foreground">
                A descriptive name to identify this runner
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={loading}>
                {loading ? 'Creating...' : 'Create'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
