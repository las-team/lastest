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
import { Globe, ChevronDown, RotateCcw, Timer, AlertTriangle, Settings, MousePointer } from 'lucide-react';
import { toast } from 'sonner';
import { saveTestPlaywrightOverrides, resetTestPlaywrightOverrides } from '@/server/actions/test-overrides';
import type { TestPlaywrightOverrides as TestPlaywrightOverridesType } from '@/lib/db/schema';

interface TestPlaywrightOverridesProps {
  testId: string;
  repositoryId: string | null;
  overrides: TestPlaywrightOverridesType | null;
  defaults: {
    browser: 'chromium' | 'firefox' | 'webkit';
    navigationTimeout: number;
    actionTimeout: number;
    screenshotDelay: number;
    networkErrorMode: 'fail' | 'warn' | 'ignore';
    consoleErrorMode: 'fail' | 'warn' | 'ignore';
    acceptAnyCertificate: boolean;
    maxParallelTests: number;
    baseUrl: string;
    cursorPlaybackSpeed: number;
  };
}

export function TestPlaywrightOverrides({ testId, repositoryId, overrides: initialOverrides, defaults }: TestPlaywrightOverridesProps) {
  const [overrides, setOverrides] = useState<TestPlaywrightOverridesType>(initialOverrides ?? {});
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(initialOverrides ?? {}));

  const getVal = <K extends keyof TestPlaywrightOverridesType>(key: K): NonNullable<TestPlaywrightOverridesType[K]> => {
    return (key in overrides ? overrides[key] : defaults[key as keyof typeof defaults]) as NonNullable<TestPlaywrightOverridesType[K]>;
  };

  const isOverridden = (key: keyof TestPlaywrightOverridesType) => key in overrides;

  const setVal = <K extends keyof TestPlaywrightOverridesType>(key: K, value: TestPlaywrightOverridesType[K]) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
  };

  const restoreKey = (...keys: (keyof TestPlaywrightOverridesType)[]) => {
    setOverrides(prev => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const doSave = useCallback(async (current: TestPlaywrightOverridesType) => {
    const serialized = JSON.stringify(current);
    if (serialized === lastSaved.current) return;
    setIsSaving(true);
    try {
      const toSave = Object.keys(current).length === 0 ? null : current;
      await saveTestPlaywrightOverrides(testId, repositoryId, toSave);
      lastSaved.current = serialized;
    } catch {
      toast.error('Failed to save playwright overrides');
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
      await resetTestPlaywrightOverrides(testId, repositoryId);
      toast.success('Playwright overrides reset');
    } catch {
      toast.error('Failed to reset overrides');
    }
  };

  const overrideCount = Object.keys(overrides).length;

  const OverrideIndicator = ({ keys }: { keys: (keyof TestPlaywrightOverridesType)[] }) => {
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Playwright Overrides
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
        <p className="text-xs text-muted-foreground">Per-test Playwright settings. Changed values override repo defaults and show a warning indicator.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Browser */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['browser'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Browser</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['browser']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Browser Engine</Label>
                  <p className="text-xs text-muted-foreground">Browser to use for test execution</p>
                </div>
              </div>
              <Select value={getVal('browser')} onValueChange={(value) => setVal('browser', value as 'chromium' | 'firefox' | 'webkit')}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">Chromium</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="webkit">WebKit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Timeouts */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['navigationTimeout', 'actionTimeout', 'screenshotDelay'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Timeouts</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            <div className="flex items-center justify-between pl-4">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['navigationTimeout']} />
                <Label className="text-sm">Navigation Timeout</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={120000}
                  step={1000}
                  value={getVal('navigationTimeout')}
                  onChange={(e) => setVal('navigationTimeout', Math.max(0, Math.min(120000, parseInt(e.target.value) || 0)))}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>
            <div className="flex items-center justify-between pl-4">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['actionTimeout']} />
                <Label className="text-sm">Action Timeout</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={120000}
                  step={1000}
                  value={getVal('actionTimeout')}
                  onChange={(e) => setVal('actionTimeout', Math.max(0, Math.min(120000, parseInt(e.target.value) || 0)))}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>
            <div className="flex items-center justify-between pl-4">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['screenshotDelay']} />
                <Label className="text-sm">Screenshot Delay</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  value={getVal('screenshotDelay')}
                  onChange={(e) => setVal('screenshotDelay', Math.max(0, Math.min(10000, parseInt(e.target.value) || 0)))}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Error Handling */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['networkErrorMode', 'consoleErrorMode'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Error Handling</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['networkErrorMode']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Network Error Mode</Label>
                  <p className="text-xs text-muted-foreground">How to handle network errors during tests</p>
                </div>
              </div>
              <Select value={getVal('networkErrorMode')} onValueChange={(value) => setVal('networkErrorMode', value as 'fail' | 'warn' | 'ignore')}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Fail</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="ignore">Ignore</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['consoleErrorMode']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Console Error Mode</Label>
                  <p className="text-xs text-muted-foreground">How to handle console errors during tests</p>
                </div>
              </div>
              <Select value={getVal('consoleErrorMode')} onValueChange={(value) => setVal('consoleErrorMode', value as 'fail' | 'warn' | 'ignore')}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Fail</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="ignore">Ignore</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Environment */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['acceptAnyCertificate', 'maxParallelTests', 'baseUrl'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Environment</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['acceptAnyCertificate']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Accept Any Certificate</Label>
                  <p className="text-xs text-muted-foreground">Ignore SSL/TLS certificate errors</p>
                </div>
              </div>
              <Switch
                checked={getVal('acceptAnyCertificate') as boolean}
                onCheckedChange={(checked) => setVal('acceptAnyCertificate', checked)}
              />
            </div>
            <div className="flex items-center justify-between pl-4">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['maxParallelTests']} />
                <Label className="text-sm">Max Parallel Tests</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={getVal('maxParallelTests')}
                  onChange={(e) => setVal('maxParallelTests', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="w-20"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['baseUrl']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Base URL</Label>
                  <p className="text-xs text-muted-foreground">Override the base URL for this test</p>
                </div>
              </div>
              <Input
                type="text"
                value={getVal('baseUrl')}
                onChange={(e) => setVal('baseUrl', e.target.value)}
                className="w-48"
                placeholder="https://example.com"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
        {/* Cursor Tracking */}
        <Collapsible defaultOpen={Object.keys(overrides).some(k => ['cursorPlaybackSpeed'].includes(k))}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <MousePointer className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Cursor Tracking</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 pl-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <OverrideIndicator keys={['cursorPlaybackSpeed']} />
                <div className="space-y-0.5">
                  <Label className="text-sm">Playback Speed</Label>
                  <p className="text-xs text-muted-foreground">Speed multiplier for cursor replay</p>
                </div>
              </div>
              <Select value={String(getVal('cursorPlaybackSpeed'))} onValueChange={(value) => setVal('cursorPlaybackSpeed', Number(value))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Instant</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="5">5x</SelectItem>
                  <SelectItem value="10">10x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
