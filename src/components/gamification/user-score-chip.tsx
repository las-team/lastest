'use client';

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getViewerGamificationSnapshot } from '@/server/actions/gamification';

interface Snapshot {
  seasonId: string;
  seasonName: string;
  total: number;
  testsCreated: number;
  regressionsCaught: number;
  flakesIncurred: number;
  blitz: { id: string; name: string; multiplier: number; endsAt: Date | null } | null;
}

function useScoreSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let mounted = true;
    let lastTotal = -Infinity;

    async function tick() {
      try {
        const snap = (await getViewerGamificationSnapshot()) as Snapshot | null;
        if (!mounted) return;
        if (snap && snap.total !== lastTotal && lastTotal !== -Infinity) {
          setPulse(true);
          setTimeout(() => mounted && setPulse(false), 1200);
        }
        if (snap) lastTotal = snap.total;
        setSnapshot(snap);
      } catch {
        // ignore transient errors
      }
    }

    tick();
    const id = setInterval(tick, 15000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return { snapshot, pulse };
}

/**
 * Slim inline score display meant to sit beside the Leaderboard nav label.
 * Renders just the number (+ optional blitz Zap). Parent link handles navigation.
 */
export function InlineScore({ className }: { className?: string }) {
  const { snapshot, pulse } = useScoreSnapshot();

  if (!snapshot) return null;

  return (
    <span
      className={cn('flex items-center gap-1 font-mono text-xs tabular-nums', className)}
      title={`Season: ${snapshot.seasonName}`}
    >
      <span
        className={cn(
          'font-bold tabular-nums rounded px-1',
          snapshot.blitz ? 'text-yellow-500' : 'text-primary',
          pulse && 'ring-2 ring-primary shadow-[0_0_12px_rgba(250,204,21,0.55)]',
        )}
      >
        {snapshot.total.toLocaleString()}
      </span>
      {snapshot.blitz && (
        <Zap className="h-3 w-3 text-yellow-500 animate-pulse" aria-label="Bug Blitz active" />
      )}
    </span>
  );
}
