'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Trash2, Rocket, Cloud, Server, Zap, AlertTriangle, Loader2 } from 'lucide-react';
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
import type { GithubActionConfig, GithubActionMode, GithubActionTriggerEvent, Runner } from '@/lib/db/schema';
import { WorkflowPreview } from '@/components/settings/github-actions/workflow-preview-client';
import { DeployDialog } from '@/components/settings/github-actions/deploy-dialog-client';
import { deleteGithubActionConfigAction } from '@/server/actions/github-actions';
import { toast } from 'sonner';

interface ConfigListProps {
  configs: GithubActionConfig[];
  runners: Runner[];
  hasGithubAccount: boolean;
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
        <code className="text-xs flex-1 truncate">{value}</code>
        <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-1.5 shrink-0">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function ConfigCard({
  config,
  runners,
  hasGithubAccount,
}: {
  config: GithubActionConfig;
  runners: Runner[];
  hasGithubAccount: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runner = runners.find((r) => r.id === config.runnerId);
  const mode = config.mode as GithubActionMode;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteGithubActionConfigAction(config.id);
      setDeleteOpen(false);
      toast.success('Config deleted');
    } catch {
      toast.error('Failed to delete config');
    } finally {
      setDeleting(false);
    }
  };

  const workflowConfig = {
    mode,
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    triggerEvents: (config.triggerEvents ?? ['push', 'pull_request', 'workflow_dispatch']) as GithubActionTriggerEvent[],
    branchFilter: (config.branchFilter ?? []) as string[],
    cronSchedule: config.cronSchedule,
    targetUrl: config.targetUrl,
    timeout: config.timeout ?? 300000,
    failOnChanges: config.failOnChanges ?? true,
  };

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer py-3"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium truncate">
                  {config.repositoryOwner}/{config.repositoryName}
                </span>
                <Badge variant={mode === 'ephemeral' ? 'default' : mode === 'auto' ? 'default' : 'secondary'} className="text-xs">
                  {mode === 'ephemeral' ? (
                    <><Cloud className="h-3 w-3 mr-1" /> Ephemeral</>
                  ) : mode === 'auto' ? (
                    <><Zap className="h-3 w-3 mr-1" /> Auto</>
                  ) : (
                    <><Server className="h-3 w-3 mr-1" /> Persistent</>
                  )}
                </Badge>
                {config.workflowDeployed && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">
                    Deployed
                  </Badge>
                )}
              </div>
              {runner && (
                <p className="text-xs text-muted-foreground mt-0.5">Runner: {runner.name}</p>
              )}
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {hasGithubAccount && (
                <Button variant="ghost" size="sm" onClick={() => setDeployOpen(true)} className="h-8">
                  <Rocket className="h-3.5 w-3.5 mr-1.5" />
                  Deploy
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled={deleting}
                className="h-8 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="pt-0 space-y-6">
            {/* Setup Guide */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Setup Guide</h4>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                    1
                  </span>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm">
                      Add <code className="text-xs bg-muted px-1 py-0.5 rounded">LASTEST2_TOKEN</code> as
                      a repository secret in GitHub
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Go to your repo → Settings → Secrets and variables → Actions → New repository
                      secret. Use a runner token from Settings → Runners.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                    2
                  </span>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm">
                      Add <code className="text-xs bg-muted px-1 py-0.5 rounded">LASTEST2_URL</code> as
                      a repository secret
                    </p>
                    <CopyBlock
                      label="Your Lastest2 instance URL"
                      value={typeof window !== 'undefined' ? window.location.origin : ''}
                    />
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                    3
                  </span>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm">
                      Create the workflow file at{' '}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        .github/workflows/lastest2.yml
                      </code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Copy the YAML below, or use the Deploy button to push it directly.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* YAML Preview */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Workflow YAML</h4>
              <WorkflowPreview config={workflowConfig} />
            </div>
          </CardContent>
        )}
      </Card>

      <DeployDialog open={deployOpen} onOpenChange={setDeployOpen} config={config} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete GitHub Actions Config</DialogTitle>
            <DialogDescription>
              Remove the config for{' '}
              <span className="font-mono text-foreground">
                {config.repositoryOwner}/{config.repositoryName}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              This will:
              <ul className="list-disc ml-4 mt-1 space-y-0.5">
                {config.workflowDeployed && (
                  <>
                    <li>Delete <code className="font-mono">.github/workflows/lastest2.yml</code> from the repo</li>
                    <li>Remove LASTEST2_TOKEN and LASTEST2_URL secrets</li>
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
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
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

export function ConfigList({ configs, runners, hasGithubAccount }: ConfigListProps) {
  return (
    <div className="space-y-3">
      {configs.map((config) => (
        <ConfigCard
          key={config.id}
          config={config}
          runners={runners}
          hasGithubAccount={hasGithubAccount}
        />
      ))}
    </div>
  );
}
