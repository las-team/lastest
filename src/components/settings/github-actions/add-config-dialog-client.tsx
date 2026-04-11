'use client';

import { useState, useEffect } from 'react';
import { Loader2, Cloud, Server, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Runner, Repository, GithubActionMode, GithubActionTriggerEvent } from '@/lib/db/schema';
import { WorkflowPreview } from '@/components/settings/github-actions/workflow-preview-client';
import { createGithubActionConfigAction } from '@/server/actions/github-actions';
import { toast } from 'sonner';

interface AddConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runners: Runner[];
  repos: Repository[];
  githubUsername: string | null;
}

const TRIGGER_OPTIONS: { value: GithubActionTriggerEvent; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'pull_request', label: 'Pull Request' },
  { value: 'workflow_dispatch', label: 'Manual Dispatch' },
  { value: 'schedule', label: 'Schedule (cron)' },
];

const VERCEL_PREVIEW_URL = 'https://${{ github.event.repository.name }}-git-${{ github.head_ref }}-${{ github.repository_owner }}.vercel.app';

export function AddConfigDialog({ open, onOpenChange, runners, repos, githubUsername }: AddConfigDialogProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [manualEntry, setManualEntry] = useState(false);
  const [repoOwner, setRepoOwner] = useState(githubUsername ?? '');
  const [repoName, setRepoName] = useState('');
  const [mode, setMode] = useState<GithubActionMode>('persistent');
  const [runnerId, setRunnerId] = useState<string>('');
  const [triggerEvents, setTriggerEvents] = useState<GithubActionTriggerEvent[]>([
    'push',
    'pull_request',
    'workflow_dispatch',
  ]);
  const [branches, setBranches] = useState('');
  const [cronSchedule, setCronSchedule] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [timeout, setTimeout_] = useState('300000');
  const [failOnChanges, setFailOnChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const githubRepos = repos.filter((r) => r.provider === 'github');

  useEffect(() => {
    if (open) {
      setSelectedRepoId('');
      setManualEntry(false);
      setRepoOwner(githubUsername ?? '');
      setRepoName('');
      setMode('persistent');
      setRunnerId('');
      setTriggerEvents(['push', 'pull_request', 'workflow_dispatch']);
      setBranches('');
      setCronSchedule('');
      setTargetUrl('');
      setTimeout_('300000');
      setFailOnChanges(false);
    }
  }, [open, githubUsername]);

  const handleRepoSelect = (value: string) => {
    if (value === '__manual__') {
      setManualEntry(true);
      setSelectedRepoId('');
      setRepoOwner(githubUsername ?? '');
      setRepoName('');
      return;
    }
    setManualEntry(false);
    setSelectedRepoId(value);
    const repo = githubRepos.find((r) => r.id === value);
    if (repo) {
      setRepoOwner(repo.owner);
      setRepoName(repo.name);
    }
  };

  const toggleTrigger = (event: GithubActionTriggerEvent) => {
    setTriggerEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const branchFilter = branches
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  const workflowConfig = {
    mode,
    repositoryOwner: repoOwner || 'owner',
    repositoryName: repoName || 'repo',
    triggerEvents,
    branchFilter,
    cronSchedule: cronSchedule || null,
    targetUrl: targetUrl || null,
    timeout: parseInt(timeout, 10) || 300000,
    failOnChanges,
  };

  const canSave = repoOwner.trim() && repoName.trim();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await createGithubActionConfigAction({
        repositoryOwner: repoOwner.trim(),
        repositoryName: repoName.trim(),
        mode,
        runnerId: runnerId || undefined,
        triggerEvents,
        branchFilter,
        cronSchedule: cronSchedule || undefined,
        targetUrl: targetUrl || undefined,
        timeout: parseInt(timeout, 10) || 300000,
        failOnChanges,
      });
      toast.success('Config created');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create config');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Repository</DialogTitle>
          <DialogDescription>
            Configure a GitHub Actions workflow for visual testing
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 min-h-0 flex-1 overflow-hidden">
          {/* Left: Configuration */}
          <div className="space-y-4 overflow-y-auto pr-1">
            {/* Repository */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Repository</h4>
              {githubRepos.length > 0 && !manualEntry ? (
                <Select value={selectedRepoId} onValueChange={handleRepoSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository..." />
                  </SelectTrigger>
                  <SelectContent>
                    {githubRepos.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.fullName}
                      </SelectItem>
                    ))}
                    <SelectItem value="__manual__">Enter manually...</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2">
                  {githubRepos.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-0"
                      onClick={() => { setManualEntry(false); setSelectedRepoId(''); }}
                    >
                      Back to repo list
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="repo-owner" className="text-xs">
                        Owner <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="repo-owner"
                        value={repoOwner}
                        onChange={(e) => setRepoOwner(e.target.value)}
                        placeholder="owner"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="repo-name" className="text-xs">
                        Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="repo-name"
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        placeholder="repository"
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Mode */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Mode</h4>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    mode === 'auto'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setMode('auto')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Zap className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Auto</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Server picks the best available runner.
                  </p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    mode === 'persistent'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setMode('persistent')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Server className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Persistent</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Uses an existing runner. GH Actions only triggers.
                  </p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    mode === 'ephemeral'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setMode('ephemeral')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Cloud className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Ephemeral</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Runner inside the GH Actions job. Playwright cached.
                  </p>
                </button>
              </div>
            </div>

            {/* Runner (persistent mode) */}
            {mode === 'persistent' && runners.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Runner (optional)</h4>
                <Select value={runnerId} onValueChange={setRunnerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a runner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {runners.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}{' '}
                        <span className="text-muted-foreground">({r.status})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Triggers */}
            <div className="space-y-2">
              <Label className="text-xs">Trigger Events</Label>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {TRIGGER_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={triggerEvents.includes(opt.value)}
                      onCheckedChange={() => toggleTrigger(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Branch filter + cron */}
            <div className="space-y-1">
              <Label htmlFor="branches" className="text-xs">
                Branch filter (comma-separated)
              </Label>
              <Input
                id="branches"
                value={branches}
                onChange={(e) => setBranches(e.target.value)}
                placeholder="Leave empty for all branches"
                className="text-sm"
              />
            </div>

            {triggerEvents.includes('schedule') && (
              <div className="space-y-1">
                <Label htmlFor="cron" className="text-xs">Cron schedule</Label>
                <Input
                  id="cron"
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="0 6 * * 1-5"
                  className="font-mono text-sm"
                />
              </div>
            )}

            {/* Target URL */}
            <div className="space-y-1">
              <Label htmlFor="target-url" className="text-xs">Target URL (optional)</Label>
              <Input
                id="target-url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://staging.example.com"
                className="text-sm"
              />
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  type="button"
                  onClick={() => setTargetUrl(VERCEL_PREVIEW_URL)}
                >
                  Vercel Preview
                </Button>
              </div>
            </div>

            {/* Timeout + fail toggle */}
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label htmlFor="timeout" className="text-xs">Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout_(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pb-1.5">
                <Switch
                  id="fail-on-changes"
                  checked={failOnChanges}
                  onCheckedChange={setFailOnChanges}
                />
                <Label htmlFor="fail-on-changes" className="text-xs whitespace-nowrap">
                  Fail on changes
                </Label>
              </div>
            </div>
          </div>

          {/* Right: Live YAML Preview */}
          <div className="flex flex-col min-h-0">
            <h4 className="text-sm font-medium mb-2">Preview</h4>
            <div className="flex-1 min-h-0 overflow-hidden">
              <WorkflowPreview config={workflowConfig} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
