'use client';

import { useState, useEffect } from 'react';
import { Loader2, Cloud, Server, Zap, FileCode, Webhook, Check, X, Rocket } from 'lucide-react';
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
  GitlabPipelineConfig,
  GitlabPipelineMode,
  GitlabPipelineTriggerEvent,
  GitlabPipelineDeliveryMode,
  Runner,
} from '@/lib/db/schema';
import { CiYamlPreview } from '@/components/settings/gitlab-pipelines/ci-yaml-preview-client';
import { updateGitlabPipelineConfigAction, deployPipelineToGitlab } from '@/server/actions/gitlab-pipelines';
import { toast } from 'sonner';

interface EditConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GitlabPipelineConfig;
  runners: Runner[];
}

const TRIGGER_OPTIONS: { value: GitlabPipelineTriggerEvent; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'merge_request', label: 'Merge Request' },
  { value: 'manual', label: 'Manual (Web UI)' },
  { value: 'schedule', label: 'Schedule (cron)' },
];

type StepStatus = 'pending' | 'loading' | 'success' | 'error';

export function EditConfigDialog({ open, onOpenChange, config, runners }: EditConfigDialogProps) {
  const [mode, setMode] = useState<GitlabPipelineMode>(config.mode as GitlabPipelineMode);
  const [deliveryMode, setDeliveryMode] = useState<GitlabPipelineDeliveryMode>(
    (config.deliveryMode as GitlabPipelineDeliveryMode) ?? 'ci_file',
  );
  const [runnerId, setRunnerId] = useState<string>(config.runnerId ?? '');
  const [triggerEvents, setTriggerEvents] = useState<GitlabPipelineTriggerEvent[]>(
    (config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[],
  );
  const [branches, setBranches] = useState((config.branchFilter as string[] ?? []).join(', '));
  const [cronSchedule, setCronSchedule] = useState(config.cronSchedule ?? '');
  const [timeout, setTimeout_] = useState(String(config.timeout ?? 300000));
  const [failOnChanges, setFailOnChanges] = useState(config.failOnChanges ?? true);
  const [saving, setSaving] = useState(false);
  const [showRedeploy, setShowRedeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<{ ciFile: StepStatus; tokenVar: StepStatus; urlVar: StepStatus }>(
    { ciFile: 'pending', tokenVar: 'pending', urlVar: 'pending' },
  );

  useEffect(() => {
    if (open) {
      setMode(config.mode as GitlabPipelineMode);
      setDeliveryMode((config.deliveryMode as GitlabPipelineDeliveryMode) ?? 'ci_file');
      setRunnerId(config.runnerId ?? '');
      setTriggerEvents((config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[]);
      setBranches((config.branchFilter as string[] ?? []).join(', '));
      setCronSchedule(config.cronSchedule ?? '');
      setTimeout_(String(config.timeout ?? 300000));
      setFailOnChanges(config.failOnChanges ?? true);
      setShowRedeploy(false);
      setDeploying(false);
      setDeploySteps({ ciFile: 'pending', tokenVar: 'pending', urlVar: 'pending' });
    }
  }, [open, config]);

  const toggleTrigger = (event: GitlabPipelineTriggerEvent) => {
    setTriggerEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const branchFilter = branches.split(',').map((b) => b.trim()).filter(Boolean);

  const previewConfig = {
    mode,
    projectPath: config.projectPath,
    triggerEvents,
    branchFilter,
    timeout: parseInt(timeout, 10) || 300000,
    failOnChanges,
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateGitlabPipelineConfigAction(config.id, {
        mode,
        deliveryMode,
        runnerId: runnerId || null,
        triggerEvents,
        branchFilter,
        cronSchedule: cronSchedule || null,
        timeout: parseInt(timeout, 10) || 300000,
        failOnChanges,
      });
      toast.success('Config updated');
      if (config.pipelineDeployed) {
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

  const handleRedeploy = async () => {
    setDeploying(true);
    setDeploySteps({ ciFile: 'loading', tokenVar: 'loading', urlVar: 'loading' });
    try {
      const results = await deployPipelineToGitlab(config.id);
      setDeploySteps({
        ciFile: results.ciFile ? 'success' : (deliveryMode === 'webhook' ? 'pending' : 'error'),
        tokenVar: results.tokenVar ? 'success' : 'error',
        urlVar: results.urlVar ? 'success' : 'error',
      });
      toast.success('Pipeline redeployed');
    } catch (err) {
      setDeploySteps((prev) => ({
        ciFile: prev.ciFile === 'loading' ? 'error' : prev.ciFile,
        tokenVar: prev.tokenVar === 'loading' ? 'error' : prev.tokenVar,
        urlVar: prev.urlVar === 'loading' ? 'error' : prev.urlVar,
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

  const deployDone = deploySteps.ciFile !== 'pending' && deploySteps.ciFile !== 'loading'
    || deploySteps.tokenVar !== 'pending' && deploySteps.tokenVar !== 'loading';

  if (showRedeploy) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redeploy Pipeline?</DialogTitle>
            <DialogDescription>
              Settings for <span className="font-mono text-foreground">{config.projectPath}</span> have been updated.
              Redeploy to apply changes to GitLab?
            </DialogDescription>
          </DialogHeader>

          {deployDone && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              {deliveryMode === 'ci_file' && (
                <div className="flex items-center gap-2 text-sm">
                  <StepIcon status={deploySteps.ciFile} />
                  <span>.gitlab-ci.yml</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={deploySteps.tokenVar} />
                <span>LASTEST_TOKEN variable</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={deploySteps.urlVar} />
                <span>LASTEST_URL variable</span>
              </div>
            </div>
          )}

          <DialogFooter>
            {deployDone ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deploying}>Skip</Button>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Pipeline Config</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{config.projectPath}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 min-h-0 flex-1 overflow-hidden">
          <div className="space-y-4 overflow-y-auto pr-1">
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
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Mode</h4>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className={`p-2.5 rounded-md border text-left transition-colors ${mode === 'auto' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}`} onClick={() => setMode('auto')}>
                  <div className="flex items-center gap-1.5 mb-0.5"><Zap className="h-3.5 w-3.5" /><span className="text-sm font-medium">Auto</span></div>
                </button>
                <button type="button" className={`p-2.5 rounded-md border text-left transition-colors ${mode === 'persistent' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}`} onClick={() => setMode('persistent')}>
                  <div className="flex items-center gap-1.5 mb-0.5"><Server className="h-3.5 w-3.5" /><span className="text-sm font-medium">Persistent</span></div>
                </button>
                <button type="button" className={`p-2.5 rounded-md border text-left transition-colors ${mode === 'ephemeral' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}`} onClick={() => setMode('ephemeral')}>
                  <div className="flex items-center gap-1.5 mb-0.5"><Cloud className="h-3.5 w-3.5" /><span className="text-sm font-medium">Ephemeral</span></div>
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
                    <Checkbox checked={triggerEvents.includes(opt.value)} onCheckedChange={() => toggleTrigger(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="gl-edit-branches" className="text-xs">Branch filter (comma-separated)</Label>
              <Input id="gl-edit-branches" value={branches} onChange={(e) => setBranches(e.target.value)} placeholder="Leave empty for all branches" className="text-sm" />
            </div>

            {triggerEvents.includes('schedule') && (
              <div className="space-y-1">
                <Label htmlFor="gl-edit-cron" className="text-xs">Cron schedule</Label>
                <Input id="gl-edit-cron" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="0 6 * * 1-5" className="font-mono text-sm" />
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label htmlFor="gl-edit-timeout" className="text-xs">Timeout (ms)</Label>
                <Input id="gl-edit-timeout" type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} className="text-sm" />
              </div>
              <div className="flex items-center gap-2 pb-1.5">
                <Switch id="gl-edit-fail-on-changes" checked={failOnChanges} onCheckedChange={setFailOnChanges} />
                <Label htmlFor="gl-edit-fail-on-changes" className="text-xs whitespace-nowrap">Fail on changes</Label>
              </div>
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <h4 className="text-sm font-medium mb-2">{deliveryMode === 'ci_file' ? '.gitlab-ci.yml Preview' : 'No CI file (webhook delivery)'}</h4>
            <div className="flex-1 min-h-0 overflow-hidden">
              {deliveryMode === 'ci_file' ? (
                <CiYamlPreview config={previewConfig} />
              ) : (
                <div className="h-full rounded-md border border-dashed p-6 text-xs text-muted-foreground">
                  Webhook mode: no CI file is added to the project.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
