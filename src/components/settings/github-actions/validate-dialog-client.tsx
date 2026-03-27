'use client';

import { useState } from 'react';
import { Check, X, AlertTriangle, Loader2, MinusCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { validateGithubActionSetup } from '@/server/actions/github-actions';
import type { ValidationResult, ValidationCheckStatus } from '@/server/actions/github-actions';
import type { GithubActionConfig } from '@/lib/db/schema';
import { toast } from 'sonner';

interface ValidateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GithubActionConfig;
}

const CHECK_LABELS: Record<keyof ValidationResult, string> = {
  githubAccount: 'GitHub Account',
  workflowFile: 'Workflow File',
  secretToken: 'LASTEST2_TOKEN Secret',
  secretUrl: 'LASTEST2_URL Secret',
  runner: 'Runner',
  serverUrl: 'Server URL',
  lastRun: 'Last Workflow Run',
};

function StatusIcon({ status }: { status: ValidationCheckStatus | 'loading' }) {
  if (status === 'loading') return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (status === 'pass') return <Check className="h-4 w-4 text-green-500" />;
  if (status === 'fail') return <X className="h-4 w-4 text-destructive" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground/50" />;
}

export function ValidateDialog({ open, onOpenChange, config }: ValidateDialogProps) {
  const [validating, setValidating] = useState(false);
  const [results, setResults] = useState<ValidationResult | null>(null);

  const handleValidate = async () => {
    setValidating(true);
    setResults(null);
    try {
      const res = await validateGithubActionSetup(config.id);
      setResults(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const checks = results ? (Object.keys(CHECK_LABELS) as (keyof ValidationResult)[]) : [];
  const passCount = checks.filter((k) => results?.[k].status === 'pass').length;
  const failCount = checks.filter((k) => results?.[k].status === 'fail').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Validate Setup</DialogTitle>
          <DialogDescription>
            Check the GitHub Actions configuration for{' '}
            <span className="font-mono text-foreground">
              {config.repositoryOwner}/{config.repositoryName}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {validating && !results && (
            <div className="rounded-md bg-muted p-3 space-y-2">
              {(Object.keys(CHECK_LABELS) as (keyof ValidationResult)[]).map((key) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <StatusIcon status="loading" />
                  <span className="text-muted-foreground">{CHECK_LABELS[key]}</span>
                </div>
              ))}
            </div>
          )}

          {results && (
            <>
              <div className="rounded-md bg-muted p-3 space-y-2">
                {checks.map((key) => (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    <StatusIcon status={results[key].status} />
                    <div className="min-w-0">
                      <span className="font-medium">{CHECK_LABELS[key]}</span>
                      <p className="text-xs text-muted-foreground truncate">{results[key].message}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="text-green-500">{passCount} passed</span>
                {failCount > 0 && <span className="text-destructive">{failCount} failed</span>}
                {checks.length - passCount - failCount > 0 && (
                  <span>{checks.length - passCount - failCount} warn/skip</span>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleValidate} disabled={validating}>
            {validating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {results ? 'Re-validate' : 'Validate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
