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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [setSecrets, setSetSecrets] = useState(false);
  const [runnerToken, setRunnerToken] = useState('');
  const [lastest2Url, setLastest2Url] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [steps, setSteps] = useState<{
    workflow: StepStatus;
    tokenSecret: StepStatus;
    urlSecret: StepStatus;
  }>({ workflow: 'pending', tokenSecret: 'pending', urlSecret: 'pending' });

  const handleDeploy = async () => {
    setDeploying(true);
    setSteps({
      workflow: 'loading',
      tokenSecret: isEphemeral ? 'loading' : 'pending',
      urlSecret: isEphemeral ? 'loading' : 'pending',
    });

    try {
      const results = await deployWorkflowToGithub(config.id, {
        setSecrets: isEphemeral ? false : setSecrets,
        runnerToken: !isEphemeral && setSecrets ? runnerToken : undefined,
        lastest2Url: !isEphemeral && setSecrets ? lastest2Url : undefined,
      });

      setSteps({
        workflow: results.workflow ? 'success' : 'error',
        tokenSecret: isEphemeral
          ? (results.tokenSecret ? 'success' : 'error')
          : (!setSecrets ? 'pending' : results.tokenSecret ? 'success' : 'error'),
        urlSecret: isEphemeral
          ? (results.urlSecret ? 'success' : 'error')
          : (!setSecrets ? 'pending' : results.urlSecret ? 'success' : 'error'),
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
  const showSecretSteps = isEphemeral || setSecrets;

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
              This will create <code className="font-mono">.github/workflows/lastest2.yml</code> in
              your repo.
              {isEphemeral
                ? ' A runner token and server URL will be set as repository secrets automatically.'
                : ' GitHub Actions minutes may incur costs on paid plans.'}
            </div>
          </div>

          {/* Persistent mode: let user optionally provide secrets */}
          {!isEphemeral && (
            <>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="set-secrets"
                  checked={setSecrets}
                  onCheckedChange={(v) => setSetSecrets(v === true)}
                  disabled={deploying}
                />
                <Label htmlFor="set-secrets" className="text-sm leading-tight">
                  Also set <code className="text-xs">LASTEST2_TOKEN</code> and{' '}
                  <code className="text-xs">LASTEST2_URL</code> as repository secrets
                </Label>
              </div>

              {setSecrets && (
                <div className="space-y-3 pl-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="runner-token" className="text-xs">
                      Runner Token
                    </Label>
                    <Input
                      id="runner-token"
                      type="password"
                      placeholder="lastest_runner_..."
                      value={runnerToken}
                      onChange={(e) => setRunnerToken(e.target.value)}
                      disabled={deploying}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Plain tokens are only shown once when created. Create a new runner if needed.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastest2-url" className="text-xs">
                      Lastest2 URL
                    </Label>
                    <Input
                      id="lastest2-url"
                      placeholder="https://your-lastest2-instance.com"
                      value={lastest2Url}
                      onChange={(e) => setLastest2Url(e.target.value)}
                      disabled={deploying}
                      className="text-xs"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {allDone && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              <div className="flex items-center gap-2 text-sm">
                <StepIcon status={steps.workflow} />
                <span>Workflow file</span>
              </div>
              {showSecretSteps && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.tokenSecret} />
                    <span>LASTEST2_TOKEN secret</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StepIcon status={steps.urlSecret} />
                    <span>LASTEST2_URL secret</span>
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
