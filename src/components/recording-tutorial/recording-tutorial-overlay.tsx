'use client';

import { useRecordingTutorial } from '@/hooks/use-recording-tutorial';
import { TutorialStepCallout } from '@/components/recording-tutorial/tutorial-step-callout';

interface RecordingTutorialOverlayProps {
  layout: 'embedded' | 'card';
}

const TUTORIAL_STEPS = [
  {
    target: 'screenshot',
    title: 'Screenshots are Key',
    description:
      'Each screenshot becomes a visual baseline checkpoint. Take screenshots at key moments — they\'re the core of visual regression testing.',
    highlight: true, // all steps highlight their target
  },
  {
    target: 'assertion',
    title: 'Add Success Criteria',
    description:
      'Use the dropdown for page-level checks (load, idle, URL). Shift+Right-click any element for visibility, text, or attribute assertions.',
    highlight: true,
  },
  {
    target: 'download',
    title: 'Validate Downloads & Clipboard',
    description:
      'Click this before a download link to verify file downloads. Copy/paste operations are captured automatically.',
    highlight: true,
  },
  {
    target: 'timeline',
    title: 'Quick Tips',
    description:
      'Use Ctrl+Shift+S for quick screenshots. Open the Timeline to review all recorded events in real time.',
    highlight: true,
  },
];

export function RecordingTutorialOverlay({ layout }: RecordingTutorialOverlayProps) {
  const { isVisible, currentStep, totalSteps, nextStep, prevStep, dismiss } =
    useRecordingTutorial();

  if (!isVisible) return null;

  const step = TUTORIAL_STEPS[currentStep];
  if (!step) return null;

  // Embedded layout: buttons are at bottom, callouts go above
  // Card layout: buttons are at top of card, callouts go below
  const side = layout === 'embedded' ? 'top' : 'bottom';

  return (
    <TutorialStepCallout
      targetSelector={`[data-tutorial-target="${step.target}"]`}
      side={side}
      title={step.title}
      description={step.description}
      stepNumber={currentStep}
      totalSteps={totalSteps}
      onNext={nextStep}
      onPrev={currentStep > 0 ? prevStep : undefined}
      onSkip={dismiss}
      highlight={step.highlight}
    />
  );
}
