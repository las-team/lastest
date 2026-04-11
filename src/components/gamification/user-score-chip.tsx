'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy, Zap } from 'lucide-react';
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

/**
 * Compact arcade-styled score chip in the sidebar. Polls every 15s for the
 * viewer's current score snapshot. On new points, briefly pulses neon.
 */
export function UserScoreChip() {
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

  if (!snapshot) return null;

  return (
    <Link
      href="/leaderboard"
      className={cn(
        'group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs font-mono',
        'bg-gradient-to-r from-primary/5 to-transparent',
        'hover:border-primary/40 transition-colors',
        pulse && 'ring-2 ring-primary shadow-[0_0_16px_rgba(250,204,21,0.55)] border-primary',
      )}
      title={`Season: ${snapshot.seasonName}`}
    >
      <span className="flex items-center gap-1 text-muted-foreground">
        <Trophy className="h-3 w-3" />
        SCORE
      </span>
      <span
        className={cn(
          'font-bold tabular-nums',
          snapshot.blitz ? 'text-yellow-500' : 'text-primary',
        )}
      >
        {snapshot.total.toLocaleString()}
      </span>
      {snapshot.blitz && (
        <Zap className="h-3 w-3 text-yellow-500 animate-pulse" aria-label="Bug Blitz active" />
      )}
    </Link>
  );
}
