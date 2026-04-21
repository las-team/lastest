'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Video,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Monitor,
  Globe,
  Tv2,
} from 'lucide-react';
import { saveEnvironmentConfig, testServerConnection } from '@/server/actions/environment';
import { listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';
import { createAndRunBuild } from '@/server/actions/builds';
import { usePreferredRunner } from '@/hooks/use-preferred-runner';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import type { EmbeddedSession } from '@/lib/db/schema';

interface SidebarQuickActionsProps {
  baseUrl?: string;
  repositoryId?: string | null;
  ebSessions?: EmbeddedSession[];
}

const HISTORY_KEY = 'baseurl-history';

function getUrlHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function pushUrlHistory(url: string) {
  const history = getUrlHistory().filter((u) => u !== url);
  history.unshift(url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
}

function isLocalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

export function SidebarQuickActions({ baseUrl: initialBaseUrl = '', repositoryId, ebSessions: initialEbSessions = [] }: SidebarQuickActionsProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [executionTarget] = usePreferredRunner();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [expanded, setExpanded] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number; statusCode?: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [sessions, setSessions] = useState<EmbeddedSession[]>(initialEbSessions);
  const initialBaseUrlRef = useRef(initialBaseUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep EB pool status fresh: poll every 5s (pausing when tab is hidden)
  // and also refetch instantly on same-team runner SSE events. Polling is
  // needed because system EB events are filtered out by the per-team SSE.
  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      try {
        const updated = await listSystemEmbeddedSessions();
        if (!cancelled) setSessions(updated);
      } catch { /* ignore */ }
    };

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refetch();
    };
    const interval = setInterval(tick, 5000);

    const es = new EventSource('/api/runners/status');
    es.onmessage = () => { refetch(); };
    es.onerror = () => { /* EventSource auto-reconnects */ };

    const onVisibility = () => { if (document.visibilityState === 'visible') refetch(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      es.close();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const total = sessions.length;

  const STATUS_ORDER = ['ready', 'busy', 'starting', 'stopping', 'stopped'] as const;
  const STATUS_COLOR: Record<string, string> = {
    ready: 'bg-green-500',
    busy: 'bg-yellow-500',
    starting: 'bg-blue-500',
    stopping: 'bg-muted-foreground/30',
    stopped: 'bg-muted-foreground/30',
  };
  const counts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  useEffect(() => {
    setBaseUrl(initialBaseUrl);
    initialBaseUrlRef.current = initialBaseUrl;
    setTestResult(null);
    setExpanded(false);
    setUrlHistory(getUrlHistory());
    if (initialBaseUrl) {
      testServerConnection(initialBaseUrl).then((result) => {
        setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode });
      });
    }
  }, [initialBaseUrl, repositoryId]);

  const saveAndTest = async () => {
    if (baseUrl !== initialBaseUrlRef.current) {
      pushUrlHistory(baseUrl);
      setUrlHistory(getUrlHistory());
      initialBaseUrlRef.current = baseUrl;
      await saveEnvironmentConfig({
        repositoryId,
        mode: 'manual',
        baseUrl,
      });
    }
    setIsTesting(true);
    setTestResult(null);
    const result = await testServerConnection(baseUrl);
    setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode });
    setIsTesting(false);
  };

  const handleExpand = () => {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setTimeout(() => setShowHistory(false), 150);
    setExpanded(false);
    if (baseUrl) saveAndTest();
  };

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      const result = await createAndRunBuild('manual', undefined, repositoryId ?? null, executionTarget, undefined);
      notifyJobStarted();
      if ('queued' in result && result.queued) {
        toast.info('All browsers are busy — build queued and will start automatically');
      } else {
        router.push(`/builds/${result.buildId}`);
      }
    } catch (error) {
      console.error('Failed to start build:', error);
      toast.error('Failed to start build');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="px-4 pb-3 space-y-2.5">
      {/* Record + Run All */}
      <div className="flex gap-1.5">
        <Button asChild variant="secondary" size="sm" className="flex-1 gap-1.5">
          <Link href="/record">
            <Video className="h-3.5 w-3.5" />
            Record
          </Link>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={handleRunAll}
          disabled={isRunning}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run All
        </Button>
      </div>

      {/* Base URL */}
      <div className="space-y-1">
        {expanded ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Base URL</span>
                {baseUrl && (
                  <Badge variant="outline" className="text-[9px] gap-0.5 px-1 py-0 h-3.5">
                    {isLocalUrl(baseUrl) ? (
                      <><Monitor className="h-2 w-2" /> Local</>
                    ) : (
                      <><Globe className="h-2 w-2" /> Remote</>
                    )}
                  </Badge>
                )}
              </div>
              {isTesting ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : testResult && (
                <div className="flex items-center gap-0.5 text-[10px]">
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {testResult.responseTime != null && (
                        <span className="text-muted-foreground">{testResult.responseTime}ms</span>
                      )}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 text-red-500" />
                      <span className="text-red-500 text-[10px]">
                        {testResult.statusCode ? testResult.statusCode : 'err'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Input
                ref={inputRef}
                value={baseUrl}
                onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); setShowHistory(false); }}
                onBlur={handleBlur}
                onFocus={() => { if (urlHistory.length > 0) setShowHistory(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setExpanded(false); setShowHistory(false); } }}
                placeholder="http://localhost:3000"
                className="h-7 text-xs"
              />
              {showHistory && urlHistory.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md py-1">
                  {urlHistory.filter((u) => u !== baseUrl).map((url) => (
                    <button
                      key={url}
                      type="button"
                      className="w-full text-left px-2 py-1 text-xs hover:bg-accent truncate"
                      onMouseDown={(e) => { e.preventDefault(); setBaseUrl(url); setShowHistory(false); setTestResult(null); }}
                    >
                      {url}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] font-medium text-muted-foreground">Base URL</span>
            <button
              type="button"
              onClick={handleExpand}
              className="w-full text-left px-2 py-1 h-7 border rounded-md text-xs text-muted-foreground truncate hover:border-primary/50 hover:text-foreground transition-colors cursor-text"
            >
              {baseUrl || 'http://localhost:3000'}
            </button>
          </>
        )}
      </div>

      {/* EB Pool Indicator */}
      {total > 0 && (
        <div className="flex items-center gap-2 px-1">
          <Tv2 className="h-3.5 w-3.5 text-muted-foreground" />
          {total <= 10 ? (
            <>
              <div className="flex items-center gap-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    title={session.status === 'ready' ? 'Available' : session.status === 'busy' ? 'Busy' : session.status}
                    className={`w-3 h-3 rounded-sm ${STATUS_COLOR[session.status] ?? 'bg-muted-foreground/30'}`}
                  />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">EB</span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                {STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((status) => (
                  <div
                    key={status}
                    title={`${counts[status]} ${status}`}
                    className="inline-flex items-center gap-1 px-1.5 h-4 rounded-full border border-border/50"
                  >
                    <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[status]}`} />
                    <span className="text-[10px] tabular-nums text-muted-foreground leading-none">
                      {counts[status]}
                    </span>
                  </div>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">EB · {total}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
