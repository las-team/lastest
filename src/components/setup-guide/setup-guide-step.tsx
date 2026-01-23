'use client';

import { Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export interface StepDefinition {
  label: string;
  description: string;
  actionLabel: string;
  href?: string;
  onClick?: () => void;
}

interface SetupGuideStepProps {
  step: StepDefinition;
  stepNumber: number;
  state: 'completed' | 'current' | 'upcoming';
}

export function SetupGuideStep({ step, stepNumber, state }: SetupGuideStepProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      {/* Icon */}
      <div className="flex-shrink-0">
        {state === 'completed' ? (
          <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
        ) : state === 'current' ? (
          <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center">
            <Circle className="h-3 w-3 text-white fill-white" />
          </div>
        ) : (
          <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">{stepNumber}</span>
          </div>
        )}
      </div>

      {/* Label + Description */}
      <div className="flex-1 min-w-0">
        <span className={state === 'current' ? 'font-semibold text-sm' : state === 'completed' ? 'text-sm line-through text-muted-foreground' : 'text-sm text-muted-foreground'}>
          {step.label}
        </span>
        {state === 'current' && (
          <p className="text-xs text-muted-foreground truncate">{step.description}</p>
        )}
      </div>

      {/* Action button */}
      {state === 'current' && (
        step.href ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={step.href}>{step.actionLabel}</Link>
          </Button>
        ) : step.onClick ? (
          <Button size="sm" variant="outline" onClick={step.onClick}>
            {step.actionLabel}
          </Button>
        ) : null
      )}
    </div>
  );
}
