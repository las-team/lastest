'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trophy, Zap } from 'lucide-react';
import {
  startNewSeason,
  endCurrentSeason,
  startBugBlitz,
  endBugBlitz,
} from '@/server/actions/gamification';

interface Props {
  enabled: boolean;
  activeSeasonName: string | null;
  activeBlitz: { id: string; name: string; endsAt: Date; multiplier: number } | null;
}

export function GamificationAdminCard({ enabled, activeSeasonName, activeBlitz }: Props) {
  const [isPending, startTransition] = useTransition();
  const [seasonName, setSeasonName] = useState('Season 1');
  const [blitzName, setBlitzName] = useState('Friday Bug Hunt');
  const [blitzHours, setBlitzHours] = useState(2);
  const [blitzMultiplier, setBlitzMultiplier] = useState(2);

  if (!enabled) {
    return (
      <Card id="gamification-admin" className="border-dashed opacity-70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Gamification — Admin Controls
          </CardTitle>
          <CardDescription>
            Enable gamification above to unlock seasons and bug blitzes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card id="gamification-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Gamification — Admin Controls
        </CardTitle>
        <CardDescription>
          Start and end seasons. Run Bug Blitz multipliers for time-boxed events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Active season */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Current season</div>
            {activeSeasonName ? (
              <Badge variant="secondary">{activeSeasonName}</Badge>
            ) : (
              <Badge variant="outline">None</Badge>
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="season-name" className="text-xs">New season name</Label>
              <Input
                id="season-name"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="Season 2"
              />
            </div>
            <Button
              disabled={isPending || !seasonName.trim()}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await startNewSeason(seasonName.trim());
                    toast.success(`Season "${seasonName}" started ★`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to start season');
                  }
                });
              }}
            >
              Start
            </Button>
            {activeSeasonName && (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  if (!confirm(`End "${activeSeasonName}"? Scores will be frozen.`)) return;
                  startTransition(async () => {
                    try {
                      await endCurrentSeason();
                      toast.success('Season ended');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to end season');
                    }
                  });
                }}
              >
                End
              </Button>
            )}
          </div>
        </section>

        {/* Bug blitz */}
        <section className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4 text-yellow-500" />
              Bug Blitz
            </div>
            {activeBlitz && (
              <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                Active ×{(activeBlitz.multiplier / 100).toFixed(1)}
              </Badge>
            )}
          </div>
          {activeBlitz ? (
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium">{activeBlitz.name}</div>
                <div className="text-muted-foreground">
                  Ends {new Date(activeBlitz.endsAt).toLocaleString()}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await endBugBlitz(activeBlitz.id);
                      toast.success('Bug Blitz ended');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed');
                    }
                  });
                }}
              >
                End now
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="blitz-name" className="text-xs">Name</Label>
                <Input id="blitz-name" value={blitzName} onChange={(e) => setBlitzName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="blitz-hours" className="text-xs">Hours</Label>
                <Input
                  id="blitz-hours"
                  type="number"
                  min={1}
                  max={72}
                  value={blitzHours}
                  onChange={(e) => setBlitzHours(Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="blitz-mult" className="text-xs">Multiplier</Label>
                <Input
                  id="blitz-mult"
                  type="number"
                  step={0.5}
                  min={1}
                  max={5}
                  value={blitzMultiplier}
                  onChange={(e) => setBlitzMultiplier(Number(e.target.value) || 2)}
                />
              </div>
              <Button
                className="sm:col-span-3"
                disabled={isPending || !blitzName.trim()}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await startBugBlitz({
                        name: blitzName.trim(),
                        durationHours: blitzHours,
                        multiplier: Math.round(blitzMultiplier * 100),
                      });
                      toast.success(`🐛 Bug Blitz "${blitzName}" started!`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to start blitz');
                    }
                  });
                }}
              >
                Start Bug Blitz
              </Button>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
