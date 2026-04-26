'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RotateCcw, Loader2 } from 'lucide-react';
import { resetOnboarding } from '@/server/actions/onboarding';

const STORAGE_KEY = 'lastest-setup-guide';

export function ResetSetupGuide() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleRestore() {
    startTransition(async () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('lastest-ai-configured');
        localStorage.removeItem('lastest-results-viewed');
      } catch {}
      await resetOnboarding();
      router.push('/onboarding');
      router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRestore}
      className="gap-2"
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RotateCcw className="h-3.5 w-3.5" />
      )}
      Restart Setup Guide
    </Button>
  );
}
