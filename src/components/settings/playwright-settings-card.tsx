'use client';

import { useState, useTransition, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { SelectorPriorityList } from './selector-priority-list';
import { savePlaywrightSettings, resetPlaywrightSettings, getSelectorStatsAction } from '@/server/actions/settings';
import { listStorageStates, removeStorageState } from '@/server/actions/storage-states';
import { DEFAULT_SELECTOR_PRIORITY, DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import type { SelectorConfig, PlaywrightSettings, HeadlessMode, RecordingEngine, StabilizationSettings } from '@/lib/db/schema';
import { Loader2, RotateCcw, List, Video, MousePointer, Pause, Clock, Layers, ChevronDown, Shield, ShieldCheck, Hourglass, Ban, Eye, Camera, EyeOff, Info, ClipboardCopy, Download, Globe, Cookie, Trash2, Accessibility } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { calculateRecommendations } from '@/lib/selector-recommendations';
import type { SelectorTypeStats } from '@/lib/db/queries';

const VIEWPORT_PRESETS = [
  { label: 'Mobile S', width: 320, height: 568 },
  { label: 'Mobile M', width: 375, height: 667 },
  { label: 'Mobile L', width: 390, height: 844 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Laptop', width: 1024, height: 768 },
  { label: 'Desktop', width: 1280, height: 720 },
  { label: 'Large Desktop', width: 1440, height: 900 },
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: '2K', width: 2560, height: 1440 },
] as const;

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
  const [cursorPlaybackSpeed, setCursorPlaybackSpeed] = useState(settings.cursorPlaybackSpeed ?? 1);
  const [defaultRecordingEngine, setDefaultRecordingEngine] = useState<RecordingEngine>(
    (settings.defaultRecordingEngine as RecordingEngine) ?? 'lastest'
  );
  const [freezeAnimations, setFreezeAnimations] = useState(settings.freezeAnimations ?? false);
  const [enableVideoRecording, setEnableVideoRecording] = useState(settings.enableVideoRecording ?? false);
  const [enableA11y, setEnableA11y] = useState(settings.enableA11y ?? false);
  const [acceptAnyCertificate, setAcceptAnyCertificate] = useState(settings.acceptAnyCertificate ?? false);
  const [networkErrorMode, setNetworkErrorMode] = useState(settings.networkErrorMode ?? 'fail');
  const [ignoreExternalNetworkErrors, setIgnoreExternalNetworkErrors] = useState(settings.ignoreExternalNetworkErrors ?? false);
  const [consoleErrorMode, setConsoleErrorMode] = useState(settings.consoleErrorMode ?? 'fail');
  const [grantClipboardAccess, setGrantClipboardAccess] = useState(settings.grantClipboardAccess ?? false);
  const [acceptDownloads, setAcceptDownloads] = useState(settings.acceptDownloads ?? false);
  const [enableNetworkInterception, setEnableNetworkInterception] = useState(settings.enableNetworkInterception ?? false);
  const [lockViewportToRecording, setLockViewportToRecording] = useState(settings.lockViewportToRecording ?? false);
  const [screenshotDelay, setScreenshotDelay] = useState(settings.screenshotDelay ?? 0);
  const [maxParallelTests, setMaxParallelTests] = useState(settings.maxParallelTests ?? 1);
  const [stabilization, setStabilization] = useState<StabilizationSettings>(
    { ...DEFAULT_STABILIZATION_SETTINGS, ...settings.stabilization }
  );
  const [browsers, setBrowsers] = useState<string[]>(
    (settings as PlaywrightSettings & { browsers?: string[] }).browsers || ['chromium']
  );
  const [stabilizationOpen, setStabilizationOpen] = useState(false);
  const [selectorStats, setSelectorStats] = useState<SelectorTypeStats[]>([]);
  const [savedStorageStates, setSavedStorageStates] = useState<Array<{ id: string; name: string; cookieCount: number | null; originCount: number | null; createdAt: Date | null }>>([]);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Store original values to compare against (prevents save on mount)
  const originalValues = useRef({
    selectorPriority: settings.selectorPriority || DEFAULT_SELECTOR_PRIORITY,
    browser: settings.browser || 'chromium',
    viewportWidth: settings.viewportWidth || 1280,
    viewportHeight: settings.viewportHeight || 720,
    headlessMode: (settings.headlessMode as HeadlessMode) || 'true',
    navigationTimeout: settings.navigationTimeout || 30000,
    actionTimeout: settings.actionTimeout || 5000,
    pointerGestures: settings.pointerGestures ?? false,
    cursorFPS: settings.cursorFPS ?? 30,
    cursorPlaybackSpeed: settings.cursorPlaybackSpeed ?? 1,
    defaultRecordingEngine: (settings.defaultRecordingEngine as RecordingEngine) ?? 'lastest',
    freezeAnimations: settings.freezeAnimations ?? false,
    enableVideoRecording: settings.enableVideoRecording ?? false,
    enableA11y: settings.enableA11y ?? false,
    acceptAnyCertificate: settings.acceptAnyCertificate ?? false,
    networkErrorMode: settings.networkErrorMode ?? 'fail',
    ignoreExternalNetworkErrors: settings.ignoreExternalNetworkErrors ?? false,
    consoleErrorMode: settings.consoleErrorMode ?? 'fail',
    grantClipboardAccess: settings.grantClipboardAccess ?? false,
    acceptDownloads: settings.acceptDownloads ?? false,
    enableNetworkInterception: settings.enableNetworkInterception ?? false,
    lockViewportToRecording: settings.lockViewportToRecording ?? false,
    screenshotDelay: settings.screenshotDelay ?? 0,
    maxParallelTests: settings.maxParallelTests ?? 1,
    stabilization: { ...DEFAULT_STABILIZATION_SETTINGS, ...settings.stabilization },
    browsers: (settings as PlaywrightSettings & { browsers?: string[] }).browsers || ['chromium'],
  });

  // Sync local state when settings prop changes (e.g. after template apply)
  const settingsKey = `${settings.id}-${settings.updatedAt?.getTime?.() ?? 0}`;
  useEffect(() => {
    setSelectorPriority(settings.selectorPriority || DEFAULT_SELECTOR_PRIORITY);
    setBrowser(settings.browser || 'chromium');
    setViewportWidth(settings.viewportWidth || 1280);
    setViewportHeight(settings.viewportHeight || 720);
    setHeadlessMode((settings.headlessMode as HeadlessMode) || 'true');
    setNavigationTimeout(settings.navigationTimeout || 30000);
    setActionTimeout(settings.actionTimeout || 5000);
    setPointerGestures(settings.pointerGestures ?? false);
    setCursorFPS(settings.cursorFPS ?? 30);
    setCursorPlaybackSpeed(settings.cursorPlaybackSpeed ?? 1);
    setDefaultRecordingEngine((settings.defaultRecordingEngine as RecordingEngine) ?? 'lastest');
    setFreezeAnimations(settings.freezeAnimations ?? false);
    setEnableVideoRecording(settings.enableVideoRecording ?? false);
    setEnableA11y(settings.enableA11y ?? false);
    setAcceptAnyCertificate(settings.acceptAnyCertificate ?? false);
    setNetworkErrorMode(settings.networkErrorMode ?? 'fail');
    setIgnoreExternalNetworkErrors(settings.ignoreExternalNetworkErrors ?? false);
    setConsoleErrorMode(settings.consoleErrorMode ?? 'fail');
    setGrantClipboardAccess(settings.grantClipboardAccess ?? false);
    setAcceptDownloads(settings.acceptDownloads ?? false);
    setEnableNetworkInterception(settings.enableNetworkInterception ?? false);
    setLockViewportToRecording(settings.lockViewportToRecording ?? false);
    setScreenshotDelay(settings.screenshotDelay ?? 0);
    setMaxParallelTests(settings.maxParallelTests ?? 1);
    setStabilization({ ...DEFAULT_STABILIZATION_SETTINGS, ...settings.stabilization });
    setBrowsers((settings as PlaywrightSettings & { browsers?: string[] }).browsers || ['chromium']);

    originalValues.current = {
      selectorPriority: settings.selectorPriority || DEFAULT_SELECTOR_PRIORITY,
      browser: settings.browser || 'chromium',
      viewportWidth: settings.viewportWidth || 1280,
      viewportHeight: settings.viewportHeight || 720,
      headlessMode: (settings.headlessMode as HeadlessMode) || 'true',
      navigationTimeout: settings.navigationTimeout || 30000,
      actionTimeout: settings.actionTimeout || 5000,
      pointerGestures: settings.pointerGestures ?? false,
      cursorFPS: settings.cursorFPS ?? 30,
      cursorPlaybackSpeed: settings.cursorPlaybackSpeed ?? 1,
      defaultRecordingEngine: (settings.defaultRecordingEngine as RecordingEngine) ?? 'lastest',
      freezeAnimations: settings.freezeAnimations ?? false,
      enableVideoRecording: settings.enableVideoRecording ?? false,
      enableA11y: settings.enableA11y ?? false,
      acceptAnyCertificate: settings.acceptAnyCertificate ?? false,
      networkErrorMode: settings.networkErrorMode ?? 'fail',
      ignoreExternalNetworkErrors: settings.ignoreExternalNetworkErrors ?? false,
      consoleErrorMode: settings.consoleErrorMode ?? 'fail',
      grantClipboardAccess: settings.grantClipboardAccess ?? false,
      acceptDownloads: settings.acceptDownloads ?? false,
      enableNetworkInterception: settings.enableNetworkInterception ?? false,
      lockViewportToRecording: settings.lockViewportToRecording ?? false,
      screenshotDelay: settings.screenshotDelay ?? 0,
      maxParallelTests: settings.maxParallelTests ?? 1,
      stabilization: { ...DEFAULT_STABILIZATION_SETTINGS, ...settings.stabilization },
      browsers: (settings as PlaywrightSettings & { browsers?: string[] }).browsers || ['chromium'],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // Fetch selector stats for recommendations
  useEffect(() => {
    if (!repositoryId) return;

    getSelectorStatsAction(repositoryId).then(setSelectorStats).catch(console.error);
    listStorageStates(repositoryId).then(setSavedStorageStates).catch(console.error);
  }, [repositoryId]);

  // Calculate recommendations based on current priority and stats
  const recommendations = useMemo(() => {
    if (selectorStats.length === 0) return undefined;
    return calculateRecommendations(selectorPriority, selectorStats);
  }, [selectorPriority, selectorStats]);

  // Derive settings source for UX indicator
  const settingsSource = useMemo(() => {
    if (!repositoryId) return 'global' as const;
    if (settings.repositoryId === repositoryId) return 'repo-specific' as const;
    return 'global-fallback' as const;
  }, [repositoryId, settings.repositoryId]);

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
        cursorPlaybackSpeed,
        defaultRecordingEngine,
        freezeAnimations,
        enableVideoRecording,
        enableA11y,
        acceptAnyCertificate,
        networkErrorMode,
        ignoreExternalNetworkErrors,
        consoleErrorMode,
        grantClipboardAccess,
        acceptDownloads,
        enableNetworkInterception,
        lockViewportToRecording,
        screenshotDelay,
        maxParallelTests,
        stabilization,
        browsers,
      });
      if (compact) {
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 1500);
      } else {
        toast.success('Playwright settings saved');
      }
    });
  }, [repositoryId, selectorPriority, browser, viewportWidth, viewportHeight, headlessMode, navigationTimeout, actionTimeout, pointerGestures, cursorFPS, cursorPlaybackSpeed, defaultRecordingEngine, freezeAnimations, enableVideoRecording, enableA11y, acceptAnyCertificate, networkErrorMode, ignoreExternalNetworkErrors, consoleErrorMode, grantClipboardAccess, acceptDownloads, enableNetworkInterception, lockViewportToRecording, screenshotDelay, maxParallelTests, stabilization, browsers, compact]);

  // Auto-save with debounce - only when values differ from original props
  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges =
      JSON.stringify(selectorPriority) !== JSON.stringify(orig.selectorPriority) ||
      browser !== orig.browser ||
      viewportWidth !== orig.viewportWidth ||
      viewportHeight !== orig.viewportHeight ||
      headlessMode !== orig.headlessMode ||
      navigationTimeout !== orig.navigationTimeout ||
      actionTimeout !== orig.actionTimeout ||
      pointerGestures !== orig.pointerGestures ||
      cursorFPS !== orig.cursorFPS ||
      cursorPlaybackSpeed !== orig.cursorPlaybackSpeed ||
      defaultRecordingEngine !== orig.defaultRecordingEngine ||
      freezeAnimations !== orig.freezeAnimations ||
      enableVideoRecording !== orig.enableVideoRecording ||
      enableA11y !== orig.enableA11y ||
      acceptAnyCertificate !== orig.acceptAnyCertificate ||
      networkErrorMode !== orig.networkErrorMode ||
      ignoreExternalNetworkErrors !== orig.ignoreExternalNetworkErrors ||
      consoleErrorMode !== orig.consoleErrorMode ||
      grantClipboardAccess !== orig.grantClipboardAccess ||
      acceptDownloads !== orig.acceptDownloads ||
      enableNetworkInterception !== orig.enableNetworkInterception ||
      lockViewportToRecording !== orig.lockViewportToRecording ||
      screenshotDelay !== orig.screenshotDelay ||
      maxParallelTests !== orig.maxParallelTests ||
      JSON.stringify(stabilization) !== JSON.stringify(orig.stabilization) ||
      JSON.stringify(browsers) !== JSON.stringify(orig.browsers);

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
  }, [selectorPriority, browser, viewportWidth, viewportHeight, headlessMode, navigationTimeout, actionTimeout, pointerGestures, cursorFPS, cursorPlaybackSpeed, defaultRecordingEngine, freezeAnimations, enableVideoRecording, enableA11y, acceptAnyCertificate, networkErrorMode, ignoreExternalNetworkErrors, consoleErrorMode, grantClipboardAccess, acceptDownloads, enableNetworkInterception, lockViewportToRecording, screenshotDelay, maxParallelTests, stabilization, browsers, doSave]);

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
      setEnableVideoRecording(false);
      setEnableA11y(false);
      setGrantClipboardAccess(false);
      setAcceptDownloads(false);
      setEnableNetworkInterception(false);
      setLockViewportToRecording(false);
      setScreenshotDelay(0);
      setMaxParallelTests(1);
      setStabilization(DEFAULT_STABILIZATION_SETTINGS);
      setBrowsers(['chromium']);
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
        <SelectorPriorityList
          value={selectorPriority}
          onChange={setSelectorPriority}
          compact={compact}
          recommendations={recommendations}
        />
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
            <Label htmlFor="cursorPlaybackSpeed" className="text-xs whitespace-nowrap">Speed</Label>
            <Select value={String(cursorPlaybackSpeed)} onValueChange={(v) => setCursorPlaybackSpeed(Number(v))}>
              <SelectTrigger id="cursorPlaybackSpeed" className={compact ? 'w-20 h-7 text-sm' : 'w-24'}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="2">2x</SelectItem>
                <SelectItem value="5">5x</SelectItem>
                <SelectItem value="10">10x</SelectItem>
                <SelectItem value="0">Instant</SelectItem>
              </SelectContent>
            </Select>
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

        {/* Video Recording */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Video Recording</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Record test runs as WebM video for playback
                </p>
              )}
            </div>
          </div>
          <Switch checked={enableVideoRecording} onCheckedChange={setEnableVideoRecording} />
        </div>

        {/* Accessibility Checks */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Accessibility className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Accessibility Checks</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Run WCAG 2.2 AA compliance checks with axe-core
                </p>
              )}
            </div>
          </div>
          <Switch checked={enableA11y} onCheckedChange={setEnableA11y} />
        </div>

        {/* Accept Any Certificate */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Accept Any Certificate</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Ignore HTTPS/SSL certificate errors when testing external sites
                </p>
              )}
            </div>
          </div>
          <Switch checked={acceptAnyCertificate} onCheckedChange={setAcceptAnyCertificate} />
        </div>

        {/* Clipboard Access */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCopy className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Clipboard Access</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Grant clipboard read/write permissions for copy/paste tests
                </p>
              )}
            </div>
          </div>
          <Switch checked={grantClipboardAccess} onCheckedChange={setGrantClipboardAccess} />
        </div>

        {/* Accept Downloads */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Accept Downloads</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Allow file downloads during tests for export verification
                </p>
              )}
            </div>
          </div>
          <Switch checked={acceptDownloads} onCheckedChange={setAcceptDownloads} />
        </div>

        {/* Network Interception */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <div className="space-y-0.5">
              <Label className="text-sm">Network Interception</Label>
              {!compact && (
                <p className="text-xs text-muted-foreground">
                  Enable API mocking, request blocking, and network capture in tests
                </p>
              )}
            </div>
          </div>
          <Switch checked={enableNetworkInterception} onCheckedChange={setEnableNetworkInterception} />
        </div>

        {/* Error Handling */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm cursor-pointer">Error Handling</Label>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3 pl-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Network Error Mode</Label>
              <Select value={networkErrorMode} onValueChange={setNetworkErrorMode}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Fail test on HTTP 4xx/5xx</SelectItem>
                  <SelectItem value="warn">Warn only (log, don&apos;t fail)</SelectItem>
                  <SelectItem value="ignore">Ignore network errors</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Ignore External Network Errors</Label>
                <p className="text-xs text-muted-foreground">
                  Skip errors from domains other than the target URL
                </p>
              </div>
              <Switch checked={ignoreExternalNetworkErrors} onCheckedChange={setIgnoreExternalNetworkErrors} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Console Error Mode</Label>
              <Select value={consoleErrorMode} onValueChange={setConsoleErrorMode}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Fail test on console errors</SelectItem>
                  <SelectItem value="warn">Warn only (log, don&apos;t fail)</SelectItem>
                  <SelectItem value="ignore">Ignore console errors</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

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

      {/* Advanced Stabilization Settings */}
      {!compact && (
        <Collapsible open={stabilizationOpen} onOpenChange={setStabilizationOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Advanced Stabilization</span>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${stabilizationOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            {/* Wait Strategies */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <Hourglass className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Wait Strategies</Label>
              </div>

              {/* Network Idle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Wait for Network Idle</Label>
                  <p className="text-xs text-muted-foreground">Wait until no network requests for a period</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={30000}
                    step={1000}
                    value={stabilization.networkIdleTimeout}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      networkIdleTimeout: Math.max(0, parseInt(e.target.value) || 5000)
                    })}
                    className="w-20"
                    disabled={!stabilization.waitForNetworkIdle}
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                  <Switch
                    checked={stabilization.waitForNetworkIdle}
                    onCheckedChange={(checked) => setStabilization({
                      ...stabilization,
                      waitForNetworkIdle: checked
                    })}
                  />
                </div>
              </div>

              {/* DOM Stable */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Wait for DOM Stable</Label>
                  <p className="text-xs text-muted-foreground">Wait until DOM mutations stop</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={10000}
                    step={500}
                    value={stabilization.domStableTimeout}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      domStableTimeout: Math.max(0, parseInt(e.target.value) || 2000)
                    })}
                    className="w-20"
                    disabled={!stabilization.waitForDomStable}
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                  <Switch
                    checked={stabilization.waitForDomStable}
                    onCheckedChange={(checked) => setStabilization({
                      ...stabilization,
                      waitForDomStable: checked
                    })}
                  />
                </div>
              </div>

              {/* Wait for Fonts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Wait for Fonts</Label>
                  <p className="text-xs text-muted-foreground">Wait for web fonts to load</p>
                </div>
                <Switch
                  checked={stabilization.waitForFonts}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    waitForFonts: checked
                  })}
                />
              </div>

              {/* Wait for Images */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Wait for Images</Label>
                  <p className="text-xs text-muted-foreground">Wait for all images to finish loading</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={stabilization.waitForImagesTimeout}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      waitForImagesTimeout: Math.max(0, parseInt(e.target.value) || 5000)
                    })}
                    className="w-20"
                    disabled={!stabilization.waitForImages}
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                  <Switch
                    checked={stabilization.waitForImages}
                    onCheckedChange={(checked) => setStabilization({
                      ...stabilization,
                      waitForImages: checked
                    })}
                  />
                </div>
              </div>
            </div>

            {/* Content Freezing */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <Pause className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Content Freezing</Label>
              </div>

              {/* Freeze Timestamps */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Freeze Timestamps</Label>
                  <p className="text-xs text-muted-foreground">Use a fixed Date.now() value</p>
                </div>
                <Switch
                  checked={stabilization.freezeTimestamps}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    freezeTimestamps: checked
                  })}
                />
              </div>
              {stabilization.freezeTimestamps && (
                <div className="flex items-center gap-2 pl-4">
                  <Label className="text-xs">Fixed timestamp:</Label>
                  <Input
                    type="text"
                    value={stabilization.frozenTimestamp}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      frozenTimestamp: e.target.value
                    })}
                    className="flex-1"
                    placeholder="2024-01-01T12:00:00Z"
                  />
                </div>
              )}

              {/* Freeze Random */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Freeze Math.random()</Label>
                  <p className="text-xs text-muted-foreground">Use seeded pseudo-random values</p>
                </div>
                <Switch
                  checked={stabilization.freezeRandomValues}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    freezeRandomValues: checked
                  })}
                />
              </div>
              {stabilization.freezeRandomValues && (
                <div className="flex items-center gap-2 pl-4">
                  <Label className="text-xs">Seed:</Label>
                  <Input
                    type="number"
                    value={stabilization.randomSeed}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      randomSeed: parseInt(e.target.value) || 12345
                    })}
                    className="w-24"
                  />
                </div>
              )}
              {stabilization.freezeRandomValues && (
                <div className="flex items-center justify-between pl-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Reseed on Input Events</Label>
                    <p className="text-xs text-muted-foreground">Reset RNG from event hash on user input for deterministic element creation</p>
                  </div>
                  <Switch
                    checked={stabilization.reseedRandomOnInput ?? false}
                    onCheckedChange={(checked) => setStabilization({
                      ...stabilization,
                      reseedRandomOnInput: checked
                    })}
                  />
                </div>
              )}
            </div>

            {/* Third-Party Handling */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Third-Party Handling</Label>
              </div>

              {/* Block Third Party */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Block Third-Party Scripts</Label>
                  <p className="text-xs text-muted-foreground">Block external domain requests</p>
                </div>
                <Switch
                  checked={stabilization.blockThirdParty}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    blockThirdParty: checked
                  })}
                />
              </div>
              {stabilization.blockThirdParty && (
                <div className="space-y-2 pl-4">
                  <Label className="text-xs">Allowed domains (comma separated):</Label>
                  <Input
                    type="text"
                    value={stabilization.allowedDomains.join(', ')}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      allowedDomains: e.target.value.split(',').map(d => d.trim()).filter(Boolean)
                    })}
                    placeholder="analytics.example.com, cdn.example.com"
                  />
                </div>
              )}

              {/* Mock Images */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Mock Third-Party Images</Label>
                  <p className="text-xs text-muted-foreground">Replace with placeholders</p>
                </div>
                <Switch
                  checked={stabilization.mockThirdPartyImages}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    mockThirdPartyImages: checked
                  })}
                />
              </div>
            </div>

            {/* Loading Indicators */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Loading Indicators</Label>
              </div>

              {/* Hide Spinners */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Hide Loading Spinners</Label>
                  <p className="text-xs text-muted-foreground">CSS hide common loading indicators</p>
                </div>
                <Switch
                  checked={stabilization.hideLoadingIndicators}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    hideLoadingIndicators: checked
                  })}
                />
              </div>
              {stabilization.hideLoadingIndicators && (
                <div className="space-y-2 pl-4">
                  <Label className="text-xs">Custom selectors (comma separated):</Label>
                  <Input
                    type="text"
                    value={stabilization.loadingSelectors.join(', ')}
                    onChange={(e) => setStabilization({
                      ...stabilization,
                      loadingSelectors: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    placeholder=".my-custom-loader, #loading-overlay"
                  />
                </div>
              )}

              {/* Cross-OS Consistency */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Cross-OS Consistency</Label>
                  <p className="text-xs text-muted-foreground">Bundled font + Chromium flags for identical screenshots across macOS/Linux/Windows</p>
                </div>
                <Switch
                  checked={stabilization.crossOsConsistency ?? false}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    crossOsConsistency: checked
                  })}
                />
              </div>

              {/* Round Canvas Coordinates */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Round Canvas Coordinates</Label>
                  <p className="text-xs text-muted-foreground">Snap stroke coordinates to pixel centers for deterministic line rendering</p>
                </div>
                <Switch
                  checked={stabilization.roundCanvasCoordinates ?? false}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    roundCanvasCoordinates: checked
                  })}
                />
              </div>

              {/* Disable Webfonts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Force System Fonts</Label>
                  <p className="text-xs text-muted-foreground">Use system fonts only (prevents FOUC)</p>
                </div>
                <Switch
                  checked={stabilization.disableWebfonts}
                  disabled={stabilization.crossOsConsistency}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    disableWebfonts: checked
                  })}
                />
              </div>
            </div>

            {/* Burst Capture */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Burst Capture</Label>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Enable Burst Capture</Label>
                  <p className="text-xs text-muted-foreground">Take multiple screenshots to detect instability</p>
                </div>
                <Switch
                  checked={stabilization.burstCapture}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    burstCapture: checked
                  })}
                />
              </div>
              {stabilization.burstCapture && (
                <>
                  <div className="flex items-center justify-between pl-4">
                    <Label className="text-sm">Frame Count</Label>
                    <Input
                      type="number"
                      min={2}
                      max={10}
                      value={stabilization.burstFrameCount}
                      onChange={(e) => setStabilization({
                        ...stabilization,
                        burstFrameCount: Math.max(2, Math.min(10, parseInt(e.target.value) || 3))
                      })}
                      className="w-20"
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Stability Threshold</Label>
                      <p className="text-xs text-muted-foreground">% diff below which frames are stable</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={stabilization.burstStabilityThreshold}
                        onChange={(e) => setStabilization({
                          ...stabilization,
                          burstStabilityThreshold: Math.max(0, Math.min(10, parseFloat(e.target.value) || 0.5))
                        })}
                        className="w-20"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Dynamic Content Masking */}
            <div className="space-y-3 border-l-2 border-muted pl-4">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Dynamic Content Masking</Label>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Auto-Mask Dynamic Content</Label>
                  <p className="text-xs text-muted-foreground">Detect and mask timestamps, UUIDs, etc.</p>
                </div>
                <Switch
                  checked={stabilization.autoMaskDynamicContent}
                  onCheckedChange={(checked) => setStabilization({
                    ...stabilization,
                    autoMaskDynamicContent: checked
                  })}
                />
              </div>
              {stabilization.autoMaskDynamicContent && (
                <>
                  <div className="space-y-2 pl-4">
                    <Label className="text-xs">Mask Patterns</Label>
                    <div className="space-y-1">
                      {['timestamps', 'uuids', 'relative-times', 'session-ids'].map((pattern) => (
                        <div key={pattern} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`mask-${pattern}`}
                            checked={stabilization.maskPatterns.includes(pattern)}
                            onChange={(e) => {
                              const patterns = e.target.checked
                                ? [...stabilization.maskPatterns, pattern]
                                : stabilization.maskPatterns.filter(p => p !== pattern);
                              setStabilization({ ...stabilization, maskPatterns: patterns });
                            }}
                            className="rounded border-input"
                          />
                          <Label htmlFor={`mask-${pattern}`} className="text-xs">{pattern}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <Label className="text-sm">Mask Style</Label>
                    <Select
                      value={stabilization.maskStyle}
                      onValueChange={(v) => setStabilization({
                        ...stabilization,
                        maskStyle: v as 'solid-color' | 'placeholder-text'
                      })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="solid-color">Solid Color</SelectItem>
                        <SelectItem value="placeholder-text">Placeholder Text</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {stabilization.maskStyle === 'solid-color' && (
                    <div className="flex items-center gap-2 pl-4">
                      <Label className="text-xs">Mask Color:</Label>
                      <Input
                        type="color"
                        value={stabilization.maskColor}
                        onChange={(e) => setStabilization({
                          ...stabilization,
                          maskColor: e.target.value
                        })}
                        className="w-12 h-8 p-0.5"
                      />
                      <Input
                        type="text"
                        value={stabilization.maskColor}
                        onChange={(e) => setStabilization({
                          ...stabilization,
                          maskColor: e.target.value
                        })}
                        className="w-24"
                        placeholder="#808080"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Browser Settings */}
      {/* Viewport */}
      <div className="space-y-2">
        <Label>Viewport</Label>
        <Select
          value={VIEWPORT_PRESETS.find(p => p.width === viewportWidth && p.height === viewportHeight)?.label ?? 'custom'}
          onValueChange={(v) => {
            if (v === 'custom') return;
            const preset = VIEWPORT_PRESETS.find(p => p.label === v);
            if (preset) {
              setViewportWidth(preset.width);
              setViewportHeight(preset.height);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEWPORT_PRESETS.map((p) => (
              <SelectItem key={p.label} value={p.label}>
                {p.label} ({p.width}×{p.height})
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        {!compact && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={viewportWidth}
              onChange={(e) => setViewportWidth(parseInt(e.target.value) || 1280)}
              className="w-24"
            />
            <span className="text-muted-foreground">×</span>
            <Input
              type="number"
              value={viewportHeight}
              onChange={(e) => setViewportHeight(parseInt(e.target.value) || 720)}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">px</span>
          </div>
        )}
        {!compact && (
          <div className="flex items-center justify-between mt-2">
            <div>
              <span className="text-sm">Lock viewport to recording size</span>
              <p className="text-xs text-muted-foreground">Use the viewport from when the test was recorded. Recommended for canvas/coordinate-heavy tests.</p>
            </div>
            <Switch checked={lockViewportToRecording} onCheckedChange={setLockViewportToRecording} />
          </div>
        )}
      </div>

      {!compact && (
        <>
          {/* Build Browsers (multi-select) */}
          <div className="space-y-2">
            <Label>Build Browsers</Label>
            <p className="text-xs text-muted-foreground">
              Tests run once per selected browser. Each browser gets its own baselines.
            </p>
            <div className="flex gap-4">
              {(['chromium', 'firefox', 'webkit'] as const).map((b) => (
                <label key={b} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={browsers.includes(b)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setBrowsers(prev => [...prev, b]);
                      } else {
                        // Don't allow deselecting all browsers
                        setBrowsers(prev => prev.length > 1 ? prev.filter(x => x !== b) : prev);
                      }
                    }}
                  />
                  <span>{b === 'webkit' ? 'WebKit (Safari)' : b === 'firefox' ? 'Firefox' : 'Chromium'}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="browser">Recording Browser</Label>
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

      {/* Saved Auth States - hidden in compact mode */}
      {!compact && savedStorageStates.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm font-medium hover:text-primary transition-colors">
            <Cookie className="w-4 h-4" />
            Saved Auth States ({savedStorageStates.length})
            <ChevronDown className="w-4 h-4 ml-auto transition-transform data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {savedStorageStates.map(state => (
              <div key={state.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg border text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Cookie className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{state.name}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {state.cookieCount ?? 0} cookies
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={async () => {
                    await removeStorageState(state.id);
                    setSavedStorageStates(prev => prev.filter(s => s.id !== state.id));
                    toast.success('Auth state deleted');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
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
            {settingsSource === 'repo-specific' ? 'Reset to Global Defaults' : 'Reset to Defaults'}
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
        <div className="flex items-center gap-2">
          <CardTitle>Playwright Settings</CardTitle>
          {settingsSource === 'repo-specific' && (
            <Badge variant="default">Repo-specific</Badge>
          )}
          {settingsSource === 'global-fallback' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="flex items-center gap-1 cursor-help">
                  <Info className="w-3 h-3" />
                  Global defaults
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Changes will create repo-specific settings</TooltipContent>
            </Tooltip>
          )}
        </div>
        <CardDescription>
          Configure browser automation settings for recording and running tests
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
