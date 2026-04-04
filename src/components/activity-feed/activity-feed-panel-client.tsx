'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Radio, Trash2, ArrowDown } from 'lucide-react';
import { ActivityEventCard } from './activity-event-card-client';
import { useActivityFeedContext } from './activity-feed-provider-client';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'play_agent' | 'mcp_server';

export function ActivityFeedPanel() {
  const { isOpen, setIsOpen, events, isConnected, clearEvents } = useActivityFeedContext();
  const [filter, setFilter] = useState<FilterType>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filteredEvents = filter === 'all'
    ? events
    : events.filter((e) => e.sourceType === filter);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current && isOpen) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredEvents.length, autoScroll, isOpen]);

  // Detect when user scrolls away from bottom
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  const agentCount = events.filter((e) => e.sourceType === 'play_agent').length;
  const mcpCount = events.filter((e) => e.sourceType === 'mcp_server').length;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="w-[420px] sm:w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4" />
              Activity Feed
              {isConnected && (
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearEvents} title="Clear">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-2">
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
              variant={filter === 'play_agent' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter('play_agent')}
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
          </div>
        </SheetHeader>

        {/* Timeline */}
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="py-2" onScroll={handleScroll}>
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Radio className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="text-xs mt-1">Events from Play Agent and MCP will appear here</p>
              </div>
            ) : (
              filteredEvents.map((event) => (
                <ActivityEventCard key={event.id} event={event} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Scroll-to-bottom button */}
        {!autoScroll && filteredEvents.length > 0 && (
          <div className="absolute bottom-4 right-8">
            <Button
              size="sm"
              variant="secondary"
              className={cn('h-8 rounded-full shadow-md gap-1')}
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                setAutoScroll(true);
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Latest
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
