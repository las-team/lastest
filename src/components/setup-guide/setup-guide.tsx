'use client';

import { useEffect } from 'react';
import { X, PartyPopper } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useSetupGuide, type SetupStatus } from './use-setup-guide';
import { SetupGuideStep, type StepDefinition } from './setup-guide-step';
import { createAndRunBuild } from '@/server/actions/builds';
import { useRouter } from 'next/navigation';

interface SetupGuideProps {
  initialStatus: SetupStatus;
  latestBuildId?: string | null;
}

export function SetupGuide({ initialStatus, latestBuildId }: SetupGuideProps) {
  const router = useRouter();
  const {
    isVisible,
    currentStep,
    progress,
    completedSteps,
    allComplete,
    dismissGuide,
  } = useSetupGuide(initialStatus);

  // Auto-dismiss after 3 seconds when all steps are complete
  useEffect(() => {
    if (allComplete && isVisible) {
      const timer = setTimeout(dismissGuide, 3000);
      return () => clearTimeout(timer);
    }
  }, [allComplete, isVisible, dismissGuide]);

  if (!isVisible) return null;

  if (allComplete) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-3 text-green-600">
            <PartyPopper className="h-5 w-5" />
            <span className="font-semibold">All done! You&apos;re all set up.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleRunBuild = async () => {
    await createAndRunBuild('manual');
    router.refresh();
  };

  const steps: StepDefinition[] = [
    { label: 'Connect GitHub', description: 'Link your GitHub account to sync repositories', actionLabel: 'Connect GitHub', href: '/settings' },
    { label: 'Configure AI', description: 'Set up AI provider for test generation', actionLabel: 'Configure AI', href: '/settings' },
    { label: 'Scan Routes', description: 'Discover routes in your repository', actionLabel: 'Go to Repo', href: '/repo' },
    { label: 'Record a Test', description: 'Create your first visual regression test', actionLabel: 'Record Test', href: '/record' },
    { label: 'Run Tests', description: 'Execute all tests to capture screenshots', actionLabel: 'Run All', onClick: handleRunBuild },
    { label: 'Set Baseline', description: 'Approve screenshots as visual baselines', actionLabel: 'Review Diffs', href: latestBuildId ? `/builds/${latestBuildId}` : '/builds' },
    { label: 'Run Again', description: 'Make changes to your app and run tests again', actionLabel: 'Run All', onClick: handleRunBuild },
    { label: 'Check Results', description: 'Review visual diffs and approve or reject', actionLabel: 'View Results', href: latestBuildId ? `/builds/${latestBuildId}` : '/builds' },
  ];

  function getStepState(stepNum: number): 'completed' | 'current' | 'upcoming' {
    if (completedSteps.includes(stepNum)) return 'completed';
    if (stepNum === currentStep) return 'current';
    return 'upcoming';
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Getting Started</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{progress}%</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={dismissGuide}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Progress value={progress} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y">
          {steps.map((step, i) => (
            <SetupGuideStep
              key={i}
              step={step}
              stepNumber={i + 1}
              state={getStepState(i + 1)}
            />
          ))}
        </div>
        <button
          onClick={dismissGuide}
          className="text-xs text-muted-foreground hover:underline mt-3 block"
        >
          Skip Guide
        </button>
      </CardContent>
    </Card>
  );
}
