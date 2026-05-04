'use client';

import { useRef, useState, useCallback } from 'react';
import { useDrag } from '@use-gesture/react';
import { CheckCircle, ListTodo, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

type Direction = 'right' | 'left' | 'up' | null;

interface SwipeDeckProps {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  onSwipeUp?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD_PX = 100;
const RESET_MS = 280;

export function SwipeDeck({ onSwipeRight, onSwipeLeft, onSwipeUp, disabled, children, className }: SwipeDeckProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0, animating: false });
  const [committed, setCommitted] = useState<Direction>(null);

  const reset = useCallback(() => {
    setDrag({ x: 0, y: 0, animating: true });
    setTimeout(() => setDrag({ x: 0, y: 0, animating: false }), RESET_MS);
  }, []);

  const flyOut = useCallback((dir: Direction, action?: () => void) => {
    const w = cardRef.current?.clientWidth ?? 400;
    const h = cardRef.current?.clientHeight ?? 600;
    const target =
      dir === 'right' ? { x: w * 1.5, y: 0 } :
      dir === 'left' ? { x: -w * 1.5, y: 0 } :
      dir === 'up' ? { x: 0, y: -h * 1.2 } :
      { x: 0, y: 0 };
    setCommitted(dir);
    setDrag({ x: target.x, y: target.y, animating: true });
    setTimeout(() => {
      action?.();
      setDrag({ x: 0, y: 0, animating: false });
      setCommitted(null);
    }, RESET_MS);
  }, []);

  const bind = useDrag(
    ({ movement: [mx, my], down, swipe: [sx, sy], cancel }) => {
      if (disabled) {
        cancel?.();
        return;
      }
      if (down) {
        setDrag({ x: mx, y: my, animating: false });
        return;
      }
      // released
      const absX = Math.abs(mx);
      const absY = Math.abs(my);
      // Use "swipe" velocity hint OR distance threshold
      if (sx === 1 || (mx > THRESHOLD_PX && absX > absY)) {
        if (onSwipeRight) {
          flyOut('right', onSwipeRight);
          return;
        }
      }
      if (sx === -1 || (mx < -THRESHOLD_PX && absX > absY)) {
        if (onSwipeLeft) {
          flyOut('left', onSwipeLeft);
          return;
        }
      }
      if (sy === -1 || (my < -THRESHOLD_PX && absY > absX)) {
        if (onSwipeUp) {
          flyOut('up', onSwipeUp);
          return;
        }
      }
      reset();
    },
    {
      axis: undefined,
      filterTaps: true,
      pointer: { touch: true },
      enabled: !disabled,
    }
  );

  // Visual hint: which direction is "committed" if released right now?
  const liveHint: Direction =
    committed ??
    (Math.abs(drag.x) > Math.abs(drag.y)
      ? drag.x > THRESHOLD_PX ? 'right' : drag.x < -THRESHOLD_PX ? 'left' : null
      : drag.y < -THRESHOLD_PX ? 'up' : null);

  const rotateDeg = drag.x / 24;
  const transform = `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${rotateDeg}deg)`;

  return (
    <div
      ref={cardRef}
      {...(disabled ? {} : bind())}
      className={cn(
        'relative select-none',
        !disabled && 'touch-none cursor-grab active:cursor-grabbing',
        className
      )}
      style={{
        transform,
        transition: drag.animating ? `transform ${RESET_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
        willChange: 'transform',
      }}
    >
      {children}

      {!disabled && liveHint && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-md flex items-center justify-center',
            liveHint === 'right' && 'bg-green-500/20 border-2 border-green-500',
            liveHint === 'left' && 'bg-amber-500/20 border-2 border-amber-500',
            liveHint === 'up' && 'bg-blue-500/20 border-2 border-blue-500'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full font-bold text-white text-lg shadow-lg uppercase tracking-wider',
              liveHint === 'right' && 'bg-green-600',
              liveHint === 'left' && 'bg-amber-600',
              liveHint === 'up' && 'bg-blue-600'
            )}
          >
            {liveHint === 'right' && (<><CheckCircle className="h-5 w-5" /> Approve</>)}
            {liveHint === 'left' && (<><ListTodo className="h-5 w-5" /> Todo</>)}
            {liveHint === 'up' && (<><SkipForward className="h-5 w-5" /> Skip</>)}
          </div>
        </div>
      )}
    </div>
  );
}
