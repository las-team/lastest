import { notFound } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, Zap, Bot as BotIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const session = await getCurrentSession();
  if (!session?.team) notFound();
  if (!session.team.gamificationEnabled) notFound();

  const season = await queries.getActiveSeason(session.team.id);
  if (!season) {
    return (
      <div className="p-8">
        <EmptyState />
      </div>
    );
  }

  const [leaderboard, blitz] = await Promise.all([
    queries.getSeasonLeaderboard(season.id, session.team.id, 10),
    queries.getActiveBugBlitz(session.team.id),
  ]);

  // Append viewer's own row if they're outside the top 10
  const viewerId = session.user.id;
  let viewerRow = leaderboard.find((r) => r.actorKind === 'user' && r.actorId === viewerId);
  if (!viewerRow) {
    const row = await queries.getUserScoreRow(season.id, 'user', viewerId);
    if (row) {
      // Rank is approximate (count of actors with strictly higher score + 1).
      const allRows = await queries.getSeasonLeaderboard(season.id, session.team.id, 1000);
      const betterCount = allRows.findIndex((r) => r.actorKind === 'user' && r.actorId === viewerId);
      viewerRow = {
        rank: betterCount >= 0 ? betterCount + 1 : leaderboard.length + 1,
        actorKind: 'user',
        actorId: viewerId,
        displayName: session.user.name || session.user.email,
        avatarUrl: session.user.avatarUrl,
        avatarEmoji: null,
        total: row.total,
        testsCreated: row.testsCreated,
        regressionsCaught: row.regressionsCaught,
        flakesIncurred: row.flakesIncurred,
      };
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
          <Trophy className="h-3 w-3" />
          {season.name}
        </div>
        <h1 className="text-4xl font-black tracking-tight font-[family-name:var(--font-press-start,monospace)]">
          HIGH SCORES
        </h1>
        <p className="text-sm text-muted-foreground">
          Beat the bot. Catch real regressions. Earn your place on the board.
        </p>
      </header>

      {blitz && (
        <Card className="border-yellow-500/60 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950/30 dark:to-orange-950/30 shadow-[0_0_24px_rgba(250,204,21,0.25)]">
          <CardContent className="flex items-center gap-3 py-4">
            <Zap className="h-5 w-5 text-yellow-600" />
            <div className="flex-1">
              <div className="font-semibold">🐛 BUG BLITZ ACTIVE — {blitz.name}</div>
              <div className="text-xs text-muted-foreground">
                All score events earn ×{(blitz.multiplier / 100).toFixed(1)}
                {blitz.endsAt ? ` until ${new Date(blitz.endsAt).toLocaleString()}` : ''}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-2">
        <CardHeader className="border-b bg-muted/40">
          <CardTitle className="flex items-center justify-between font-mono text-sm uppercase tracking-widest">
            <span>Rank · Player</span>
            <span>Score</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {leaderboard.length === 0 ? (
            <EmptyBoard />
          ) : (
            <ul className="divide-y">
              {leaderboard.map((row) => (
                <LeaderboardRow
                  key={`${row.actorKind}:${row.actorId}`}
                  row={row}
                  isViewer={row.actorKind === 'user' && row.actorId === viewerId}
                />
              ))}
              {viewerRow && viewerRow.rank > 10 && (
                <>
                  <li className="py-2 text-center text-xs font-mono uppercase tracking-widest text-muted-foreground">
                    · · ·
                  </li>
                  <LeaderboardRow row={viewerRow} isViewer />
                </>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Seasons reset. Bots never sleep.
      </p>
    </div>
  );
}

function LeaderboardRow({
  row,
  isViewer,
}: {
  row: {
    rank: number;
    actorKind: 'user' | 'bot';
    displayName: string;
    avatarUrl: string | null;
    avatarEmoji: string | null;
    total: number;
    testsCreated: number;
    regressionsCaught: number;
    flakesIncurred: number;
  };
  isViewer: boolean;
}) {
  const topThree = row.rank <= 3;
  const rankColor =
    row.rank === 1
      ? 'text-yellow-500 drop-shadow-[0_0_6px_rgba(250,204,21,0.6)]'
      : row.rank === 2
        ? 'text-slate-300'
        : row.rank === 3
          ? 'text-orange-500'
          : 'text-muted-foreground';

  return (
    <li
      className={cn(
        'flex items-center gap-4 px-4 py-3',
        isViewer && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
      )}
    >
      <div className={cn('w-8 text-right font-mono font-bold text-lg', rankColor)}>#{row.rank}</div>
      <Avatar className="h-9 w-9">
        {row.actorKind === 'user' && row.avatarUrl && (
          <AvatarImage src={row.avatarUrl} alt={row.displayName} />
        )}
        <AvatarFallback className={cn(row.actorKind === 'bot' && 'bg-cyan-500/10')}>
          {row.actorKind === 'bot' ? row.avatarEmoji ?? '🤖' : initials(row.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{row.displayName}</span>
          {row.actorKind === 'bot' && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              <BotIcon className="h-3 w-3 mr-1" />
              Bot
            </Badge>
          )}
          {isViewer && (
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              You
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground flex gap-3 mt-0.5">
          <span>{row.testsCreated} tests</span>
          <span>{row.regressionsCaught} regressions</span>
          {row.flakesIncurred > 0 && <span className="text-orange-500">{row.flakesIncurred} flakes</span>}
        </div>
      </div>
      <div
        className={cn(
          'font-mono font-bold text-xl tabular-nums',
          topThree && 'text-primary',
        )}
      >
        {row.total.toLocaleString()}
      </div>
    </li>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function EmptyState() {
  return (
    <Card className="max-w-xl mx-auto text-center py-12">
      <CardContent className="space-y-4">
        <div className="text-6xl">🕹️</div>
        <CardTitle>No season running</CardTitle>
        <p className="text-sm text-muted-foreground">
          Ask an admin to start a season in Settings → Gamification.
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyBoard() {
  return (
    <div className="py-12 text-center space-y-2">
      <div className="text-4xl">👾</div>
      <p className="text-sm text-muted-foreground">
        No scores yet. Create a test to get on the board.
      </p>
    </div>
  );
}
