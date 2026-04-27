'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Rocket, Cloud, Server, Zap, AlertTriangle, Loader2, ShieldCheck, Pencil, FileCode, Webhook } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  GitlabPipelineConfig,
  GitlabPipelineMode,
  GitlabPipelineDeliveryMode,
  GitlabPipelineTriggerEvent,
  Runner,
} from '@/lib/db/schema';
import { CiYamlPreview } from '@/components/settings/gitlab-pipelines/ci-yaml-preview-client';
import { DeployDialog } from '@/components/settings/gitlab-pipelines/deploy-dialog-client';
import { ValidateDialog } from '@/components/settings/gitlab-pipelines/validate-dialog-client';
import { EditConfigDialog } from '@/components/settings/gitlab-pipelines/edit-config-dialog-client';
import { deleteGitlabPipelineConfigAction } from '@/server/actions/gitlab-pipelines';
import { toast } from 'sonner';

interface ConfigListProps {
  configs: GitlabPipelineConfig[];
  runners: Runner[];
  hasGitlabAccount: boolean;
}

function ConfigCard({
  config,
  runners,
  hasGitlabAccount,
}: {
  config: GitlabPipelineConfig;
  runners: Runner[];
  hasGitlabAccount: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runner = runners.find((r) => r.id === config.runnerId);
  const mode = config.mode as GitlabPipelineMode;
  const deliveryMode = config.deliveryMode as GitlabPipelineDeliveryMode;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteGitlabPipelineConfigAction(config.id);
      setDeleteOpen(false);
      toast.success('Config deleted');
    } catch {
      toast.error('Failed to delete config');
    } finally {
      setDeleting(false);
    }
  };

  const previewConfig = {
    mode,
    projectPath: config.projectPath,
    triggerEvents: (config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[],
    branchFilter: (config.branchFilter ?? []) as string[],
    timeout: config.timeout ?? 300000,
    failOnChanges: config.failOnChanges ?? true,
  };

  return (
    <>
      <Card>
        <CardHeader className="cursor-pointer py-3" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-medium truncate">{config.projectPath}</span>
                <Badge variant="secondary" className="text-xs">
                  {deliveryMode === 'ci_file' ? (
                    <><FileCode className="h-3 w-3 mr-1" /> CI file</>
                  ) : (
                    <><Webhook className="h-3 w-3 mr-1" /> Webhook</>
                  )}
                </Badge>
                <Badge variant={mode === 'ephemeral' ? 'default' : mode === 'auto' ? 'default' : 'secondary'} className="text-xs">
                  {mode === 'ephemeral' ? (
                    <><Cloud className="h-3 w-3 mr-1" /> Ephemeral</>
                  ) : mode === 'auto' ? (
                    <><Zap className="h-3 w-3 mr-1" /> Auto</>
                  ) : (
                    <><Server className="h-3 w-3 mr-1" /> Persistent</>
                  )}
                </Badge>
                {config.pipelineDeployed && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">Deployed</Badge>
                )}
              </div>
              {runner && (
                <p className="text-xs text-muted-foreground mt-0.5">Runner: {runner.name}</p>
              )}
            </div>
            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} className="h-8 w-8" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setValidateOpen(true)} className="h-8 w-8" title="Validate">
                <ShieldCheck className="h-3.5 w-3.5" />
              </Button>
              {hasGitlabAccount && (
                <Button variant="ghost" size="icon" onClick={() => setDeployOpen(true)} className="h-8 w-8" title="Deploy">
                  <Rocket className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteOpen(true)}
                disabled={deleting}
                className="h-8 w-8 text-destructive hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="pt-0 space-y-4">
            {deliveryMode === 'ci_file' ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">.gitlab-ci.yml</h4>
                <CiYamlPreview config={previewConfig} />
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                Webhook delivery: Lastest reacts to push and merge_request events directly. No CI file is added to the project.
                Per-branch test URLs are read from Environment → Branch Base URLs.
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <EditConfigDialog open={editOpen} onOpenChange={setEditOpen} config={config} runners={runners} />
      <ValidateDialog open={validateOpen} onOpenChange={setValidateOpen} config={config} />
      <DeployDialog open={deployOpen} onOpenChange={setDeployOpen} config={config} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete GitLab Pipeline Config</DialogTitle>
            <DialogDescription>
              Remove the config for <span className="font-mono text-foreground">{config.projectPath}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              This will:
              <ul className="list-disc ml-4 mt-1 space-y-0.5">
                {config.pipelineDeployed && deliveryMode === 'ci_file' && (
                  <li>Delete <code className="font-mono">.gitlab-ci.yml</code> from the repo</li>
                )}
                {config.pipelineDeployed && (
                  <>
                    <li>Remove LASTEST_TOKEN and LASTEST_URL variables</li>
                    <li>Remove the project webhook</li>
                  </>
                )}
                {(mode === 'ephemeral' || mode === 'auto') && config.runnerId && (
                  <li>Delete the auto-created runner</li>
                )}
                <li>Delete this configuration</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ConfigList({ configs, runners, hasGitlabAccount }: ConfigListProps) {
  return (
    <div className="space-y-3">
      {configs.map((config) => (
        <ConfigCard key={config.id} config={config} runners={runners} hasGitlabAccount={hasGitlabAccount} />
      ))}
    </div>
  );
}
