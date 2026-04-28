'use client';

import { useState, useEffect } from 'react';
import { Loader2, Cloud, Server, Zap, FileCode, Webhook } from 'lucide-react';
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
import type {
  Runner,
  Repository,
  GitlabPipelineMode,
  GitlabPipelineTriggerEvent,
  GitlabPipelineDeliveryMode,
} from '@/lib/db/schema';
import { CiYamlPreview } from '@/components/settings/gitlab-pipelines/ci-yaml-preview-client';
import { createGitlabPipelineConfigAction } from '@/server/actions/gitlab-pipelines';
import { toast } from 'sonner';

interface AddConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runners: Runner[];
  repos: Repository[];
}

const TRIGGER_OPTIONS: { value: GitlabPipelineTriggerEvent; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'merge_request', label: 'Merge Request' },
  { value: 'manual', label: 'Manual (Web UI)' },
  { value: 'schedule', label: 'Schedule (cron)' },
];

export function AddConfigDialog({ open, onOpenChange, runners, repos }: AddConfigDialogProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [projectPath, setProjectPath] = useState('');
  const [gitlabProjectId, setGitlabProjectId] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<GitlabPipelineMode>('persistent');
  const [deliveryMode, setDeliveryMode] = useState<GitlabPipelineDeliveryMode>('ci_file');
  const [runnerId, setRunnerId] = useState<string>('');
  const [triggerEvents, setTriggerEvents] = useState<GitlabPipelineTriggerEvent[]>(['push', 'merge_request']);
  const [branches, setBranches] = useState('main');
  const [cronSchedule, setCronSchedule] = useState('');
  const [timeout, setTimeout_] = useState('300000');
  const [failOnChanges, setFailOnChanges] = useState(true);
  const [saving, setSaving] = useState(false);

  const gitlabRepos = repos.filter((r) => r.provider === 'gitlab' && r.gitlabProjectId);

  useEffect(() => {
    if (open) {
      setSelectedRepoId('');
      setProjectPath('');
      setGitlabProjectId(undefined);
      setMode('persistent');
      setDeliveryMode('ci_file');
      setRunnerId('');
      setTriggerEvents(['push', 'merge_request']);
      setBranches('main');
      setCronSchedule('');
      setTimeout_('300000');
      setFailOnChanges(true);
    }
  }, [open]);

  const handleRepoSelect = (value: string) => {
    setSelectedRepoId(value);
    const repo = gitlabRepos.find((r) => r.id === value);
    if (repo) {
      setProjectPath(repo.fullName);
      setGitlabProjectId(repo.gitlabProjectId ?? undefined);
    }
  };

  const toggleTrigger = (event: GitlabPipelineTriggerEvent) => {
    setTriggerEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const branchFilter = branches
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  const previewConfig = {
    mode,
    projectPath: projectPath || 'namespace/project',
    triggerEvents,
    branchFilter,
    timeout: parseInt(timeout, 10) || 300000,
    failOnChanges,
  };

  const canSave = !!selectedRepoId && !!gitlabProjectId;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await createGitlabPipelineConfigAction({
        repositoryId: selectedRepoId,
        projectPath,
        gitlabProjectId,
        mode,
        deliveryMode,
        runnerId: runnerId || undefined,
        triggerEvents,
        branchFilter,
        cronSchedule: cronSchedule || undefined,
        timeout: parseInt(timeout, 10) || 300000,
        failOnChanges,
      });
      toast.success('Pipeline config created');
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
          <DialogTitle>Add GitLab Project</DialogTitle>
          <DialogDescription>
            Configure auto-run on branches and merge requests. Per-branch test URLs come from Environment → Branch Base URLs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 min-h-0 flex-1 overflow-hidden">
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Project</h4>
              {gitlabRepos.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No GitLab projects found. Connect a GitLab account first to sync projects.
                </p>
              ) : (
                <Select value={selectedRepoId} onValueChange={handleRepoSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {gitlabRepos.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Delivery</h4>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    deliveryMode === 'ci_file' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setDeliveryMode('ci_file')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <FileCode className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">.gitlab-ci.yml</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    We push the CI file + project variables. Pipelines run inside GitLab.
                  </p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    deliveryMode === 'webhook' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setDeliveryMode('webhook')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Webhook className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Webhook only</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    No CI file edits. We trigger builds server-side on push/MR.
                  </p>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Mode</h4>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    mode === 'auto' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
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
                    mode === 'persistent' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setMode('persistent')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Server className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Persistent</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Uses an existing runner. Pipeline only triggers.
                  </p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    mode === 'ephemeral' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setMode('ephemeral')}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Cloud className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Ephemeral</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-tight">
                    Runner inside the GitLab job.
                  </p>
                </button>
              </div>
            </div>

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
                        {r.name} <span className="text-muted-foreground">({r.status})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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

            <div className="space-y-1">
              <Label htmlFor="gl-branches" className="text-xs">Branch filter (comma-separated)</Label>
              <Input
                id="gl-branches"
                value={branches}
                onChange={(e) => setBranches(e.target.value)}
                placeholder="Leave empty for all branches"
                className="text-sm"
              />
            </div>

            {triggerEvents.includes('schedule') && (
              <div className="space-y-1">
                <Label htmlFor="gl-cron" className="text-xs">Cron schedule</Label>
                <Input
                  id="gl-cron"
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="0 6 * * 1-5"
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label htmlFor="gl-timeout" className="text-xs">Timeout (ms)</Label>
                <Input
                  id="gl-timeout"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout_(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pb-1.5">
                <Switch id="gl-fail-on-changes" checked={failOnChanges} onCheckedChange={setFailOnChanges} />
                <Label htmlFor="gl-fail-on-changes" className="text-xs whitespace-nowrap">
                  Fail on changes
                </Label>
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Per-branch test URLs are configured under Environment → Branch Base URLs.
              The build resolves the URL from the branch name automatically.
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <h4 className="text-sm font-medium mb-2">
              {deliveryMode === 'ci_file' ? '.gitlab-ci.yml Preview' : 'No CI file (webhook delivery)'}
            </h4>
            <div className="flex-1 min-h-0 overflow-hidden">
              {deliveryMode === 'ci_file' ? (
                <CiYamlPreview config={previewConfig} />
              ) : (
                <div className="h-full rounded-md border border-dashed p-6 text-xs text-muted-foreground">
                  In webhook mode, no CI file is added to the project. Lastest reacts to push and merge_request events
                  and runs tests on its own infrastructure.
                </div>
              )}
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
