'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveDiffSensitivitySettings, resetDiffSensitivitySettings } from '@/server/actions/settings';
import type { DiffSensitivitySettings } from '@/lib/db/schema';
import { DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';
import { Loader2, RotateCcw, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface DiffSensitivityCardProps {
  settings: DiffSensitivitySettings;
  repositoryId?: string | null;
}

export function DiffSensitivityCard({
  settings,
  repositoryId,
}: DiffSensitivityCardProps) {
  const [isPending, startTransition] = useTransition();
  const [unchangedThreshold, setUnchangedThreshold] = useState(
    settings.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold
  );
  const [flakyThreshold, setFlakyThreshold] = useState(
    settings.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold
  );
  const [includeAntiAliasing, setIncludeAntiAliasing] = useState(
    settings.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing
  );
  const [ignorePageShift, setIgnorePageShift] = useState(
    settings.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift
  );

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Store original values to compare against (prevents save on mount)
  const originalValues = useRef({
    unchangedThreshold: settings.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
    flakyThreshold: settings.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
    includeAntiAliasing: settings.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
    ignorePageShift: settings.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
  });

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveDiffSensitivitySettings({
        repositoryId,
        unchangedThreshold,
        flakyThreshold,
        includeAntiAliasing,
        ignorePageShift,
      });
      toast.success('Diff sensitivity settings saved');
    });
  }, [repositoryId, unchangedThreshold, flakyThreshold, includeAntiAliasing, ignorePageShift]);

  // Auto-save with debounce - only when values differ from original props
  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges =
      unchangedThreshold !== orig.unchangedThreshold ||
      flakyThreshold !== orig.flakyThreshold ||
      includeAntiAliasing !== orig.includeAntiAliasing ||
      ignorePageShift !== orig.ignorePageShift;

    if (!hasChanges) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      doSave();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [unchangedThreshold, flakyThreshold, includeAntiAliasing, ignorePageShift, doSave]);

  const handleReset = () => {
    startTransition(async () => {
      await resetDiffSensitivitySettings(repositoryId);
      setUnchangedThreshold(DEFAULT_DIFF_THRESHOLDS.unchangedThreshold);
      setFlakyThreshold(DEFAULT_DIFF_THRESHOLDS.flakyThreshold);
      setIncludeAntiAliasing(DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing);
      setIgnorePageShift(DEFAULT_DIFF_THRESHOLDS.ignorePageShift);
      toast.success('Diff sensitivity reset to defaults');
    });
  };

  // Ensure thresholds are valid (unchanged < flaky < 100)
  const handleUnchangedChange = (value: number) => {
    const clamped = Math.max(0, Math.min(value, flakyThreshold - 1));
    setUnchangedThreshold(clamped);
  };

  const handleFlakyChange = (value: number) => {
    const clamped = Math.max(unchangedThreshold + 1, Math.min(value, 100));
    setFlakyThreshold(clamped);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Diff Sensitivity
        </CardTitle>
        <CardDescription>
          Configure pixel difference thresholds for classifying visual changes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visual Threshold Indicator */}
        <div className="space-y-3">
          <Label>Classification Zones</Label>
          <div className="relative h-8 rounded-lg overflow-hidden border">
            {/* Unchanged zone (green) */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-green-400"
              style={{ width: `${unchangedThreshold}%` }}
            />
            {/* Flaky zone (yellow) */}
            <div
              className="absolute top-0 bottom-0 bg-yellow-400"
              style={{
                left: `${unchangedThreshold}%`,
                width: `${flakyThreshold - unchangedThreshold}%`,
              }}
            />
            {/* Changed zone (red) */}
            <div
              className="absolute top-0 bottom-0 right-0 bg-red-400"
              style={{ width: `${100 - flakyThreshold}%` }}
            />
            {/* Threshold markers */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-gray-800"
              style={{ left: `${unchangedThreshold}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-gray-800"
              style={{ left: `${flakyThreshold}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-400" />
            <span>Unchanged (auto-approved)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-400" />
            <span>Flaky (pending)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-400" />
            <span>Changed (review)</span>
          </div>
        </div>

        {/* Unchanged Threshold */}
        <div className="space-y-2">
          <Label htmlFor="unchangedThreshold">
            Unchanged Threshold ({'\u003C'}{unchangedThreshold}%)
          </Label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              id="unchangedThreshold"
              min={0}
              max={flakyThreshold - 1}
              value={unchangedThreshold}
              onChange={(e) => handleUnchangedChange(parseInt(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <Input
              type="number"
              min={0}
              max={flakyThreshold - 1}
              value={unchangedThreshold}
              onChange={(e) => handleUnchangedChange(parseInt(e.target.value) || 0)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Diffs below this threshold are auto-approved as unchanged
          </p>
        </div>

        {/* Flaky Threshold */}
        <div className="space-y-2">
          <Label htmlFor="flakyThreshold">
            Flaky Threshold ({unchangedThreshold}-{flakyThreshold}%)
          </Label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              id="flakyThreshold"
              min={unchangedThreshold + 1}
              max={100}
              value={flakyThreshold}
              onChange={(e) => handleFlakyChange(parseInt(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-500"
            />
            <Input
              type="number"
              min={unchangedThreshold + 1}
              max={100}
              value={flakyThreshold}
              onChange={(e) => handleFlakyChange(parseInt(e.target.value) || 0)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Diffs between unchanged and flaky thresholds are marked as flaky (minor changes)
          </p>
        </div>

        {/* Changed Info */}
        <div className="p-3 bg-muted rounded-lg text-sm">
          <span className="font-medium">Changed ({'\u2265'}{flakyThreshold}%): </span>
          Diffs at or above the flaky threshold are marked as significant changes requiring review.
        </div>

        {/* Anti-aliasing Toggle */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Include Anti-aliasing</Label>
            <p className="text-xs text-muted-foreground">
              Count anti-aliased pixels in diff calculations. Disable to reduce false positives from font rendering.
            </p>
          </div>
          <Switch
            checked={includeAntiAliasing}
            onCheckedChange={setIncludeAntiAliasing}
          />
        </div>

        {/* Page Shift Detection Toggle */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Ignore Page Shifts</Label>
            <p className="text-xs text-muted-foreground">
              Exclude vertical content shifts from diffs. When content is inserted or removed (e.g. a banner), only genuinely changed pixels are counted — displaced content is aligned and excluded.
            </p>
          </div>
          <Switch
            checked={ignorePageShift}
            onCheckedChange={setIgnorePageShift}
          />
        </div>

        {/* Reset */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={handleReset} disabled={isPending}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-2" />
            )}
            Reset to Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
