'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'lastest2-recording-tutorial';
const TOTAL_STEPS = 4;

interface TutorialState {
  dismissed: boolean;
}

function loadState(): TutorialState {
  if (typeof window === 'undefined') return { dismissed: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { dismissed: false };
}

function saveState(state: TutorialState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function useRecordingTutorial() {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const loaded = loadState();
    queueMicrotask(() => {
      setDismissed(loaded.dismissed);
      setMounted(true);
    });
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    saveState({ dismissed: true });
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= TOTAL_STEPS - 1) {
        // Past last step — dismiss
        setDismissed(true);
        saveState({ dismissed: true });
        return prev;
      }
      return prev + 1;
    });
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    isVisible: mounted && !dismissed,
    currentStep,
    totalSteps: TOTAL_STEPS,
    nextStep,
    prevStep,
    dismiss,
  };
}
