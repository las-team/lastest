'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sparkles, X, RotateCcw } from 'lucide-react';
import { PlayAgentStep } from './play-agent-step';
import { usePlayAgent } from './use-play-agent';
import { cn } from '@/lib/utils';

interface PlayAgentTimelineProps {
  repositoryId?: string | null;
}

export function PlayAgentTimeline({ repositoryId }: PlayAgentTimelineProps) {
  const { session, loading, isActive, isTerminal, progress, start, resume, cancel, dismiss } =
    usePlayAgent(repositoryId);

  if (!session) {
    // Show start button
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Auto Setup</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically scan, generate tests, run, and fix — all in one flow.
              </p>
            </div>
            <Button
              onClick={start}
              disabled={loading || !repositoryId}
              size="sm"
              className="gap-2"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {loading ? 'Starting...' : 'Start Auto Setup'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Summary view when completed
  const summaryStep = session.steps.find((s) => s.id === 'summary');
  const summaryResult = summaryStep?.result;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Auto Setup
          </CardTitle>
          <div className="flex items-center gap-1">
            {isActive && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancel} title="Cancel">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
            {isTerminal && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={dismiss} title="Dismiss">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {isActive && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
        {session.status === 'failed' && (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <span>Failed</span>
            <Button size="sm" variant="ghost" className="h-5 gap-1 text-xs" onClick={resume}>
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y">
          {session.steps.map((step, i) => (
            <PlayAgentStep
              key={step.id}
              step={step}
              stepNumber={i + 1}
              onResume={step.status === 'waiting_user' || step.status === 'failed' ? resume : undefined}
            />
          ))}
        </div>

        {/* Summary card */}
        {session.status === 'completed' && summaryResult && (
          <div className="mt-3 p-3 rounded-md bg-muted/50 space-y-1.5">
            <h4 className="text-xs font-semibold">Results</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Tests created:</span>{' '}
                <span className="font-medium">{summaryResult.testsCreated as number}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Builds:</span>{' '}
                <span className="font-medium">{(summaryResult.buildIds as string[])?.length ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Initial:</span>{' '}
                <span className={cn(
                  'font-medium',
                  (summaryResult.initialFailed as number) > 0 ? 'text-red-600' : 'text-green-600',
                )}>
                  {summaryResult.initialPassed as number}P / {summaryResult.initialFailed as number}F
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Final:</span>{' '}
                <span className={cn(
                  'font-medium',
                  (summaryResult.finalFailed as number) > 0 ? 'text-red-600' : 'text-green-600',
                )}>
                  {summaryResult.finalPassed as number}P / {summaryResult.finalFailed as number}F
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
