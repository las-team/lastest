'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { deployWorkflowToGithub } from '@/server/actions/github-actions';
import type { GithubActionConfig } from '@/lib/db/schema';
import { toast } from 'sonner';

interface DeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GithubActionConfig;
}

type StepStatus = 'pending' | 'loading' | 'success' | 'error';

export function DeployDialog({ open, onOpenChange, config }: DeployDialogProps) {
  const isEphemeral = config.mode === 'ephemeral';
  const isAuto = config.mode === 'auto';
  const hasPersistentRunner = !isEphemeral && !isAuto && !!config.runnerId;
  const [deploying, setDeploying] = useState(false);
  const [steps, setSteps] = useState<{
    workflow: StepStatus;
    tokenSecret: StepStatus;
    urlSecret: StepStatus;
  }>({ workflow: 'pending', tokenSecret: 'pending', urlSecret: 'pending' });

  const willSetSecrets = isEphemeral || isAuto || hasPersistentRunner;

  const handleDeploy = async () => {
    setDeploying(true);
    setSteps({
      workflow: 'loading',
      tokenSecret: willSetSecrets ? 'loading' : 'pending',
      urlSecret: willSetSecrets ? 'loading' : 'pending',
    });

    try {
      const results = await deployWorkflowToGithub(config.id, {});

      setSteps({
        workflow: results.workflow ? 'success' : 'error',
        tokenSecret: willSetSecrets
          ? (results.tokenSecret ? 'success' : 'error')
          : 'pending',
        urlSecret: willSetSecrets
          ? (results.urlSecret ? 'success' : 'error')
          : 'pending',
      });

      toast.success('Workflow deployed successfully');
    } catch (err) {
      setSteps((prev) => ({
        ...prev,
        workflow: prev.workflow === 'loading' ? 'error' : prev.workflow,
        tokenSecret: prev.tokenSecret === 'loading' ? 'error' : prev.tokenSecret,
        urlSecret: prev.urlSecret === 'loading' ? 'error' : prev.urlSecret,
      }));
      toast.error(err instanceof Error ? err.message : 'Deployment failed');
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

  const allDone = steps.workflow !== 'pending' && steps.workflow !== 'loading';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy to GitHub</DialogTitle>
          <DialogDescription>
            Push the workflow file to{' '}
            <span className="font-mono text-foreground">
              {config.repositoryOwner}/{config.repositoryName}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              This will create <code className="font-mono">.github/workflows/lastest.yml</code> in
              your repo.
              {willSetSecrets
                ? hasPersistentRunner
                  ? ' The runner token will be regenerated and secrets will be set automatically. Any other usage of the old token will stop working.'
                  : isAuto
                    ? ' An auth-only runner will be created and secrets set automatically. The server will pick the best available runner at build time.'
                    : ' A runner token and server URL will be set as repository secrets automatically.'
                : ' You will need to manually set LASTEST_TOKEN and LASTEST_URL as repository secrets.'}
            </div>
          </div>

          {allDone && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={steps.workflow} />
                <span>Workflow file</span>
              </div>
              {willSetSecrets && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.tokenSecret} />
                    <span>LASTEST_TOKEN secret</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.urlSecret} />
                    <span>LASTEST_URL secret</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {allDone ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deploying}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} disabled={deploying}>
                {deploying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Deploy
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
