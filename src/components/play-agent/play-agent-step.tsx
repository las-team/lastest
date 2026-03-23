'use client';

import { Check, Circle, Loader2, Pause, X, SkipForward, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentStepState, PwAgentType } from '@/lib/db/schema';
import { PlayAgentStepDetail } from './play-agent-step-detail';

interface PlayAgentStepProps {
  step: AgentStepState;
  stepNumber: number;
  onResume?: () => void;
  onSkip?: () => void;
  onApprovePlan?: (approvedAreaIds: string[], autoApprove: boolean) => void;
}

const AGENT_BADGE_STYLES: Record<PwAgentType, { bg: string; text: string; label: string }> = {
  orchestrator: { bg: 'bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400', label: 'Orchestrator' },
  planner: { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', label: 'Planner' },
  scout: { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400', label: 'Scout' },
  diver: { bg: 'bg-indigo-500/15', text: 'text-indigo-600 dark:text-indigo-400', label: 'Diver' },
  generator: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', label: 'Generator' },
  healer: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', label: 'Healer' },
};

function AgentBadge({ agent }: { agent: PwAgentType }) {
  const style = AGENT_BADGE_STYLES[agent];
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', style.bg, style.text)}>
      {style.label}
    </span>
  );
}

export function PlayAgentStep({ step, stepNumber, onResume, onSkip, onApprovePlan }: PlayAgentStepProps) {
  // For review step waiting for user, show the plan detail inline
  const isReviewWaiting = step.id === 'review' && step.status === 'waiting_user';

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
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {sub.status === 'running' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
                ) : sub.status === 'done' ? (
                  <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                ) : sub.status === 'error' ? (
                  <X className="h-3 w-3 text-red-500 flex-shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 flex-shrink-0" />
                )}
                {sub.agent && <AgentBadge agent={sub.agent} />}
                <span>{sub.label}</span>
                {sub.detail && <span className="text-muted-foreground/60">{sub.detail}</span>}
                {sub.durationMs != null && sub.status !== 'running' && sub.status !== 'pending' && (
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums">{(sub.durationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
              {/* Show area names for completed planners */}
              {sub.outputSummary && sub.status === 'done' && (
                <div className="ml-5 text-[10px] text-muted-foreground/50 truncate max-w-[400px]">
                  {sub.outputSummary}
                </div>
              )}
              {/* Show full error for failed planners */}
              {sub.rawError && sub.status === 'error' && (
                <div className="ml-5 text-[10px] text-red-500/80 max-w-[400px] break-words">
                  {sub.rawError}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Review step: show plan areas with checkboxes + approve button */}
      {isReviewWaiting && onApprovePlan && (
        <div className="ml-7 mt-2">
          <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">{step.userAction}</p>
          <PlayAgentStepDetail step={step} onApprovePlan={onApprovePlan} />
        </div>
      )}

      {/* Waiting user action (non-review) */}
      {step.status === 'waiting_user' && step.userAction && !isReviewWaiting && (
        <div className="ml-7 mt-1.5 space-y-2">
          {step.id === 'settings_check' && (() => {
            const highlights = (step.result?.highlight as string[] | undefined) ?? [];
            const missingGH = highlights.includes('github');
            const missingAI = highlights.includes('ai-settings');
            return (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Configure these to continue:</p>
                <div className="space-y-1">
                  {missingGH && (
                    <a
                      href="/settings?highlight=github"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <X className="h-3 w-3 text-red-500 shrink-0" />
                      <span>GitHub account</span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  )}
                  {missingAI && (
                    <a
                      href="/settings?highlight=ai-settings"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <X className="h-3 w-3 text-red-500 shrink-0" />
                      <span>AI provider</span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  )}
                </div>
              </div>
            );
          })()}
          {step.id === 'select_repo' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Select a repository from the sidebar to continue</p>
          )}
          {step.id === 'env_setup' && (() => {
            const ids = (step.result?.highlight as string[] | undefined) ?? [];
            const href = ids.length > 0 ? `/settings?highlight=${ids.join(',')}` : '/settings';
            return (
              <>
                <p className="text-xs text-amber-600 dark:text-amber-400">{step.userAction}</p>
                <a
                  href={href}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Go to Settings <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </>
            );
          })()}
          {step.id !== 'settings_check' && step.id !== 'select_repo' && step.id !== 'env_setup' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{step.userAction}</p>
          )}
          <div className="flex gap-2">
            {onResume && (
              <Button size="sm" onClick={onResume}>Retry</Button>
            )}
            {onSkip && step.id === 'settings_check' && (
              <Button size="sm" variant="outline" onClick={onSkip}>
                <SkipForward className="h-3 w-3 mr-1" />
                Skip for now
              </Button>
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
