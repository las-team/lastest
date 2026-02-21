'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveDiffSensitivitySettings, resetDiffSensitivitySettings } from '@/server/actions/settings';
import type { DiffSensitivitySettings, DiffEngineType, TextDetectionGranularity } from '@/lib/db/schema';
import { DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';
import { Loader2, RotateCcw, Eye, Zap, Brain, Sparkles, Type } from 'lucide-react';
import { toast } from 'sonner';

interface DiffSensitivityCardProps {
  settings: DiffSensitivitySettings;
  repositoryId?: string | null;
}

const ENGINE_INFO: Record<DiffEngineType, { label: string; description: string; icon: typeof Zap; speed: string; accuracy: string }> = {
  pixelmatch: {
    label: 'Pixelmatch',
    description: 'Pixel-perfect binary comparison. Fast and strict — best for CI gating.',
    icon: Zap,
    speed: 'Fastest',
    accuracy: 'Pixel-exact',
  },
  ssim: {
    label: 'SSIM',
    description: 'Structural similarity index. Tolerant of rendering noise — best for perceptual comparison.',
    icon: Brain,
    speed: 'Medium',
    accuracy: 'Perceptual',
  },
  butteraugli: {
    label: 'Butteraugli',
    description: 'Human-perception-aligned via CIELAB color space. Most advanced — best for cross-platform consistency.',
    icon: Sparkles,
    speed: 'Slowest',
    accuracy: 'Human-aligned',
  },
};

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
  const [diffEngine, setDiffEngine] = useState<DiffEngineType>(
    (settings.diffEngine as DiffEngineType) ?? DEFAULT_DIFF_THRESHOLDS.diffEngine
  );
  const [textRegionAwareDiffing, setTextRegionAwareDiffing] = useState(
    settings.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing
  );
  const [textRegionThreshold, setTextRegionThreshold] = useState(
    settings.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold
  );
  const [textRegionPadding, setTextRegionPadding] = useState(
    settings.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding
  );
  const [textDetectionGranularity, setTextDetectionGranularity] = useState<TextDetectionGranularity>(
    (settings.textDetectionGranularity as TextDetectionGranularity) ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity
  );

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const originalValues = useRef({
    unchangedThreshold: settings.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
    flakyThreshold: settings.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
    includeAntiAliasing: settings.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
    ignorePageShift: settings.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
    diffEngine: (settings.diffEngine as DiffEngineType) ?? DEFAULT_DIFF_THRESHOLDS.diffEngine,
    textRegionAwareDiffing: settings.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing,
    textRegionThreshold: settings.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold,
    textRegionPadding: settings.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding,
    textDetectionGranularity: (settings.textDetectionGranularity as TextDetectionGranularity) ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity,
  });

  const settingsKey = `${settings.id}-${settings.updatedAt?.getTime?.() ?? 0}`;
  useEffect(() => {
    setUnchangedThreshold(settings.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold);
    setFlakyThreshold(settings.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold);
    setIncludeAntiAliasing(settings.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing);
    setIgnorePageShift(settings.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift);
    setDiffEngine((settings.diffEngine as DiffEngineType) ?? DEFAULT_DIFF_THRESHOLDS.diffEngine);
    setTextRegionAwareDiffing(settings.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing);
    setTextRegionThreshold(settings.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold);
    setTextRegionPadding(settings.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding);
    setTextDetectionGranularity((settings.textDetectionGranularity as TextDetectionGranularity) ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity);

    originalValues.current = {
      unchangedThreshold: settings.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
      flakyThreshold: settings.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
      includeAntiAliasing: settings.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
      ignorePageShift: settings.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
      diffEngine: (settings.diffEngine as DiffEngineType) ?? DEFAULT_DIFF_THRESHOLDS.diffEngine,
      textRegionAwareDiffing: settings.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing,
      textRegionThreshold: settings.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold,
      textRegionPadding: settings.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding,
      textDetectionGranularity: (settings.textDetectionGranularity as TextDetectionGranularity) ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveDiffSensitivitySettings({
        repositoryId,
        unchangedThreshold,
        flakyThreshold,
        includeAntiAliasing,
        ignorePageShift,
        diffEngine,
        textRegionAwareDiffing,
        textRegionThreshold,
        textRegionPadding,
        textDetectionGranularity,
      });
      toast.success('Diff sensitivity settings saved');
    });
  }, [repositoryId, unchangedThreshold, flakyThreshold, includeAntiAliasing, ignorePageShift, diffEngine, textRegionAwareDiffing, textRegionThreshold, textRegionPadding, textDetectionGranularity]);

  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges =
      unchangedThreshold !== orig.unchangedThreshold ||
      flakyThreshold !== orig.flakyThreshold ||
      includeAntiAliasing !== orig.includeAntiAliasing ||
      ignorePageShift !== orig.ignorePageShift ||
      diffEngine !== orig.diffEngine ||
      textRegionAwareDiffing !== orig.textRegionAwareDiffing ||
      textRegionThreshold !== orig.textRegionThreshold ||
      textRegionPadding !== orig.textRegionPadding ||
      textDetectionGranularity !== orig.textDetectionGranularity;

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
  }, [unchangedThreshold, flakyThreshold, includeAntiAliasing, ignorePageShift, diffEngine, textRegionAwareDiffing, textRegionThreshold, textRegionPadding, textDetectionGranularity, doSave]);

  const handleReset = () => {
    startTransition(async () => {
      await resetDiffSensitivitySettings(repositoryId);
      setUnchangedThreshold(DEFAULT_DIFF_THRESHOLDS.unchangedThreshold);
      setFlakyThreshold(DEFAULT_DIFF_THRESHOLDS.flakyThreshold);
      setIncludeAntiAliasing(DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing);
      setIgnorePageShift(DEFAULT_DIFF_THRESHOLDS.ignorePageShift);
      setDiffEngine(DEFAULT_DIFF_THRESHOLDS.diffEngine);
      setTextRegionAwareDiffing(DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing);
      setTextRegionThreshold(DEFAULT_DIFF_THRESHOLDS.textRegionThreshold);
      setTextRegionPadding(DEFAULT_DIFF_THRESHOLDS.textRegionPadding);
      setTextDetectionGranularity(DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity);
      toast.success('Diff sensitivity reset to defaults');
    });
  };

  const handleUnchangedChange = (value: number) => {
    const clamped = Math.max(0, Math.min(value, flakyThreshold - 1));
    setUnchangedThreshold(clamped);
  };

  const handleFlakyChange = (value: number) => {
    const clamped = Math.max(unchangedThreshold + 1, Math.min(value, 100));
    setFlakyThreshold(clamped);
  };

  const engineInfo = ENGINE_INFO[diffEngine];
  const EngineIcon = engineInfo.icon;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Diff Sensitivity
        </CardTitle>
        <CardDescription>
          Configure diff engine, thresholds, and text-region detection for visual change classification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Diff Engine Selection */}
        <div className="space-y-3">
          <Label>Diff Engine</Label>
          <Select value={diffEngine} onValueChange={(v) => setDiffEngine(v as DiffEngineType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(ENGINE_INFO) as [DiffEngineType, typeof engineInfo][]).map(([key, info]) => {
                const Icon = info.icon;
                return (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      <span>{info.label}</span>
                      <span className="text-xs text-muted-foreground ml-1">({info.speed})</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
            <EngineIcon className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
            <div className="space-y-1">
              <p className="text-sm">{engineInfo.description}</p>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>Speed: {engineInfo.speed}</span>
                <span>Accuracy: {engineInfo.accuracy}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Visual Threshold Indicator */}
        <div className="space-y-3">
          <Label>Classification Zones</Label>
          <div className="relative h-8 rounded-lg overflow-hidden border">
            <div
              className="absolute top-0 bottom-0 left-0 bg-green-400"
              style={{ width: `${unchangedThreshold}%` }}
            />
            <div
              className="absolute top-0 bottom-0 bg-yellow-400"
              style={{
                left: `${unchangedThreshold}%`,
                width: `${flakyThreshold - unchangedThreshold}%`,
              }}
            />
            <div
              className="absolute top-0 bottom-0 right-0 bg-red-400"
              style={{ width: `${100 - flakyThreshold}%` }}
            />
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
            <Label className="text-sm font-medium">Ignore Page Shifts <span className="ml-1 text-[10px] font-semibold uppercase text-muted-foreground">Beta</span></Label>
            <p className="text-xs text-muted-foreground">
              Exclude vertical content shifts from diffs. When content is inserted or removed (e.g. a banner), only genuinely changed pixels are counted — displaced content is aligned and excluded.
            </p>
          </div>
          <Switch
            checked={ignorePageShift}
            onCheckedChange={setIgnorePageShift}
          />
        </div>

        {/* Text-Region-Aware Diffing */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Text-Region-Aware Diffing</Label>
                <p className="text-xs text-muted-foreground">
                  Use OCR to detect text regions and apply lenient thresholds, reducing false positives from font rendering and dynamic text.
                </p>
              </div>
            </div>
            <Switch
              checked={textRegionAwareDiffing}
              onCheckedChange={setTextRegionAwareDiffing}
            />
          </div>

          {textRegionAwareDiffing && (
            <div className="space-y-4 pl-6 border-l-2 border-muted">
              {/* Text Region Tolerance */}
              <div className="space-y-2">
                <Label htmlFor="textRegionThreshold">
                  Text Region Tolerance ({textRegionThreshold}%)
                </Label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    id="textRegionThreshold"
                    min={1}
                    max={100}
                    value={textRegionThreshold}
                    onChange={(e) => setTextRegionThreshold(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={textRegionThreshold}
                    onChange={(e) => setTextRegionThreshold(parseInt(e.target.value) || 30)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Higher values tolerate more text rendering differences (30% recommended)
                </p>
              </div>

              {/* Text Region Padding */}
              <div className="space-y-2">
                <Label htmlFor="textRegionPadding">
                  Text Region Padding ({textRegionPadding}px)
                </Label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    id="textRegionPadding"
                    min={0}
                    max={20}
                    value={textRegionPadding}
                    onChange={(e) => setTextRegionPadding(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={textRegionPadding}
                    onChange={(e) => setTextRegionPadding(parseInt(e.target.value) || 4)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">px</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Extra padding around detected text bounding boxes
                </p>
              </div>

              {/* Detection Granularity */}
              <div className="space-y-2">
                <Label>Detection Granularity</Label>
                <Select
                  value={textDetectionGranularity}
                  onValueChange={(v) => setTextDetectionGranularity(v as TextDetectionGranularity)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="word">Word (precise, slower)</SelectItem>
                    <SelectItem value="line">Line (balanced)</SelectItem>
                    <SelectItem value="block">Block (fast, coarse)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Finer granularity detects text more precisely but takes longer
                </p>
              </div>
            </div>
          )}
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
