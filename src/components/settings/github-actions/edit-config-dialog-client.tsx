'use client';

import { useState, useEffect } from 'react';
import { Loader2, Cloud, Server, Zap, Check, X, Rocket } from 'lucide-react';
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
import type { GithubActionConfig, GithubActionMode, GithubActionTriggerEvent, Runner } from '@/lib/db/schema';
import { WorkflowPreview } from '@/components/settings/github-actions/workflow-preview-client';
import { updateGithubActionConfigAction, deployWorkflowToGithub } from '@/server/actions/github-actions';
import { toast } from 'sonner';

interface EditConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GithubActionConfig;
  runners: Runner[];
}

const TRIGGER_OPTIONS: { value: GithubActionTriggerEvent; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'pull_request', label: 'Pull Request' },
  { value: 'workflow_dispatch', label: 'Manual Dispatch' },
  { value: 'schedule', label: 'Schedule (cron)' },
];

const VERCEL_PREVIEW_URL = 'https://${{ github.event.repository.name }}-git-${{ github.head_ref }}-${{ github.repository_owner }}.vercel.app';

type StepStatus = 'pending' | 'loading' | 'success' | 'error';

export function EditConfigDialog({ open, onOpenChange, config, runners }: EditConfigDialogProps) {
  const [mode, setMode] = useState<GithubActionMode>(config.mode as GithubActionMode);
  const [runnerId, setRunnerId] = useState<string>(config.runnerId ?? '');
  const [triggerEvents, setTriggerEvents] = useState<GithubActionTriggerEvent[]>(
    (config.triggerEvents ?? ['push', 'pull_request', 'workflow_dispatch']) as GithubActionTriggerEvent[],
  );
  const [branches, setBranches] = useState((config.branchFilter as string[] ?? []).join(', '));
  const [cronSchedule, setCronSchedule] = useState(config.cronSchedule ?? '');
  const [targetUrl, setTargetUrl] = useState(config.targetUrl ?? '');
  const [timeout, setTimeout_] = useState(String(config.timeout ?? 300000));
  const [failOnChanges, setFailOnChanges] = useState(config.failOnChanges ?? false);
  const [saving, setSaving] = useState(false);

  // Redeploy prompt state
  const [showRedeploy, setShowRedeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<{
    workflow: StepStatus;
    tokenSecret: StepStatus;
    urlSecret: StepStatus;
  }>({ workflow: 'pending', tokenSecret: 'pending', urlSecret: 'pending' });

  // Re-init state when dialog opens or config changes
  useEffect(() => {
    if (open) {
      setMode(config.mode as GithubActionMode);
      setRunnerId(config.runnerId ?? '');
      setTriggerEvents(
        (config.triggerEvents ?? ['push', 'pull_request', 'workflow_dispatch']) as GithubActionTriggerEvent[],
      );
      setBranches((config.branchFilter as string[] ?? []).join(', '));
      setCronSchedule(config.cronSchedule ?? '');
      setTargetUrl(config.targetUrl ?? '');
      setTimeout_(String(config.timeout ?? 300000));
      setFailOnChanges(config.failOnChanges ?? false);
      setShowRedeploy(false);
      setDeploying(false);
      setDeploySteps({ workflow: 'pending', tokenSecret: 'pending', urlSecret: 'pending' });
    }
  }, [open, config]);

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
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    triggerEvents,
    branchFilter,
    cronSchedule: cronSchedule || null,
    targetUrl: targetUrl || null,
    timeout: parseInt(timeout, 10) || 300000,
    failOnChanges,
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateGithubActionConfigAction(config.id, {
        mode,
        runnerId: runnerId || null,
        triggerEvents,
        branchFilter,
        cronSchedule: cronSchedule || null,
        targetUrl: targetUrl || null,
        timeout: parseInt(timeout, 10) || 300000,
        failOnChanges,
      });
      toast.success('Config updated');
      if (config.workflowDeployed) {
        setShowRedeploy(true);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update config');
    } finally {
      setSaving(false);
    }
  };

  const isEphemeral = config.mode === 'ephemeral';
  const isAuto = config.mode === 'auto';
  const hasPersistentRunner = !isEphemeral && !isAuto && !!config.runnerId;
  const willSetSecrets = isEphemeral || isAuto || hasPersistentRunner;

  const handleRedeploy = async () => {
    setDeploying(true);
    setDeploySteps({
      workflow: 'loading',
      tokenSecret: willSetSecrets ? 'loading' : 'pending',
      urlSecret: willSetSecrets ? 'loading' : 'pending',
    });

    try {
      const results = await deployWorkflowToGithub(config.id);
      setDeploySteps({
        workflow: results.workflow ? 'success' : 'error',
        tokenSecret: willSetSecrets
          ? (results.tokenSecret ? 'success' : 'error')
          : 'pending',
        urlSecret: willSetSecrets
          ? (results.urlSecret ? 'success' : 'error')
          : 'pending',
      });
      toast.success('Workflow redeployed');
    } catch (err) {
      setDeploySteps((prev) => ({
        ...prev,
        workflow: prev.workflow === 'loading' ? 'error' : prev.workflow,
        tokenSecret: prev.tokenSecret === 'loading' ? 'error' : prev.tokenSecret,
        urlSecret: prev.urlSecret === 'loading' ? 'error' : prev.urlSecret,
      }));
      toast.error(err instanceof Error ? err.message : 'Redeployment failed');
    } finally {
      setDeploying(false);
    }
  };

  const StepIcon = ({ status }: { status: StepStatus }) => {
    if (status === 'loading') return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (status === 'success') return <Check className="h-4 w-4 text-green-500" />;
    if (status === 'error') return <X className="h-4 w-4 text-destructive" />;
    return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
  };

  const deployDone = deploySteps.workflow !== 'pending' && deploySteps.workflow !== 'loading';

  // Redeploy prompt view
  if (showRedeploy) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redeploy Workflow?</DialogTitle>
            <DialogDescription>
              Settings for{' '}
              <span className="font-mono text-foreground">
                {config.repositoryOwner}/{config.repositoryName}
              </span>{' '}
              have been updated. Redeploy to apply changes to GitHub?
            </DialogDescription>
          </DialogHeader>

          {deployDone && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={deploySteps.workflow} />
                <span>Workflow file</span>
              </div>
              {willSetSecrets && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={deploySteps.tokenSecret} />
                    <span>LASTEST_TOKEN secret</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={deploySteps.urlSecret} />
                    <span>LASTEST_URL secret</span>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {deployDone ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deploying}>
                  Skip
                </Button>
                <Button onClick={handleRedeploy} disabled={deploying}>
                  {deploying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Rocket className="h-4 w-4 mr-2" />
                  Redeploy
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Edit form view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Edit Config
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{config.repositoryOwner}/{config.repositoryName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 min-h-0 flex-1 overflow-hidden">
          {/* Left: Configuration */}
          <div className="space-y-4 overflow-y-auto pr-1">
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
              <Label htmlFor="edit-branches" className="text-xs">
                Branch filter (comma-separated)
              </Label>
              <Input
                id="edit-branches"
                value={branches}
                onChange={(e) => setBranches(e.target.value)}
                placeholder="Leave empty for all branches"
                className="text-sm"
              />
            </div>

            {triggerEvents.includes('schedule') && (
              <div className="space-y-1">
                <Label htmlFor="edit-cron" className="text-xs">Cron schedule</Label>
                <Input
                  id="edit-cron"
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="0 6 * * 1-5"
                  className="font-mono text-sm"
                />
              </div>
            )}

            {/* Target URL */}
            <div className="space-y-1">
              <Label htmlFor="edit-target-url" className="text-xs">Target URL (optional)</Label>
              <Input
                id="edit-target-url"
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
                <Label htmlFor="edit-timeout" className="text-xs">Timeout (ms)</Label>
                <Input
                  id="edit-timeout"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout_(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pb-1.5">
                <Switch
                  id="edit-fail-on-changes"
                  checked={failOnChanges}
                  onCheckedChange={setFailOnChanges}
                />
                <Label htmlFor="edit-fail-on-changes" className="text-xs whitespace-nowrap">
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
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
