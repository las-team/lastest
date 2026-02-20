'use client';

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'lastest2-preferred-runner';

export function usePreferredRunner(): [string, (value: string) => void] {
  const [value, setValue] = useState<string>(() => {
    if (typeof window === 'undefined') return 'local';
    return localStorage.getItem(STORAGE_KEY) || 'local';
  });

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
