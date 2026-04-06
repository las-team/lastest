'use client';

import { useState } from 'react';
import { Plus, Copy, Check, Bot, Tv2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createRunner } from '@/server/actions/runners';
import { useRouter } from 'next/navigation';
import type { RunnerType } from '@/lib/db/schema';

export function CreateRunnerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [runnerType, setRunnerType] = useState<RunnerType>('remote');
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

    const result = await createRunner(name.trim(), ['run', 'record'], runnerType);

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
    const command = runnerType === 'embedded'
      ? `LASTEST_TOKEN=${token} LASTEST_URL=${serverUrl} docker compose up embedded-browser -d --build`
      : `npx @lastest/runner start -t ${token} -s ${serverUrl}`;
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const handleClose = () => {
    setOpen(false);
    setName('');
    setRunnerType('remote');
    setToken(null);
    setError(null);
    if (token) {
      router.refresh();
    }
  };

  const isEmbedded = runnerType === 'embedded';
  const Icon = isEmbedded ? Tv2 : Bot;

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
            <Icon className="w-5 h-5" />
            {token ? (isEmbedded ? 'Embedded Browser Created' : 'Runner Created') : 'Create Runner'}
          </DialogTitle>
          <DialogDescription>
            {token ? (
              'Copy this token now. It will not be shown again.'
            ) : (
              'Create a new runner to execute tests remotely.'
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
              {isEmbedded ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Set the token as <code className="bg-muted px-1 py-0.5 rounded text-xs">LASTEST_TOKEN</code> in your environment or <code className="bg-muted px-1 py-0.5 rounded text-xs">.env</code> file, then start the container:
                  </p>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
{`LASTEST_TOKEN=${token} \\\nLASTEST_URL=${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'} \\\ndocker compose up embedded-browser -d`}
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
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Install Playwright first: <code className="bg-muted px-1 py-0.5 rounded text-xs">npx playwright install chromium</code>
                  </p>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
{`npx @lastest/runner start \\\n  -t ${token} \\\n  -s ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}`}
                    </pre>
                    <p className="text-[11px] text-muted-foreground mt-1.5 opacity-75">
                      Config saved after first run. Manage: <code className="bg-muted px-1 py-0.5 rounded">stop</code> · <code className="bg-muted px-1 py-0.5 rounded">status</code> · <code className="bg-muted px-1 py-0.5 rounded">log -f</code> · <code className="bg-muted px-1 py-0.5 rounded">run</code> (foreground)
                    </p>
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
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="runner-type">Type</Label>
              <Select value={runnerType} onValueChange={(v) => setRunnerType(v as RunnerType)}>
                <SelectTrigger id="runner-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      <span>Remote Runner</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="embedded">
                    <div className="flex items-center gap-2">
                      <Tv2 className="h-4 w-4" />
                      <span>Embedded Browser</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {isEmbedded
                  ? 'Docker container with live browser streaming'
                  : 'CLI agent that runs on your machine'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder={isEmbedded ? 'e.g., Embedded Chrome, Docker Browser' : 'e.g., My Laptop, CI Server, Local Dev'}
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
