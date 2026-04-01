'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface TutorialStepCalloutProps {
  targetSelector: string;
  side: 'top' | 'bottom';
  title: string;
  description: string;
  stepNumber: number;
  totalSteps: number;
  onNext: () => void;
  onPrev?: () => void;
  onSkip: () => void;
  highlight?: boolean;
}

interface Position {
  top: number;
  left: number;
  arrowLeft: number;
}

const CALLOUT_WIDTH = 288; // w-72
const CALLOUT_GAP = 12;

function computePosition(
  rect: DOMRect,
  side: 'top' | 'bottom',
): Position | null {
  if (!rect.width && !rect.height) return null;

  // Center callout horizontally on the target
  let left = rect.left + rect.width / 2 - CALLOUT_WIDTH / 2;
  let arrowLeft = CALLOUT_WIDTH / 2;

  // Clamp to viewport
  const margin = 8;
  if (left < margin) {
    arrowLeft -= margin - left;
    left = margin;
  }
  const maxLeft = window.innerWidth - CALLOUT_WIDTH - margin;
  if (left > maxLeft) {
    arrowLeft += left - maxLeft;
    left = maxLeft;
  }

  const top =
    side === 'top'
      ? rect.top - CALLOUT_GAP
      : rect.bottom + CALLOUT_GAP;

  return { top, left, arrowLeft };
}

export function TutorialStepCallout({
  targetSelector,
  side,
  title,
  description,
  stepNumber,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  highlight,
}: TutorialStepCalloutProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const el = document.querySelector(targetSelector);
    if (!el) {
      setPosition(null);
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTargetRect(rect);
    setPosition(computePosition(rect, side));
  }, [targetSelector, side]);

  useEffect(() => {
    queueMicrotask(updatePosition);

    // Re-position on resize/scroll
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    // ResizeObserver for layout shifts (e.g. fullscreen toggle)
    const observer = new ResizeObserver(updatePosition);
    observer.observe(document.body);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer.disconnect();
    };
  }, [updatePosition]);

  // Also re-compute after a short delay (for animations)
  useEffect(() => {
    const timer = setTimeout(updatePosition, 100);
    return () => clearTimeout(timer);
  }, [updatePosition, stepNumber]);

  if (!position) return null;

  const isLast = stepNumber === totalSteps - 1;

  // Adjust top for 'top' side: we need to measure callout height and position above
  // We'll use transform to shift up by 100% of callout height
  const style: React.CSSProperties =
    side === 'top'
      ? {
          position: 'fixed',
          left: position.left,
          top: position.top,
          transform: 'translateY(-100%)',
          width: CALLOUT_WIDTH,
          zIndex: 40,
        }
      : {
          position: 'fixed',
          left: position.left,
          top: position.top,
          width: CALLOUT_WIDTH,
          zIndex: 40,
        };

  const content = (
    <>
      {/* Highlight ring around target */}
      {highlight && targetRect && (
        <div
          className="fixed pointer-events-none rounded-full"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            zIndex: 39,
            boxShadow: '0 0 0 2px oklch(0.65 0.25 264), 0 0 12px 2px oklch(0.65 0.25 264 / 0.3)',
          }}
        />
      )}

      {/* Callout card */}
      <div
        ref={calloutRef}
        style={style}
        className="bg-popover text-popover-foreground border shadow-lg rounded-lg overflow-hidden"
      >
        {/* Arrow */}
        <div
          className="absolute w-3 h-3 bg-popover border rotate-45"
          style={
            side === 'top'
              ? {
                  bottom: -6,
                  left: position.arrowLeft - 6,
                  borderTop: 'none',
                  borderLeft: 'none',
                }
              : {
                  top: -6,
                  left: position.arrowLeft - 6,
                  borderBottom: 'none',
                  borderRight: 'none',
                }
          }
        />

        <div className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold leading-tight">{title}</h4>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 -mt-0.5 -mr-1"
              onClick={onSkip}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

          {/* Footer: dots + nav */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-1">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${
                    i === stepNumber ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              {onPrev && (
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onPrev}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
              )}
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onNext}
              >
                {isLast ? 'Done' : 'Next'}
                {!isLast && <ChevronRight className="h-3 w-3 ml-0.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
