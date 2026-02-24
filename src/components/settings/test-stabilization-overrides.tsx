'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Shield, ChevronDown, RotateCcw, Hourglass, Pause, Ban, Eye, EyeOff, Camera, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { saveTestStabilizationOverrides, resetTestStabilizationOverrides } from '@/server/actions/stabilization-overrides';
import type { StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';

interface TestStabilizationOverridesProps {
  testId: string;
  overrides: Partial<StabilizationSettings> | null;
  defaults: StabilizationSettings;
}

type BooleanKeys = { [K in keyof StabilizationSettings]: StabilizationSettings[K] extends boolean ? K : never }[keyof StabilizationSettings];
type NumberKeys = { [K in keyof StabilizationSettings]: StabilizationSettings[K] extends number ? K : never }[keyof StabilizationSettings];

export function TestStabilizationOverrides({ testId, overrides: initialOverrides, defaults }: TestStabilizationOverridesProps) {
  const [overrides, setOverrides] = useState<Partial<StabilizationSettings>>(initialOverrides ?? {});
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(initialOverrides ?? {}));

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

  const isOverridden = (key: keyof StabilizationSettings) => key in overrides;

  const toggleOverride = (key: keyof StabilizationSettings) => {
    if (isOverridden(key)) {
      const next = { ...overrides };
      delete next[key];
      setOverrides(next);
    } else {
      setOverrides({ ...overrides, [key]: defaults[key] });
    }
  };

  const getValue = <K extends keyof StabilizationSettings>(key: K): StabilizationSettings[K] => {
    return isOverridden(key) ? (overrides[key] as StabilizationSettings[K]) : defaults[key];
  };

  const setValue = <K extends keyof StabilizationSettings>(key: K, value: StabilizationSettings[K]) => {
    setOverrides({ ...overrides, [key]: value });
  };

  const handleReset = async () => {
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

  // Render a boolean toggle with override checkbox
  const renderBooleanField = (key: BooleanKeys, label: string, description: string) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isOverridden(key)}
          onCheckedChange={() => toggleOverride(key)}
        />
        <div className={`space-y-0.5 ${!isOverridden(key) ? 'opacity-50' : ''}`}>
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch
        checked={getValue(key) as boolean}
        disabled={!isOverridden(key)}
        onCheckedChange={(checked) => setValue(key, checked as StabilizationSettings[typeof key])}
      />
    </div>
  );

  // Render a boolean toggle with a number input alongside it
  const renderBooleanWithNumber = (
    boolKey: BooleanKeys,
    numKey: NumberKeys,
    label: string,
    description: string,
    numConfig: { min: number; max: number; step: number; fallback: number }
  ) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isOverridden(boolKey) || isOverridden(numKey)}
          onCheckedChange={() => {
            if (isOverridden(boolKey) || isOverridden(numKey)) {
              const next = { ...overrides };
              delete next[boolKey];
              delete next[numKey];
              setOverrides(next);
            } else {
              setOverrides({ ...overrides, [boolKey]: defaults[boolKey], [numKey]: defaults[numKey] });
            }
          }}
        />
        <div className={`space-y-0.5 ${!(isOverridden(boolKey) || isOverridden(numKey)) ? 'opacity-50' : ''}`}>
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
          value={getValue(numKey) as number}
          onChange={(e) => setValue(numKey, Math.max(numConfig.min, parseInt(e.target.value) || numConfig.fallback) as StabilizationSettings[typeof numKey])}
          className="w-20"
          disabled={!(isOverridden(boolKey) || isOverridden(numKey)) || !(getValue(boolKey) as boolean)}
        />
        <span className="text-xs text-muted-foreground">ms</span>
        <Switch
          checked={getValue(boolKey) as boolean}
          disabled={!(isOverridden(boolKey) || isOverridden(numKey))}
          onCheckedChange={(checked) => setValue(boolKey, checked as StabilizationSettings[typeof boolKey])}
        />
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
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{overrideCount} override{overrideCount !== 1 ? 's' : ''}</span>
            )}
            {isSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
          </CardTitle>
          {overrideCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset All
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Override repo-level stabilization settings for this test. Check a setting to override it.</p>
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
            {renderBooleanWithNumber('waitForNetworkIdle', 'networkIdleTimeout', 'Wait for Network Idle', 'Wait until no network requests', { min: 0, max: 30000, step: 1000, fallback: 5000 })}
            {renderBooleanWithNumber('waitForDomStable', 'domStableTimeout', 'Wait for DOM Stable', 'Wait until DOM mutations stop', { min: 0, max: 10000, step: 500, fallback: 2000 })}
            {renderBooleanField('waitForFonts', 'Wait for Fonts', 'Wait for web fonts to load')}
            {renderBooleanWithNumber('waitForImages', 'waitForImagesTimeout', 'Wait for Images', 'Wait for all images to finish loading', { min: 0, max: 30000, step: 1000, fallback: 5000 })}
          </CollapsibleContent>
        </Collapsible>

        {/* Content Freezing */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['freezeTimestamps', 'frozenTimestamp', 'freezeRandomValues', 'randomSeed', 'reseedRandomOnInput'].includes(k))}>
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
            {renderBooleanField('freezeTimestamps', 'Freeze Timestamps', 'Use a fixed Date.now() value')}
            {isOverridden('freezeTimestamps') && (getValue('freezeTimestamps') as boolean) && (
              <div className="flex items-center gap-2 pl-8">
                <Label className="text-xs">Fixed timestamp:</Label>
                <Input
                  type="text"
                  value={getValue('frozenTimestamp') as string}
                  onChange={(e) => setValue('frozenTimestamp', e.target.value as StabilizationSettings['frozenTimestamp'])}
                  className="flex-1"
                  placeholder="2024-01-01T12:00:00Z"
                />
              </div>
            )}
            {renderBooleanField('freezeRandomValues', 'Freeze Math.random()', 'Use seeded pseudo-random values')}
            {isOverridden('freezeRandomValues') && (getValue('freezeRandomValues') as boolean) && (
              <>
                <div className="flex items-center gap-2 pl-8">
                  <Label className="text-xs">Seed:</Label>
                  <Input
                    type="number"
                    value={getValue('randomSeed') as number}
                    onChange={(e) => setValue('randomSeed', (parseInt(e.target.value) || 12345) as StabilizationSettings['randomSeed'])}
                    className="w-24"
                  />
                </div>
                {renderBooleanField('reseedRandomOnInput', 'Reseed on Input Events', 'Reset RNG from event hash on user input')}
              </>
            )}
            {renderBooleanField('freezeAnimations', 'Freeze Animations', 'Freeze CSS animations/transitions')}
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
            {renderBooleanField('blockThirdParty', 'Block Third-Party Scripts', 'Block external domain requests')}
            {renderBooleanField('mockThirdPartyImages', 'Mock Third-Party Images', 'Replace with placeholders')}
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
            {renderBooleanField('hideLoadingIndicators', 'Hide Loading Spinners', 'CSS hide common loading indicators')}
            {renderBooleanField('crossOsConsistency', 'Cross-OS Consistency', 'Bundled font + Chromium flags for identical screenshots')}
            {renderBooleanField('disableWebfonts', 'Force System Fonts', 'Use system fonts only')}
            {renderBooleanField('roundCanvasCoordinates', 'Round Canvas Coordinates', 'Snap stroke coordinates to pixel centers')}
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
            {renderBooleanField('burstCapture', 'Enable Burst Capture', 'Take multiple screenshots to detect instability')}
            {isOverridden('burstCapture') && (getValue('burstCapture') as boolean) && (
              <>
                <div className="flex items-center justify-between pl-8">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isOverridden('burstFrameCount')}
                      onCheckedChange={() => toggleOverride('burstFrameCount')}
                    />
                    <Label className={`text-sm ${!isOverridden('burstFrameCount') ? 'opacity-50' : ''}`}>Frame Count</Label>
                  </div>
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={getValue('burstFrameCount') as number}
                    onChange={(e) => setValue('burstFrameCount', Math.max(2, Math.min(10, parseInt(e.target.value) || 3)) as StabilizationSettings['burstFrameCount'])}
                    className="w-20"
                    disabled={!isOverridden('burstFrameCount')}
                  />
                </div>
                <div className="flex items-center justify-between pl-8">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isOverridden('burstStabilityThreshold')}
                      onCheckedChange={() => toggleOverride('burstStabilityThreshold')}
                    />
                    <Label className={`text-sm ${!isOverridden('burstStabilityThreshold') ? 'opacity-50' : ''}`}>Stability Threshold</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={getValue('burstStabilityThreshold') as number}
                      onChange={(e) => setValue('burstStabilityThreshold', Math.max(0, Math.min(10, parseFloat(e.target.value) || 0.5)) as StabilizationSettings['burstStabilityThreshold'])}
                      className="w-20"
                      disabled={!isOverridden('burstStabilityThreshold')}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
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
            {renderBooleanField('autoMaskDynamicContent', 'Auto-Mask Dynamic Content', 'Detect and mask timestamps, UUIDs, etc.')}
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
            {renderBooleanField('waitForCanvasStable', 'Wait for Canvas Stable', 'Loop canvas comparisons until stable')}
            {isOverridden('waitForCanvasStable') && (getValue('waitForCanvasStable') as boolean) && (
              <>
                <div className="flex items-center justify-between pl-8">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isOverridden('canvasStableTimeout')}
                      onCheckedChange={() => toggleOverride('canvasStableTimeout')}
                    />
                    <Label className={`text-sm ${!isOverridden('canvasStableTimeout') ? 'opacity-50' : ''}`}>Timeout</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={30000}
                      step={1000}
                      value={getValue('canvasStableTimeout') as number}
                      onChange={(e) => setValue('canvasStableTimeout', Math.max(0, parseInt(e.target.value) || 3000) as StabilizationSettings['canvasStableTimeout'])}
                      className="w-20"
                      disabled={!isOverridden('canvasStableTimeout')}
                    />
                    <span className="text-xs text-muted-foreground">ms</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pl-8">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isOverridden('canvasStableThreshold')}
                      onCheckedChange={() => toggleOverride('canvasStableThreshold')}
                    />
                    <Label className={`text-sm ${!isOverridden('canvasStableThreshold') ? 'opacity-50' : ''}`}>Stable Checks</Label>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={getValue('canvasStableThreshold') as number}
                    onChange={(e) => setValue('canvasStableThreshold', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)) as StabilizationSettings['canvasStableThreshold'])}
                    className="w-20"
                    disabled={!isOverridden('canvasStableThreshold')}
                  />
                </div>
              </>
            )}
            {renderBooleanField('disableImageSmoothing', 'Disable Image Smoothing', 'Set imageSmoothingEnabled = false on 2D contexts')}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
