'use client';

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { BugReportContext } from '@/lib/db/schema';

interface ConsoleError {
  message: string;
  timestamp: number;
}

interface FailedRequest {
  url: string;
  status: number;
  method: string;
}

interface Breadcrumb {
  action: string;
  target: string;
  timestamp: number;
}

interface ContextCollectorValue {
  getSnapshot: () => BugReportContext;
}

const ContextCollectorContext = createContext<ContextCollectorValue | null>(null);

const MAX_CONSOLE_ERRORS = 25;
const MAX_FAILED_REQUESTS = 10;
const MAX_BREADCRUMBS = 20;

export function ContextCollectorProvider({ children }: { children: ReactNode }) {
  const consoleErrors = useRef<ConsoleError[]>([]);
  const failedRequests = useRef<FailedRequest[]>([]);
  const breadcrumbs = useRef<Breadcrumb[]>([]);

  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      consoleErrors.current.push({ message: message.slice(0, 500), timestamp: Date.now() });
      if (consoleErrors.current.length > MAX_CONSOLE_ERRORS) {
        consoleErrors.current = consoleErrors.current.slice(-MAX_CONSOLE_ERRORS);
      }
      originalConsoleError.apply(console, args);
    };
    return () => { console.error = originalConsoleError; };
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (!response.ok) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const method = init?.method ?? 'GET';
        failedRequests.current.push({ url: url.slice(0, 200), status: response.status, method });
        if (failedRequests.current.length > MAX_FAILED_REQUESTS) {
          failedRequests.current = failedRequests.current.slice(-MAX_FAILED_REQUESTS);
        }
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el) return;
      const tag = el.tagName?.toLowerCase() ?? '';
      const id = el.id ? `#${el.id}` : '';
      breadcrumbs.current.push({ action: 'click', target: `${tag}${id}`, timestamp: Date.now() });
      if (breadcrumbs.current.length > MAX_BREADCRUMBS) {
        breadcrumbs.current = breadcrumbs.current.slice(-MAX_BREADCRUMBS);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  const getSnapshot = useCallback((): BugReportContext => {
    return {
      url: window.location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      appVersion: process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT ?? null,
      gitHash: process.env.NEXT_PUBLIC_GIT_HASH ?? null,
      buildDate: process.env.NEXT_PUBLIC_BUILD_DATE ?? null,
      consoleErrors: [...consoleErrors.current],
      failedRequests: [...failedRequests.current],
      breadcrumbs: [...breadcrumbs.current],
    };
  }, []);

  return (
    <ContextCollectorContext.Provider value={{ getSnapshot }}>
      {children}
    </ContextCollectorContext.Provider>
  );
}

export function useContextCollector() {
  const ctx = useContext(ContextCollectorContext);
  if (!ctx) throw new Error('useContextCollector must be used within ContextCollectorProvider');
  return ctx;
}
