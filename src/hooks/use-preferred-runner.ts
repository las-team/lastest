'use client';

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'lastest2-preferred-runner';

export function usePreferredRunner(): [string, (value: string) => void] {
  const [value, setValue] = useState<string>('local');

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setValue(stored);
    }
  }, []);

  const setAndPersist = useCallback((newValue: string) => {
    setValue(newValue);
  }, []);

  return [value, setAndPersist];
}

export function persistRunnerPreference(value: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
}
