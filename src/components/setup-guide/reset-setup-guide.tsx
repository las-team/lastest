'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

const STORAGE_KEY = 'lastest2-setup-guide';

export function ResetSetupGuide() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        setIsDismissed(state.dismissed === true);
      }
    } catch {}
  }, []);

  if (!mounted || !isDismissed) return null;

  const handleRestore = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('lastest2-ai-configured');
      localStorage.removeItem('lastest2-results-viewed');
    } catch {}
    setIsDismissed(false);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleRestore} className="gap-2">
      <RotateCcw className="h-3.5 w-3.5" />
      Restore Setup Guide
    </Button>
  );
}
