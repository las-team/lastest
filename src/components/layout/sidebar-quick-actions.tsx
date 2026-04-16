'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Video,
  Loader2,
  CheckCircle2,
  XCircle,
  Monitor,
  Globe,
  Tv2,
} from 'lucide-react';
import { saveEnvironmentConfig, testServerConnection } from '@/server/actions/environment';
import { listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';
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
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [expanded, setExpanded] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number; statusCode?: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [sessions, setSessions] = useState<EmbeddedSession[]>(initialEbSessions);
  const initialBaseUrlRef = useRef(initialBaseUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen to runner SSE for real-time EB status updates
  useEffect(() => {
    if (initialEbSessions.length === 0) return;
    const es = new EventSource('/api/runners/status');
    es.onmessage = async () => {
      try {
        const updated = await listSystemEmbeddedSessions();
        setSessions(updated);
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => es.close();
  }, [initialEbSessions.length]);

  const total = sessions.length;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- repositoryId change must reset state
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

  return (
    <div className="px-4 pb-3 space-y-2.5">
      {/* Record Button */}
      <Button asChild variant="secondary" size="sm" className="w-full gap-2">
        <Link href="/record">
          <Video className="h-3.5 w-3.5" />
          Record Test
        </Link>
      </Button>

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
          <div className="flex items-center gap-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                title={session.status === 'ready' ? 'Available' : session.status === 'busy' ? 'Busy' : session.status}
                className={`w-3 h-3 rounded-sm ${
                  session.status === 'ready' ? 'bg-green-500' :
                  session.status === 'busy' ? 'bg-yellow-500' :
                  session.status === 'starting' ? 'bg-blue-500' :
                  'bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">EB</span>
        </div>
      )}
    </div>
  );
}
