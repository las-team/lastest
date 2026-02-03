'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SelectorPriorityList } from './selector-priority-list';
import { savePlaywrightSettings, resetPlaywrightSettings } from '@/server/actions/settings';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import type { SelectorConfig, PlaywrightSettings, HeadlessMode, RecordingEngine } from '@/lib/db/schema';
import { Loader2, RotateCcw, List, Video, MousePointer, Pause, Clock, Layers } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

interface PlaywrightSettingsCardProps {
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  compact?: boolean;
  onSaveStatusChange?: (status: { isPending: boolean; showSaved: boolean }) => void;
}

export function PlaywrightSettingsCard({
  settings,
  repositoryId,
  compact = false,
  onSaveStatusChange,
}: PlaywrightSettingsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [showSaved, setShowSaved] = useState(false);
  const [selectorPriority, setSelectorPriority] = useState<SelectorConfig[]>(
    settings.selectorPriority || DEFAULT_SELECTOR_PRIORITY
  );
  const [browser, setBrowser] = useState(settings.browser || 'chromium');
  const [viewportWidth, setViewportWidth] = useState(settings.viewportWidth || 1280);
  const [viewportHeight, setViewportHeight] = useState(settings.viewportHeight || 720);
  const [headlessMode, setHeadlessMode] = useState<HeadlessMode>(settings.headlessMode as HeadlessMode || 'true');
  const [navigationTimeout, setNavigationTimeout] = useState(settings.navigationTimeout || 30000);
  const [actionTimeout, setActionTimeout] = useState(settings.actionTimeout || 5000);
  const [pointerGestures, setPointerGestures] = useState(settings.pointerGestures ?? false);
  const [cursorFPS, setCursorFPS] = useState(settings.cursorFPS ?? 30);
  const [defaultRecordingEngine, setDefaultRecordingEngine] = useState<RecordingEngine>(
    (settings.defaultRecordingEngine as RecordingEngine) ?? 'lastest'
  );
  const [freezeAnimations, setFreezeAnimations] = useState(settings.freezeAnimations ?? false);
  const [screenshotDelay, setScreenshotDelay] = useState(settings.screenshotDelay ?? 0);
  const [maxParallelTests, setMaxParallelTests] = useState(settings.maxParallelTests ?? 1);

  // Track if initial mount to prevent auto-save on first render
  const isInitialMount = useRef(true);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const doSave = useCallback(() => {
    startTransition(async () => {
      await savePlaywrightSettings({
        repositoryId,
        selectorPriority,
        browser,
        viewportWidth,
        viewportHeight,
        headlessMode,
        navigationTimeout,
        actionTimeout,
        pointerGestures,
        cursorFPS,
        defaultRecordingEngine,
        freezeAnimations,
        screenshotDelay,
        maxParallelTests,
      });
      if (compact) {
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 1500);
      } else {
        toast.success('Playwright settings saved');
      }
    });
  }, [repositoryId, selectorPriority, browser, viewportWidth, viewportHeight, headlessMode, navigationTimeout, actionTimeout, pointerGestures, cursorFPS, defaultRecordingEngine, freezeAnimations, screenshotDelay, maxParallelTests, compact]);

  // Auto-save with debounce
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

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
  }, [selectorPriority, browser, viewportWidth, viewportHeight, headlessMode, navigationTimeout, actionTimeout, pointerGestures, cursorFPS, defaultRecordingEngine, freezeAnimations, screenshotDelay, maxParallelTests, doSave]);

  // Notify parent of save status changes
  useEffect(() => {
    onSaveStatusChange?.({ isPending, showSaved });
  }, [isPending, showSaved, onSaveStatusChange]);

  const handleReset = () => {
    startTransition(async () => {
      await resetPlaywrightSettings(repositoryId);
      setSelectorPriority(DEFAULT_SELECTOR_PRIORITY);
      setBrowser('chromium');
      setViewportWidth(1280);
      setViewportHeight(720);
      setHeadlessMode('true');
      setNavigationTimeout(30000);
      setActionTimeout(5000);
      setPointerGestures(false);
      setCursorFPS(30);
      setDefaultRecordingEngine('lastest');
      setFreezeAnimations(false);
      setScreenshotDelay(0);
      setMaxParallelTests(1);
      if (!compact) {
        toast.success('Playwright settings reset to defaults');
      }
    });
  };

  const content = (
    <div className={compact ? 'space-y-3' : 'space-y-6'}>
      {/* Selector Priority */}
      <div className={compact ? 'space-y-1' : 'space-y-2'}>
        <div className="flex items-center gap-2">
          <List className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Selector Priority</Label>
        </div>
        <SelectorPriorityList value={selectorPriority} onChange={setSelectorPriority} compact={compact} />
      </div>

      {/* Default Recording Engine - only in full mode */}
      {!compact && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            <Label htmlFor="defaultEngine" className="text-sm">Default Recording Engine</Label>
          </div>
          <Select value={defaultRecordingEngine} onValueChange={(v) => setDefaultRecordingEngine(v as RecordingEngine)}>
            <SelectTrigger id="defaultEngine" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastest">Lastest Recorder</SelectItem>
              <SelectItem value="playwright-inspector">Playwright Inspector</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Cursor Movement Tracking */}
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MousePointer className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Cursor Tracking</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Record mouse movements during test recording
                </p>
              )}
            </div>
          </div>
          <Switch checked={pointerGestures} onCheckedChange={setPointerGestures} />
        </div>
        {pointerGestures && (
          <div className="flex items-center gap-2 pl-6">
            <Label htmlFor="cursorFPS" className="text-xs whitespace-nowrap">FPS</Label>
            <Input
              id="cursorFPS"
              type="number"
              min={1}
              max={60}
              value={cursorFPS}
              onChange={(e) => setCursorFPS(Math.max(1, Math.min(60, parseInt(e.target.value) || 30)))}
              className={compact ? 'w-16 h-7 text-sm' : 'w-20'}
            />
          </div>
        )}
      </div>

      {/* Snapshot Stabilization */}
      <div className={compact ? 'space-y-2' : 'space-y-4'}>
        {!compact && <Label className="text-sm font-medium">Snapshot Stabilization</Label>}

        {/* Freeze Animations */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pause className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Freeze Animations</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Disable CSS animations and transitions before screenshots
                </p>
              )}
            </div>
          </div>
          <Switch checked={freezeAnimations} onCheckedChange={setFreezeAnimations} />
        </div>

        {/* Screenshot Delay */}
        <div className={compact ? 'flex items-center justify-between' : 'flex items-center gap-4'}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label htmlFor="screenshotDelay" className="text-sm">Screenshot Delay</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Wait before capturing screenshot for content to stabilize
                </p>
              )}
            </div>
          </div>
          <div className={compact ? 'flex items-center gap-1' : 'flex items-center gap-2 ml-auto'}>
            <Input
              id="screenshotDelay"
              type="number"
              min={0}
              max={5000}
              step={100}
              value={screenshotDelay}
              onChange={(e) => setScreenshotDelay(Math.max(0, parseInt(e.target.value) || 0))}
              className={compact ? 'w-16 h-7 text-sm' : 'w-24'}
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
        </div>
      </div>

      {/* Parallel Execution */}
      {!compact && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Parallel Tests (Local)</Label>
              <p className="text-xs text-muted-foreground">
                Number of tests to run simultaneously on local execution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              value={[maxParallelTests]}
              onValueChange={([value]) => setMaxParallelTests(value)}
              min={1}
              max={8}
              step={1}
              className="flex-1"
            />
            <span className="text-sm font-medium w-8 text-center">{maxParallelTests}</span>
          </div>
        </div>
      )}

      {/* Browser Settings */}
      {!compact && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="browser">Browser</Label>
              <Select value={browser} onValueChange={setBrowser}>
                <SelectTrigger id="browser">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">Chromium</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="webkit">WebKit (Safari)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headlessMode">Headless Mode</Label>
              <Select value={headlessMode} onValueChange={(v) => setHeadlessMode(v as HeadlessMode)}>
                <SelectTrigger id="headlessMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Headed (visible browser)</SelectItem>
                  <SelectItem value="true">Headless (standard)</SelectItem>
                  <SelectItem value="shell">Headless Shell (better bot avoidance)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Viewport */}
          <div className="space-y-2">
            <Label>Viewport</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={viewportWidth}
                onChange={(e) => setViewportWidth(parseInt(e.target.value) || 1280)}
                className="w-24"
              />
              <span className="text-muted-foreground">x</span>
              <Input
                type="number"
                value={viewportHeight}
                onChange={(e) => setViewportHeight(parseInt(e.target.value) || 720)}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">pixels</span>
            </div>
          </div>

          {/* Timeouts */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="navTimeout">Navigation Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="navTimeout"
                  type="number"
                  value={navigationTimeout}
                  onChange={(e) => setNavigationTimeout(parseInt(e.target.value) || 30000)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="actionTimeout">Action Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="actionTimeout"
                  type="number"
                  value={actionTimeout}
                  onChange={(e) => setActionTimeout(parseInt(e.target.value) || 5000)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Reset button - hidden in compact mode */}
      {!compact && (
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
      )}
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Playwright Settings</CardTitle>
        <CardDescription>
          Configure browser automation settings for recording and running tests
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
