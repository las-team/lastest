'use client';

import { useState, useTransition } from 'react';
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
import type { SelectorConfig, PlaywrightSettings, HeadlessMode } from '@/lib/db/schema';
import { Loader2, RotateCcw, Save } from 'lucide-react';

interface PlaywrightSettingsCardProps {
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  compact?: boolean;
}

export function PlaywrightSettingsCard({
  settings,
  repositoryId,
  compact = false,
}: PlaywrightSettingsCardProps) {
  const [isPending, startTransition] = useTransition();
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

  const handleSave = () => {
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
      });
    });
  };

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
    });
  };

  const content = (
    <div className="space-y-6">
      {/* Selector Priority */}
      <SelectorPriorityList value={selectorPriority} onChange={setSelectorPriority} />

      {/* Cursor Movement Tracking */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Cursor Movement Tracking</Label>
            <p className="text-xs text-muted-foreground">
              Record mouse movements during test recording
            </p>
          </div>
          <Switch checked={pointerGestures} onCheckedChange={setPointerGestures} />
        </div>
        {pointerGestures && (
          <div className="flex items-center gap-2 pl-1">
            <Label htmlFor="cursorFPS" className="text-sm whitespace-nowrap">Capture FPS</Label>
            <Input
              id="cursorFPS"
              type="number"
              min={1}
              max={60}
              value={cursorFPS}
              onChange={(e) => setCursorFPS(Math.max(1, Math.min(60, parseInt(e.target.value) || 30)))}
              className="w-20"
            />
          </div>
        )}
      </div>

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

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Settings
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={isPending}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>
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
