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
import { Shield, ChevronDown, RotateCcw, Hourglass, Pause, Ban, Eye, EyeOff, Camera, Monitor, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { saveTestStabilizationOverrides, resetTestStabilizationOverrides } from '@/server/actions/stabilization-overrides';
import type { StabilizationSettings } from '@/lib/db/schema';

interface TestStabilizationOverridesProps {
  testId: string;
  overrides: Partial<StabilizationSettings> | null;
  defaults: StabilizationSettings;
}

type BooleanKeys = { [K in keyof StabilizationSettings]: StabilizationSettings[K] extends boolean ? K : never }[keyof StabilizationSettings];
type NumberKeys = { [K in keyof StabilizationSettings]: StabilizationSettings[K] extends number ? K : never }[keyof StabilizationSettings];

export function TestStabilizationOverrides({ testId, overrides: initialOverrides, defaults }: TestStabilizationOverridesProps) {
  // Merged state: defaults + overrides. We track which keys are overridden separately.
  const [overrides, setOverrides] = useState<Partial<StabilizationSettings>>(initialOverrides ?? {});
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(initialOverrides ?? {}));

  // Effective value for any key: override if present, else default
  const getVal = <K extends keyof StabilizationSettings>(key: K): StabilizationSettings[K] => {
    return key in overrides ? (overrides[key] as StabilizationSettings[K]) : defaults[key];
  };

  const isOverridden = (key: keyof StabilizationSettings) => key in overrides;

  // Set a value — automatically marks it as overridden
  const setVal = <K extends keyof StabilizationSettings>(key: K, value: StabilizationSettings[K]) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
  };

  // Restore a single key back to the repo default (remove from overrides)
  const restoreKey = (...keys: (keyof StabilizationSettings)[]) => {
    setOverrides(prev => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const doSave = useCallback(async (current: Partial<StabilizationSettings>) => {
    const serialized = JSON.stringify(current);
    if (serialized === lastSaved.current) return;
    setIsSaving(true);
    try {
      const toSave = Object.keys(current).length === 0 ? null : current;
      await saveTestStabilizationOverrides(testId, toSave);
      lastSaved.current = serialized;
    } catch {
      toast.error('Failed to save stabilization overrides');
    } finally {
      setIsSaving(false);
    }
  }, [testId]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(overrides), 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [overrides, doSave]);

  const handleReset = async () => {
    // Cancel pending auto-save to prevent race condition
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setOverrides({});
    lastSaved.current = JSON.stringify({});
    try {
      await resetTestStabilizationOverrides(testId);
      toast.success('Stabilization overrides reset');
    } catch {
      toast.error('Failed to reset overrides');
    }
  };

  const overrideCount = Object.keys(overrides).length;

  // Warning triangle + restore button for overridden fields
  const OverrideIndicator = ({ keys }: { keys: (keyof StabilizationSettings)[] }) => {
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

  // Boolean toggle row
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
        onCheckedChange={(checked) => setVal(key, checked as StabilizationSettings[typeof key])}
      />
    </div>
  );

  // Boolean toggle + number input row
  const renderBoolNum = (
    boolKey: BooleanKeys,
    numKey: NumberKeys,
    label: string,
    description: string,
    numConfig: { min: number; max: number; step: number; fallback: number }
  ) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <OverrideIndicator keys={[boolKey, numKey]} />
        <div className="space-y-0.5">
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={numConfig.min}
          max={numConfig.max}
          step={numConfig.step}
          value={getVal(numKey) as number}
          onChange={(e) => setVal(numKey, Math.max(numConfig.min, parseInt(e.target.value) || numConfig.fallback) as StabilizationSettings[typeof numKey])}
          className="w-20"
          disabled={!(getVal(boolKey) as boolean)}
        />
        <span className="text-xs text-muted-foreground">ms</span>
        <Switch
          checked={getVal(boolKey) as boolean}
          onCheckedChange={(checked) => setVal(boolKey, checked as StabilizationSettings[typeof boolKey])}
        />
      </div>
    </div>
  );

  // Number input row (standalone)
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
          onChange={(e) => setVal(key, Math.max(config.min, Math.min(config.max, (config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value)) || config.fallback)) as StabilizationSettings[typeof key])}
          className="w-20"
          disabled={disabled}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Stabilization Overrides
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
        <p className="text-xs text-muted-foreground">Per-test stabilization settings. Changed values override repo defaults and show a warning indicator.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Wait Strategies */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['waitForNetworkIdle', 'networkIdleTimeout', 'waitForDomStable', 'domStableTimeout', 'waitForFonts', 'waitForImages', 'waitForImagesTimeout'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Hourglass className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Wait Strategies</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBoolNum('waitForNetworkIdle', 'networkIdleTimeout', 'Wait for Network Idle', 'Wait until no network requests', { min: 0, max: 30000, step: 1000, fallback: 5000 })}
            {renderBoolNum('waitForDomStable', 'domStableTimeout', 'Wait for DOM Stable', 'Wait until DOM mutations stop', { min: 0, max: 10000, step: 500, fallback: 2000 })}
            {renderBool('waitForFonts', 'Wait for Fonts', 'Wait for web fonts to load')}
            {renderBoolNum('waitForImages', 'waitForImagesTimeout', 'Wait for Images', 'Wait for all images to finish loading', { min: 0, max: 30000, step: 1000, fallback: 5000 })}
          </CollapsibleContent>
        </Collapsible>

        {/* Content Freezing */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['freezeTimestamps', 'frozenTimestamp', 'freezeRandomValues', 'randomSeed', 'reseedRandomOnInput', 'freezeAnimations'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Pause className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Content Freezing</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('freezeTimestamps', 'Freeze Timestamps', 'Use a fixed Date.now() value')}
            {(getVal('freezeTimestamps') as boolean) && (
              <div className="flex items-center gap-2 pl-4">
                <OverrideIndicator keys={['frozenTimestamp']} />
                <Label className="text-xs">Fixed timestamp:</Label>
                <Input
                  type="text"
                  value={getVal('frozenTimestamp') as string}
                  onChange={(e) => setVal('frozenTimestamp', e.target.value as StabilizationSettings['frozenTimestamp'])}
                  className="flex-1"
                  placeholder="2024-01-01T12:00:00Z"
                />
              </div>
            )}
            {renderBool('freezeRandomValues', 'Freeze Math.random()', 'Use seeded pseudo-random values')}
            {(getVal('freezeRandomValues') as boolean) && (
              <>
                <div className="flex items-center gap-2 pl-4">
                  <OverrideIndicator keys={['randomSeed']} />
                  <Label className="text-xs">Seed:</Label>
                  <Input
                    type="number"
                    value={getVal('randomSeed') as number}
                    onChange={(e) => setVal('randomSeed', (parseInt(e.target.value) || 12345) as StabilizationSettings['randomSeed'])}
                    className="w-24"
                  />
                </div>
                {renderBool('reseedRandomOnInput', 'Reseed on Input Events', 'Reset RNG from event hash on user input')}
              </>
            )}
            {renderBool('freezeAnimations', 'Freeze Animations', 'Freeze CSS animations/transitions')}
          </CollapsibleContent>
        </Collapsible>

        {/* Third-Party Handling */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['blockThirdParty', 'allowedDomains', 'mockThirdPartyImages'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Third-Party Handling</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('blockThirdParty', 'Block Third-Party Scripts', 'Block external domain requests')}
            {renderBool('mockThirdPartyImages', 'Mock Third-Party Images', 'Replace with placeholders')}
          </CollapsibleContent>
        </Collapsible>

        {/* Loading & Style */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['hideLoadingIndicators', 'crossOsConsistency', 'disableWebfonts', 'roundCanvasCoordinates'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Loading &amp; Style</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('hideLoadingIndicators', 'Hide Loading Spinners', 'CSS hide common loading indicators')}
            {renderBool('crossOsConsistency', 'Cross-OS Consistency', 'Bundled font + Chromium flags for identical screenshots')}
            {renderBool('disableWebfonts', 'Force System Fonts', 'Use system fonts only')}
            {renderBool('roundCanvasCoordinates', 'Round Canvas Coordinates', 'Snap stroke coordinates to pixel centers')}
          </CollapsibleContent>
        </Collapsible>

        {/* Burst Capture */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['burstCapture', 'burstFrameCount', 'burstStabilityThreshold'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Burst Capture</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('burstCapture', 'Enable Burst Capture', 'Take multiple screenshots to detect instability')}
            {(getVal('burstCapture') as boolean) && (
              <>
                {renderNum('burstFrameCount', 'Frame Count', { min: 2, max: 10, step: 1, fallback: 3 })}
                {renderNum('burstStabilityThreshold', 'Stability Threshold', { min: 0, max: 10, step: 0.1, fallback: 0.5 }, '%')}
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Dynamic Masking */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['autoMaskDynamicContent', 'maskPatterns', 'maskStyle', 'maskColor'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Dynamic Content Masking</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('autoMaskDynamicContent', 'Auto-Mask Dynamic Content', 'Detect and mask timestamps, UUIDs, etc.')}
          </CollapsibleContent>
        </Collapsible>

        {/* Canvas Stabilization */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['waitForCanvasStable', 'canvasStableTimeout', 'canvasStableThreshold', 'disableImageSmoothing'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Canvas Stabilization</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            {renderBool('waitForCanvasStable', 'Wait for Canvas Stable', 'Loop canvas comparisons until stable')}
            {(getVal('waitForCanvasStable') as boolean) && (
              <>
                {renderNum('canvasStableTimeout', 'Timeout', { min: 0, max: 30000, step: 1000, fallback: 3000 }, 'ms')}
                {renderNum('canvasStableThreshold', 'Stable Checks', { min: 1, max: 10, step: 1, fallback: 3 })}
              </>
            )}
            {renderBool('disableImageSmoothing', 'Disable Image Smoothing', 'Set imageSmoothingEnabled = false on 2D contexts')}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
