'use client';

import { useRef, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Radio, Trash2, ArrowUp, Loader2, Play, Pause, CheckCircle2, XCircle, Monitor, Square, Check, X, Circle } from 'lucide-react';
import Link from 'next/link';
import { ActivityEventCard } from './activity-event-card-client';
import { useActivityFeedContext } from './activity-feed-provider-client';
import { BrowserViewer } from '@/components/embedded-browser/browser-viewer-client';
import { AgentBadge } from '@/components/play-agent/play-agent-step';
import { cn } from '@/lib/utils';
import type { AgentSession, AgentSubstep } from '@/lib/db/schema';

type FilterType = 'all' | 'agent' | 'mcp_server';

const AGENT_SOURCES = new Set(['play_agent', 'generate_agent', 'heal_agent']);

function SessionStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case 'paused':
      return <Pause className="h-3.5 w-3.5 text-amber-500" />;
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Play className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function SubstepStatusIcon({ status }: { status: AgentSubstep['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case 'done':
      return <Check className="h-3.5 w-3.5 text-green-500" />;
    case 'error':
      return <X className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function ActiveSessionsSection({
  expandedStream,
  setExpandedStream,
}: {
  expandedStream: string | null;
  setExpandedStream: (id: string | null) => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [ebStreamUrl, setEbStreamUrl] = useState<string | null>(null);
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(new Set());

  async function handleStop(sessionId: string) {
    setStoppingSessions((prev) => new Set(prev).add(sessionId));
    try {
      const { cancelPlayAgent } = await import('@/server/actions/play-agent');
      await cancelPlayAgent(sessionId);
    } catch {
      // ignore — session may already be done
    } finally {
      setStoppingSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchSessions() {
      try {
        const res = await fetch('/api/activity-feed/sessions');
        if (!active) return;
        if (!res.ok) {
          setSessions(prev => prev ?? []);
          return;
        }
        const data = await res.json();
        setSessions(data.sessions ?? []);
        setEbStreamUrl(data.ebStreamUrl ?? null);
      } catch {
        if (active) setSessions(prev => prev ?? []);
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (sessions !== null && sessions.length === 0) return null;

  return (
    <div className="px-4 py-2 border-b bg-muted/30">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Agent Sessions</p>
      {sessions === null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading sessions…</span>
        </div>
      )}
      <div className="space-y-1">
        {(sessions ?? []).map((s) => {
          // Determine label and link based on session type
          const meta = s.metadata as Record<string, unknown> | null;
          const isSpecImport = !!(meta?.specImport);
          const isHealAgent = !!(meta?.testId) && s.currentStepId === 'heal';
          const isGenerateAgent = !!(meta?.testName) && !isHealAgent;
          const label = isSpecImport
            ? (s.status === 'paused' ? `Spec Import: ${(meta?.stories as unknown[])?.length ?? 0} stories ready` : 'Importing spec...')
            : isHealAgent
              ? `Healing "${meta?.testName}"`
              : isGenerateAgent
                ? `Generating "${meta?.testName}"`
                : s.currentStepId ? `Step: ${s.currentStepId.replace(/_/g, ' ')}` : s.status;

          // For completed generate sessions, link to the created test
          const completedTestId = s.steps?.find(
            (step: { id: string; result?: Record<string, unknown> }) => step.result?.testId
          )?.result?.testId as string | undefined;
          const streamUrl = (meta?.streamUrl as string | null) || ebStreamUrl;
          const hasStream = s.status === 'active' && !!streamUrl;
          const isExpanded = expandedStream === s.id;

          const viewHref = isSpecImport && s.status === 'paused'
            ? `/tests?reviewSpecImport=${s.id}`
            : completedTestId
              ? `/tests/${completedTestId}`
              : `/run?session=${s.id}`;
          const viewLabel = isSpecImport && s.status === 'paused' ? 'Review' : completedTestId ? 'Open' : 'View';

          // Expand active-step sub-agents into separate rows (e.g. 3 parallel Generators).
          const activeStep = s.status === 'active'
            ? s.steps?.find((st) => st.status === 'active')
            : undefined;
          const subAgents: AgentSubstep[] = (activeStep?.substeps ?? []).filter(
            (sub) => !!sub.agent && sub.status !== 'pending',
          );
          const showSubAgents = subAgents.length > 0;

          const stopButton = s.status === 'active' && (
            <button
              onClick={() => handleStop(s.id)}
              disabled={stoppingSessions.has(s.id)}
              className="p-0.5 rounded hover:bg-red-500/15 text-red-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
              title="Stop agent"
            >
              {stoppingSessions.has(s.id) ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
            </button>
          );

          const streamButton = hasStream && (
            <button
              onClick={() => setExpandedStream(isExpanded ? null : s.id)}
              className={cn(
                'p-0.5 rounded hover:bg-muted',
                isExpanded && 'text-primary',
              )}
              title={isExpanded ? 'Hide browser' : 'Show browser'}
            >
              <Monitor className="h-3 w-3" />
            </button>
          );

          const statusBadge = (
            <Badge
              variant="outline"
              className={cn(
                'h-4 px-1 text-[10px]',
                s.status === 'active' && 'border-blue-500/50 text-blue-600 dark:text-blue-400',
                s.status === 'paused' && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
                s.status === 'completed' && 'border-green-500/50 text-green-600 dark:text-green-400',
                s.status === 'failed' && 'border-red-500/50 text-red-600 dark:text-red-400',
              )}
            >
              {s.status}
            </Badge>
          );

          const viewLink = (completedTestId || (isSpecImport && s.status === 'paused')) ? (
            <Link href={viewHref} className="text-[10px] text-primary hover:underline">
              {viewLabel}
            </Link>
          ) : !hasStream && (
            <Link href={viewHref} className="text-[10px] text-primary hover:underline">
              {viewLabel}
            </Link>
          );

          return (
            <div key={s.id} className="space-y-1">
              {showSubAgents ? (
                <>
                  {subAgents.map((sub, i) => (
                    <div key={`${s.id}-sub-${i}`} className="flex items-center gap-2 text-xs">
                      <SubstepStatusIcon status={sub.status} />
                      {sub.agent && <AgentBadge agent={sub.agent} />}
                      <span className="flex-1 truncate">
                        {sub.label}
                        {sub.detail && (
                          <span className="text-muted-foreground/60 ml-1">{sub.detail}</span>
                        )}
                      </span>
                      {i === 0 && stopButton}
                      {i === 0 && streamButton}
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <SessionStatusIcon status={s.status} />
                  <span className="flex-1 truncate">{label}</span>
                  {stopButton}
                  {streamButton}
                  {statusBadge}
                  {viewLink}
                </div>
              )}
              {isExpanded && streamUrl && (
                <div className="rounded-md overflow-hidden border">
                  <BrowserViewer
                    streamUrl={streamUrl}
                    initialViewport={{ width: 1280, height: 720 }}
                    interactive={false}
                    hideControls
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityFeedPanel() {
  const { isOpen, setIsOpen, events, isConnected, clearEvents } = useActivityFeedContext();
  const [filter, setFilter] = useState<FilterType>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedStream, setExpandedStream] = useState<string | null>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const visibleEvents = filter === 'all'
    ? events
    : filter === 'agent'
      ? events.filter((e) => AGENT_SOURCES.has(e.sourceType))
      : events.filter((e) => e.sourceType === filter);

  // Latest events first
  const filteredEvents = [...visibleEvents].reverse();

  // Resolve the Radix ScrollArea viewport and wire scroll detection
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    viewportRef.current = viewport;
    if (!viewport) return;
    const onScroll = () => {
      const atTop = viewport.scrollTop < 60;
      setAutoScroll(atTop);
    };
    viewport.addEventListener('scroll', onScroll);
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [isOpen]);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && viewportRef.current && isOpen) {
      viewportRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [filteredEvents.length, autoScroll, isOpen]);

  const agentCount = events.filter((e) => AGENT_SOURCES.has(e.sourceType)).length;
  const mcpCount = events.filter((e) => e.sourceType === 'mcp_server').length;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className={cn(
          'p-0 flex flex-col transition-[width] duration-300',
          expandedStream ? 'w-[1340px]' : 'w-[480px]',
        )}>
        <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" />
            Activity Feed
            {isConnected ? (
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Connected" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-red-400" title="Disconnected" />
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Real-time activity from Play Agent and MCP server
          </SheetDescription>

          {/* Filter tabs + clear */}
          <div className="flex items-center gap-1 mt-2">
            <Button
              variant={filter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter('all')}
            >
              All
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{events.length}</Badge>
            </Button>
            <Button
              variant={filter === 'agent' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter('agent')}
            >
              Agent
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{agentCount}</Badge>
            </Button>
            <Button
              variant={filter === 'mcp_server' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter('mcp_server')}
            >
              MCP
              <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">{mcpCount}</Badge>
            </Button>
            <div className="flex-1" />
            {events.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={clearEvents}>
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* Active agent sessions */}
        <ActiveSessionsSection expandedStream={expandedStream} setExpandedStream={setExpandedStream} />

        {/* Timeline */}
        <ScrollArea ref={scrollRootRef} className="flex-1">
          <div className="py-2">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Radio className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="text-xs mt-1">Events from Play Agent and MCP will appear here</p>
              </div>
            ) : (
              filteredEvents.map((event, idx) => (
                <ActivityEventCard
                  key={event.id}
                  event={event}
                  isLast={idx === filteredEvents.length - 1}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* Scroll-to-top button */}
        {!autoScroll && filteredEvents.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Button
              size="sm"
              variant="secondary"
              className="h-8 rounded-full shadow-md gap-1"
              onClick={() => {
                viewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                setAutoScroll(true);
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Latest
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
