'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SlidersHorizontal, Layers, Type, ChevronDown, RotateCcw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { saveTestDiffOverrides, resetTestDiffOverrides } from '@/server/actions/test-overrides';
import type { TestDiffOverrides as TestDiffOverridesType } from '@/lib/db/schema';
import { DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';

interface TestDiffOverridesProps {
  testId: string;
  repositoryId: string | null;
  overrides: TestDiffOverridesType | null;
  defaults: typeof DEFAULT_DIFF_THRESHOLDS;
}

type BooleanKeys = { [K in keyof Required<TestDiffOverridesType>]: NonNullable<TestDiffOverridesType[K]> extends boolean ? K : never }[keyof TestDiffOverridesType];
type NumberKeys = { [K in keyof Required<TestDiffOverridesType>]: NonNullable<TestDiffOverridesType[K]> extends number ? K : never }[keyof TestDiffOverridesType];
type StringKeys = { [K in keyof Required<TestDiffOverridesType>]: NonNullable<TestDiffOverridesType[K]> extends string ? K : never }[keyof TestDiffOverridesType];

export function TestDiffOverrides({ testId, repositoryId, overrides: initialOverrides, defaults }: TestDiffOverridesProps) {
  const [overrides, setOverrides] = useState<Partial<TestDiffOverridesType>>(initialOverrides ?? {});
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(initialOverrides ?? {}));

  const getVal = <K extends keyof TestDiffOverridesType>(key: K): NonNullable<TestDiffOverridesType[K]> => {
    return (key in overrides ? overrides[key] : (defaults as Record<string, unknown>)[key]) as NonNullable<TestDiffOverridesType[K]>;
  };

  const isOverridden = (key: keyof TestDiffOverridesType) => key in overrides;

  const setVal = <K extends keyof TestDiffOverridesType>(key: K, value: TestDiffOverridesType[K]) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
  };

  const restoreKey = (...keys: (keyof TestDiffOverridesType)[]) => {
    setOverrides(prev => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const doSave = useCallback(async (current: Partial<TestDiffOverridesType>) => {
    const serialized = JSON.stringify(current);
    if (serialized === lastSaved.current) return;
    setIsSaving(true);
    try {
      const toSave = Object.keys(current).length === 0 ? null : (current as TestDiffOverridesType);
      await saveTestDiffOverrides(testId, repositoryId, toSave);
      lastSaved.current = serialized;
    } catch {
      toast.error('Failed to save diff overrides');
    } finally {
      setIsSaving(false);
    }
  }, [testId, repositoryId]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(overrides), 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [overrides, doSave]);

  const handleReset = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setOverrides({});
    lastSaved.current = JSON.stringify({});
    try {
      await resetTestDiffOverrides(testId, repositoryId);
      toast.success('Diff overrides reset');
    } catch {
      toast.error('Failed to reset overrides');
    }
  };

  const overrideCount = Object.keys(overrides).length;

  const OverrideIndicator = ({ keys }: { keys: (keyof TestDiffOverridesType)[] }) => {
    const anyOverridden = keys.some(k => isOverridden(k));
    if (!anyOverridden) return null;
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); restoreKey(...keys); }}>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p className="text-xs">Overridden — click to restore default</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderBool = (key: BooleanKeys, label: string, description: string) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <OverrideIndicator keys={[key]} />
        <div className="space-y-0.5">
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch
        checked={getVal(key) as boolean}
        onCheckedChange={(checked) => setVal(key, checked as TestDiffOverridesType[typeof key])}
      />
    </div>
  );

  const renderNum = (
    key: NumberKeys,
    label: string,
    config: { min: number; max: number; step: number; fallback: number },
    suffix?: string,
    disabled?: boolean,
  ) => (
    <div className="flex items-center justify-between pl-4">
      <div className="flex items-center gap-1.5">
        <OverrideIndicator keys={[key]} />
        <Label className="text-sm">{label}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={config.min}
          max={config.max}
          step={config.step}
          value={getVal(key) as number}
          onChange={(e) => setVal(key, Math.max(config.min, Math.min(config.max, (config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value)) || config.fallback)) as TestDiffOverridesType[typeof key])}
          className="w-20"
          disabled={disabled}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );

  const renderSelect = (
    key: StringKeys,
    label: string,
    description: string,
    options: { value: string; label: string }[],
  ) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <OverrideIndicator keys={[key]} />
        <div className="space-y-0.5">
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Select
        value={getVal(key) as string}
        onValueChange={(value) => setVal(key, value as TestDiffOverridesType[typeof key])}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Diff Overrides
            {overrideCount > 0 && (
              <span className="text-xs bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {overrideCount} override{overrideCount !== 1 ? 's' : ''}
              </span>
            )}
            {isSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
          </CardTitle>
          {overrideCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Restore All Defaults
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Per-test diff settings. Changed values override repo defaults and show a warning indicator.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Thresholds */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['unchangedThreshold', 'flakyThreshold'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Thresholds</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderNum('unchangedThreshold', 'Unchanged Threshold', { min: 0, max: 100, step: 0.1, fallback: 1 }, '%')}
            {renderNum('flakyThreshold', 'Flaky Threshold', { min: 0, max: 100, step: 0.1, fallback: 10 }, '%')}
          </CollapsibleContent>
        </Collapsible>

        {/* Diff Engine */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['diffEngine', 'includeAntiAliasing', 'ignorePageShift'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Diff Engine</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderSelect('diffEngine', 'Engine', 'Algorithm used for pixel comparison', [
              { value: 'pixelmatch', label: 'Pixelmatch' },
              { value: 'ssim', label: 'SSIM' },
              { value: 'butteraugli', label: 'Butteraugli' },
            ])}
            {renderBool('includeAntiAliasing', 'Include Anti-Aliasing', 'Count anti-aliased pixels as differences')}
            {renderBool('ignorePageShift', 'Ignore Page Shift', 'Compensate for minor page shifts before diffing')}
          </CollapsibleContent>
        </Collapsible>

        {/* Text Region Diffing */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['textRegionAwareDiffing', 'textRegionThreshold', 'textRegionPadding', 'textDetectionGranularity', 'regionDetectionMode'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Text Region Diffing</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('textRegionAwareDiffing', 'Text Region Aware Diffing', 'Apply separate thresholds to detected text regions')}
            {(getVal('textRegionAwareDiffing') as boolean) && (
              <>
                {renderNum('textRegionThreshold', 'Text Region Threshold', { min: 0, max: 100, step: 1, fallback: 30 }, '%')}
                {renderNum('textRegionPadding', 'Text Region Padding', { min: 0, max: 50, step: 1, fallback: 4 }, 'px')}
                {renderSelect('textDetectionGranularity', 'Detection Granularity', 'Level of text region detection', [
                  { value: 'word', label: 'Word' },
                  { value: 'line', label: 'Line' },
                  { value: 'block', label: 'Block' },
                ])}
                {renderSelect('regionDetectionMode', 'Detection Mode', 'Algorithm for finding text regions', [
                  { value: 'grid', label: 'Grid' },
                  { value: 'flood-fill', label: 'Flood Fill' },
                ])}
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
