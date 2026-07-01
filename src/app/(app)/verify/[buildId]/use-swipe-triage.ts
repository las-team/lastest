"use client";

import { useRef, useState } from "react";

export type SwipeDir = "left" | "right";

interface SwipeTriageOptions {
  /** Fired when the finger lifts past the commit threshold. */
  onCommit: (dir: SwipeDir) => void;
  /** Rubber-band (never commit) the given direction — e.g. a card already
   *  in Verified can't be swiped right into Verified again. */
  disableLeft?: boolean;
  disableRight?: boolean;
  /** Horizontal distance (px) that commits on release. */
  commitPx?: number;
}

/**
 * Touch-only horizontal swipe with a direction lock, for swipe-to-triage
 * rows (mail-app pattern) and the review-mode card stack.
 *
 * The lock is what keeps vertical scrolling intact: the gesture only starts
 * tracking once horizontal movement clearly dominates (past a 12px slop
 * zone); a vertical-dominant gesture is handed back to the browser for the
 * whole touch. Pair the returned handlers with `touch-action: pan-y` on the
 * element so the browser keeps scrolling but doesn't claim horizontal pans.
 */
export function useSwipeTriage({
  onCommit,
  disableLeft,
  disableRight,
  commitPx = 96,
}: SwipeTriageOptions) {
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const lock = useRef<"h" | "v" | null>(null);

  const reset = () => {
    start.current = null;
    lock.current = null;
    setDx(0);
    setSwiping(false);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    lock.current = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const moveX = t.clientX - start.current.x;
    const moveY = t.clientY - start.current.y;
    if (!lock.current) {
      if (Math.abs(moveX) < 12 && Math.abs(moveY) < 12) return;
      lock.current = Math.abs(moveX) > Math.abs(moveY) * 1.2 ? "h" : "v";
      if (lock.current === "h") setSwiping(true);
    }
    if (lock.current !== "h") return;
    let next = moveX;
    // Disabled side: heavy resistance, capped well under the commit
    // threshold, so the affordance hints "nothing this way".
    if (next < 0 && disableLeft) next = Math.max(next / 4, -24);
    if (next > 0 && disableRight) next = Math.min(next / 4, 24);
    setDx(next);
  };

  const onTouchEnd = () => {
    const committed = lock.current === "h" && Math.abs(dx) >= commitPx;
    const dir: SwipeDir = dx > 0 ? "right" : "left";
    reset();
    if (committed) onCommit(dir);
  };

  return {
    /** Live horizontal offset to translate the row/card by. */
    dx,
    /** True while a horizontal gesture is engaged (disable transitions). */
    swiping,
    /** Progress toward commit, 0..1 — drive backdrop/stamp opacity. */
    progress: Math.min(1, Math.abs(dx) / commitPx),
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}
