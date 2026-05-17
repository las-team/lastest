'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Rocket, Loader2, CheckCircle2, XCircle, CircleDot, Circle, X } from 'lucide-react';
import { useQuickstart, type QuickstartStep } from './use-quickstart';

interface QuickstartPanelProps {
  repositoryId?: string | null;
  enabled: boolean;
  reason?: 'no_team' | 'not_early_adopter' | 'no_base_url';
}

const STEP_LABELS: Record<string, string> = {
  qs_preflight: 'Preflight',
  qs_scout_public: 'Public scout',
  qs_auth_setup: 'Auth setup',
  qs_scout_authed: 'Authed scout',
  qs_generate: 'Generate walkthrough',
  qs_run_and_notes: 'Run & notes',
};

function StepIcon({ status }: { status: QuickstartStep['status'] }) {
  if (status === 'active') return <Loader2 className="size-3.5 animate-spin text-info" />;
  if (status === 'completed') return <CheckCircle2 className="size-3.5 text-success" />;
  if (status === 'failed') return <XCircle className="size-3.5 text-destructive" />;
  if (status === 'skipped') return <CircleDot className="size-3.5 text-muted-foreground/60" />;
  return <Circle className="size-3.5 text-muted-foreground/40" />;
}

export function QuickstartPanel({ repositoryId, enabled, reason }: QuickstartPanelProps) {
  const { session, loading, error, isActive, isTerminal, start, cancel, dismiss } = useQuickstart(repositoryId);

  if (!enabled) {
    // Only render the disabled hint when the team IS early-adopter but baseUrl is missing —
    // otherwise hide entirely to keep the home page uncluttered.
    if (reason !== 'no_base_url') return null;
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4 text-pink-600 dark:text-pink-400" />
            QuickStart
            <Badge variant="outline" className="text-[10px]">early adopter</Badge>
          </CardTitle>
          <CardDescription>
            Set a non-local base URL for this repo in the sidebar to enable the QuickStart agent. localhost URLs are skipped.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const buildId = session?.metadata.buildId;
  const walkthroughTestId = session?.metadata.walkthroughTestId;
  const publicScout = session?.metadata.publicScout;
  const authSetup = session?.metadata.authSetup;
  const failedStep = session?.steps.find((s) => s.status === 'failed');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4 text-pink-600 dark:text-pink-400" />
              QuickStart
              <Badge variant="outline" className="text-[10px]">early adopter</Badge>
            </CardTitle>
            <CardDescription>
              Spin up a 2-test demo (auth setup + app walkthrough) on this repo&rsquo;s base URL, run with video, write demo notes.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!session && (
              <Button size="sm" onClick={start} disabled={loading || !repositoryId}>
                {loading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Rocket className="size-3.5 mr-1.5" />}
                Start QuickStart
              </Button>
            )}
            {session && isActive && (
              <Button size="sm" variant="outline" onClick={cancel} disabled={loading}>
                Cancel
              </Button>
            )}
            {session && isTerminal && (
              <Button size="sm" variant="ghost" onClick={dismiss} title="Dismiss">
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {session && (
        <CardContent className="pt-0 space-y-3">
          <ol className="space-y-1.5">
            {session.steps.map((step) => {
              const label = STEP_LABELS[step.id] ?? step.label;
              return (
                <li key={step.id} className="flex items-start gap-2 text-sm">
                  <StepIcon status={step.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={step.status === 'pending' ? 'text-muted-foreground/70' : ''}>{label}</span>
                      {step.id === 'qs_scout_public' && publicScout?.classification && step.status === 'completed' && (
                        <Badge variant="secondary" className="text-[10px]">
                          {publicScout.classification.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {step.id === 'qs_auth_setup' && step.status === 'skipped' && (
                        <span className="text-[11px] text-muted-foreground/70">not automatable</span>
                      )}
                      {step.id === 'qs_auth_setup' && authSetup?.captured === false && step.status === 'completed' && (
                        <span className="text-[11px] text-warning">storage state not captured</span>
                      )}
                    </div>
                    {step.status === 'failed' && step.error && (
                      <p className="text-[11px] text-destructive mt-0.5 line-clamp-2">{step.error}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {error && !session && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {(buildId || walkthroughTestId) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              {buildId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/builds/${buildId}`}>Open build</Link>
                </Button>
              )}
              {walkthroughTestId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tests/${walkthroughTestId}`}>Walkthrough test</Link>
                </Button>
              )}
              {session.metadata.demoNotesId && (
                <span className="text-[11px] text-muted-foreground">demo notes written</span>
              )}
            </div>
          )}

          {failedStep && session.status === 'failed' && (
            <p className="text-xs text-muted-foreground">
              Stopped at <span className="font-medium">{STEP_LABELS[failedStep.id] ?? failedStep.label}</span>. Dismiss and start again to retry.
            </p>
          )}
        </CardContent>
      )}

      {!session && error && (
        <CardContent className="pt-0">
          <p className="text-xs text-destructive">{error}</p>
        </CardContent>
      )}
    </Card>
  );
}
