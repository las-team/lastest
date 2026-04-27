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
import { deployPipelineToGitlab } from '@/server/actions/gitlab-pipelines';
import type { GitlabPipelineConfig } from '@/lib/db/schema';
import { toast } from 'sonner';

interface DeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GitlabPipelineConfig;
}

type StepStatus = 'pending' | 'loading' | 'success' | 'error';

export function DeployDialog({ open, onOpenChange, config }: DeployDialogProps) {
  const [deploying, setDeploying] = useState(false);
  const [steps, setSteps] = useState<{
    ciFile: StepStatus;
    tokenVar: StepStatus;
    urlVar: StepStatus;
    hook: StepStatus;
  }>({ ciFile: 'pending', tokenVar: 'pending', urlVar: 'pending', hook: 'pending' });

  const isCi = config.deliveryMode === 'ci_file';
  const willSetVars = config.mode === 'ephemeral' || config.mode === 'auto' || !!config.runnerId;

  const handleDeploy = async () => {
    setDeploying(true);
    setSteps({
      ciFile: isCi ? 'loading' : 'pending',
      tokenVar: willSetVars ? 'loading' : 'pending',
      urlVar: willSetVars ? 'loading' : 'pending',
      hook: 'loading',
    });

    try {
      const results = await deployPipelineToGitlab(config.id);
      setSteps({
        ciFile: isCi ? (results.ciFile ? 'success' : 'error') : 'pending',
        tokenVar: willSetVars ? (results.tokenVar ? 'success' : 'error') : 'pending',
        urlVar: willSetVars ? (results.urlVar ? 'success' : 'error') : 'pending',
        hook: results.hook ? 'success' : 'error',
      });
      toast.success('Pipeline deployed');
    } catch (err) {
      setSteps((prev) => ({
        ciFile: prev.ciFile === 'loading' ? 'error' : prev.ciFile,
        tokenVar: prev.tokenVar === 'loading' ? 'error' : prev.tokenVar,
        urlVar: prev.urlVar === 'loading' ? 'error' : prev.urlVar,
        hook: prev.hook === 'loading' ? 'error' : prev.hook,
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

  const allDone = steps.hook !== 'pending' && steps.hook !== 'loading';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy to GitLab</DialogTitle>
          <DialogDescription>
            Configure <span className="font-mono text-foreground">{config.projectPath}</span> for visual testing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              This will:
              <ul className="list-disc ml-4 mt-1 space-y-0.5">
                {isCi && <li>Create or update <code className="font-mono">.gitlab-ci.yml</code> on the default branch.</li>}
                {willSetVars && <li>Set masked project variables <code>LASTEST_TOKEN</code> and <code>LASTEST_URL</code>.</li>}
                <li>Add a project webhook with a per-config secret token.</li>
              </ul>
            </div>
          </div>

          {allDone && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              {isCi && (
                <div className="flex items-center gap-2 text-sm">
                  <StepIcon status={steps.ciFile} />
                  <span>.gitlab-ci.yml</span>
                </div>
              )}
              {willSetVars && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.tokenVar} />
                    <span>LASTEST_TOKEN variable</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.urlVar} />
                    <span>LASTEST_URL variable</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={steps.hook} />
                <span>Project webhook</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {allDone ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deploying}>Cancel</Button>
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
