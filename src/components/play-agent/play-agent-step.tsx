'use client';

import { Check, Circle, Loader2, Pause, X, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { AgentStepState } from '@/lib/db/schema';

interface PlayAgentStepProps {
  step: AgentStepState;
  stepNumber: number;
  onResume?: () => void;
  onSkipDiscover?: () => void;
}

export function PlayAgentStep({ step, stepNumber, onResume, onSkipDiscover }: PlayAgentStepProps) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2.5">
        {/* Step icon */}
        <div className="flex-shrink-0">
          {step.status === 'completed' ? (
            <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
              <Check className="h-3 w-3 text-white" />
            </div>
          ) : step.status === 'active' ? (
            <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <Loader2 className="h-3 w-3 text-white animate-spin" />
            </div>
          ) : step.status === 'waiting_user' ? (
            <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">
              <Pause className="h-3 w-3 text-white" />
            </div>
          ) : step.status === 'failed' ? (
            <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
              <X className="h-3 w-3 text-white" />
            </div>
          ) : step.status === 'skipped' ? (
            <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
              <SkipForward className="h-3 w-3 text-muted-foreground" />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
              <span className="text-[10px] text-muted-foreground">{stepNumber}</span>
            </div>
          )}
        </div>

        {/* Label */}
        <span
          className={cn(
            'text-sm flex-1',
            step.status === 'completed' && 'text-muted-foreground',
            step.status === 'active' && 'font-medium',
            step.status === 'waiting_user' && 'font-medium text-blue-600 dark:text-blue-400',
            step.status === 'failed' && 'font-medium text-red-600 dark:text-red-400',
            step.status === 'skipped' && 'text-muted-foreground',
            step.status === 'pending' && 'text-muted-foreground',
          )}
        >
          {stepNumber}. {step.label}
        </span>
      </div>

      {/* Substeps */}
      {step.substeps && step.substeps.length > 0 && (step.status === 'active' || step.status === 'completed') && (
        <div className="ml-7 mt-1 space-y-0.5">
          {step.substeps.map((sub, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              {sub.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : sub.status === 'done' ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : sub.status === 'error' ? (
                <X className="h-3 w-3 text-red-500" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span>{sub.label}</span>
              {sub.detail && <span className="text-muted-foreground/60">{sub.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Skip ahead button for discover step */}
      {step.status === 'active' && onSkipDiscover && (
        <div className="ml-7 mt-1.5 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onSkipDiscover} className="gap-1.5 h-6 text-xs">
            <SkipForward className="h-3 w-3" />
            Skip ahead
          </Button>
          <span className="text-[10px] text-muted-foreground">Continue with current tests, generate rest in background</span>
        </div>
      )}

      {/* Waiting user action */}
      {step.status === 'waiting_user' && step.userAction && (
        <div className="ml-7 mt-1.5 space-y-1.5">
          <p className="text-xs text-blue-600 dark:text-blue-400">{step.userAction}</p>
          <div className="flex gap-2">
            {(step.id === 'settings_check' || step.id === 'env_setup') && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/settings">Open Settings</Link>
              </Button>
            )}
            {onResume && (
              <Button size="sm" onClick={onResume}>Retry</Button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {step.status === 'failed' && step.error && (
        <div className="ml-7 mt-1.5 space-y-1.5">
          <p className="text-xs text-red-600 dark:text-red-400">{step.error}</p>
          {onResume && (
            <Button size="sm" variant="outline" onClick={onResume}>Retry</Button>
          )}
        </div>
      )}
    </div>
  );
}
