'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'lastest-preferred-runner';

// In-memory store that syncs with localStorage
let currentValue = 'auto';
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // One-time hydration from localStorage on first subscribe
  if (!hydrated && typeof window !== 'undefined') {
    hydrated = true;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== currentValue) {
      currentValue = stored;
      // Notify on next microtask to avoid triggering during subscribe
      queueMicrotask(notify);
    }
  }
  return () => { listeners.delete(cb); };
}

function getSnapshot(): string {
  return currentValue;
}

function getServerSnapshot(): string {
  return 'auto';
}

function getHydrated(): boolean {
  return hydrated;
}

function getServerHydrated(): boolean {
  return false;
}

export function usePreferredRunner(): [string, (value: string) => void, boolean] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isHydrated = useSyncExternalStore(subscribe, getHydrated, getServerHydrated);

  const setAndPersist = useCallback((newValue: string) => {
    currentValue = newValue;
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newValue);
    }
    notify();
  }, []);

  return [value, setAndPersist, isHydrated];
}

export function persistRunnerPreference(value: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
}
