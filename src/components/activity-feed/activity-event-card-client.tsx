'use client';

import { useState } from 'react';
import { ChevronDown, Radio, Cpu, Zap, AlertCircle, CheckCircle2, Clock, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArtifactLink } from './artifact-link-client';
import { cn } from '@/lib/utils';
import type { ActivityEvent, PwAgentType, ActivityArtifactType } from '@/lib/db/schema';

const AGENT_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  scout: 'Scout',
  diver: 'Diver',
  generator: 'Generator',
  healer: 'Healer',
};

const AGENT_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  orchestrator: { bg: 'bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400' },
  planner: { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400' },
  scout: { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400' },
  diver: { bg: 'bg-indigo-500/15', text: 'text-indigo-600 dark:text-indigo-400' },
  generator: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400' },
  healer: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400' },
};

function getDotColor(event: ActivityEvent): string {
  if (event.eventType.includes('error')) return 'bg-red-500';
  if (event.eventType === 'artifact:created') return 'bg-emerald-500';
  if (event.eventType === 'session:complete') return 'bg-green-500';
  if (event.eventType === 'step:waiting_user') return 'bg-amber-500';
  if (event.sourceType === 'mcp_server') return 'bg-cyan-500';
  if (event.eventType === 'session:start') return 'bg-violet-500';
  return 'bg-blue-500';
}

function EventIcon({ event }: { event: ActivityEvent }) {
  if (event.eventType.includes('error')) return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (event.eventType === 'artifact:created') return <Zap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (event.eventType === 'session:complete') return <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (event.eventType === 'step:waiting_user') return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (event.sourceType === 'mcp_server') return <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  if (event.eventType === 'session:start') return <Radio className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  return <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function formatTime(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ActivityEventCardProps {
  event: ActivityEvent;
}

export function ActivityEventCard({ event }: ActivityEventCardProps) {
  const [open, setOpen] = useState(false);
  const hasDetail = event.detail && Object.keys(event.detail).length > 0;
  const hasArtifact = event.artifactType && event.artifactId;

  return (
    <div className="flex gap-3 py-2 px-3 group">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1">
        <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', getDotColor(event))} />
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <EventIcon event={event} />

            {/* Agent badge */}
            {event.agentType && AGENT_BADGE_STYLES[event.agentType] && (
              <span className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                AGENT_BADGE_STYLES[event.agentType].bg,
                AGENT_BADGE_STYLES[event.agentType].text,
              )}>
                {AGENT_LABELS[event.agentType] ?? event.agentType}
              </span>
            )}

            {/* MCP badge */}
            {event.sourceType === 'mcp_server' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                MCP
              </span>
            )}

            <span className="text-sm truncate">{event.summary}</span>
          </div>

          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
            {formatTime(event.createdAt)}
            {event.durationMs ? ` (${event.durationMs}ms)` : ''}
          </span>
        </div>

        {/* Artifact link */}
        {hasArtifact && (
          <div className="mt-1">
            <ArtifactLink
              artifactType={event.artifactType as ActivityArtifactType}
              artifactId={event.artifactId!}
              artifactLabel={event.artifactLabel}
            />
          </div>
        )}

        {/* Expandable detail */}
        {hasDetail && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 p-2 bg-muted/50 rounded text-xs overflow-x-auto max-h-48">
                {JSON.stringify(event.detail, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
