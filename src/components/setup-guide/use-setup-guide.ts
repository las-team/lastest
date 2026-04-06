'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'lastest-setup-guide';

export interface SetupStatus {
  githubConnected: boolean;
  routesExist: boolean;
  testsExist: boolean;
  buildsExist: boolean;
  baselinesApproved: boolean;
  buildCount: number;
}

interface GuideState {
  completedSteps: number[];
  dismissed: boolean;
}

const TOTAL_STEPS = 8;

function loadState(): GuideState {
  if (typeof window === 'undefined') return { completedSteps: [], dismissed: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { completedSteps: [], dismissed: false };
}

function saveState(state: GuideState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function useSetupGuide(initialStatus: SetupStatus) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<GuideState>({ completedSteps: [], dismissed: false });

  useEffect(() => {
    const loaded = loadState();

    // Check if database is essentially empty (fresh after reset)
    const isDatabaseEmpty = !initialStatus.githubConnected &&
      !initialStatus.routesExist &&
      !initialStatus.testsExist &&
      !initialStatus.buildsExist;

    // If database is empty but guide was dismissed, reset the guide state
    if (isDatabaseEmpty && loaded.dismissed) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('lastest-ai-configured');
      localStorage.removeItem('lastest-results-viewed');
      loaded.completedSteps = [];
      loaded.dismissed = false;
    }

    // Merge server-detected + localStorage-detected completions
    const autoDetected: number[] = [];
    if (initialStatus.githubConnected) autoDetected.push(1);
    const aiConfigured = localStorage.getItem('lastest-ai-configured') === 'true';
    if (aiConfigured) autoDetected.push(2);
    if (initialStatus.routesExist) autoDetected.push(3);
    if (initialStatus.testsExist) autoDetected.push(4);
    if (initialStatus.buildsExist) autoDetected.push(5);
    if (initialStatus.baselinesApproved) autoDetected.push(6);
    if (initialStatus.buildCount >= 2) autoDetected.push(7);
    const resultsViewed = localStorage.getItem('lastest-results-viewed') === 'true';
    if (resultsViewed) autoDetected.push(8);

    const merged = Array.from(new Set([...loaded.completedSteps, ...autoDetected]));
    const newState = { ...loaded, completedSteps: merged };
    queueMicrotask(() => {
      setState(newState);
      setMounted(true);
    });
    saveState(newState);
  }, [initialStatus]);

  const completeStep = useCallback((step: number) => {
    setState((prev) => {
      if (prev.completedSteps.includes(step)) return prev;
      const next = { ...prev, completedSteps: [...prev.completedSteps, step] };
      saveState(next);
      return next;
    });
  }, []);

  const dismissGuide = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissed: true };
      saveState(next);
      return next;
    });
  }, []);

  const progress = useMemo(
    () => Math.round((state.completedSteps.length / TOTAL_STEPS) * 100),
    [state.completedSteps]
  );

  const currentStep = useMemo(() => {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      if (!state.completedSteps.includes(i)) return i;
    }
    return TOTAL_STEPS;
  }, [state.completedSteps]);

  const allComplete = state.completedSteps.length >= TOTAL_STEPS;
  const isVisible = mounted && !state.dismissed;

  return {
    isVisible,
    currentStep,
    progress,
    completedSteps: state.completedSteps,
    allComplete,
    completeStep,
    dismissGuide,
    mounted,
  };
}
