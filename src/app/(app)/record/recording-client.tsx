'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  startRecording,
  stopRecording,
  captureScreenshot,
  createAssertion,
  createWait,
  flagDownload,
  insertTimestamp,
  togglePauseRecording,
  saveRecordedTest,
  updateRerecordedTest,
  getOrCreateFunctionalArea,
  getRecordingStatus,
  clearLastCompletedSession,
} from '@/server/actions/recording';
import { listStorageStates, saveStorageState } from '@/server/actions/storage-states';
import { runTests, getJobStatus } from '@/server/actions/runs';
import { deleteTest } from '@/server/actions/tests';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AssertionType, WaitParams, WaitType, WaitSelectorCondition } from '@/lib/playwright/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Timer, CalendarClock } from 'lucide-react';
import {
  Video,
  Square,
  Camera,
  Loader2,
  ExternalLink,
  Clock,
  Settings2,
  CheckCircle2,
  ChevronDown,
  ListFilter,
  AlertTriangle,
  Check,
  ShieldCheck,
  Play,
  Pause,
  Download,
  Maximize2,
  Minimize2,
  Cookie,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { FunctionalArea, PlaywrightSettings, RecordingEngine, Test } from '@/lib/db/schema';
import { DEFAULT_RECORDING_ENGINES } from '@/lib/db/schema';
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';
import { BrowserViewer } from '@/components/embedded-browser/browser-viewer-client';
import { toast } from 'sonner';
import { RecordingSetupPicker, type ExtraStep } from '@/components/setup/recording-setup-picker';
import { RecordingTutorialOverlay } from '@/components/recording-tutorial/recording-tutorial-overlay';
import { StepCard } from '@/components/recording/step-card';
import { TraceScrub } from '@/components/recording/trace-scrub';
import { TooltipProvider } from '@/components/ui/tooltip';

interface SetupStepInfo {
  id: string;
  stepType: 'test' | 'script';
  testId: string | null;
  scriptId: string | null;
  name: string;
}

type RecordingStep = 'setup' | 'recording' | 'saving';

interface RecordingClientProps {
  areas: FunctionalArea[];
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  defaultBaseUrl?: string;
  enabledEngines?: RecordingEngine[];
  defaultEngine?: RecordingEngine;
  rerecordTest?: Test | null;
  repositorySetupSteps?: SetupStepInfo[];
  availableTests?: { id: string; name: string }[];
  availableScripts?: { id: string; name: string }[];
  onStepChange?: (step: RecordingStep) => void;
}

// Check if an action event can be replayed by the runner
function isActionReplayable(event: RecordingEvent): { replayable: boolean; reason?: 'valid-selectors' | 'coords-only' | 'no-selectors' } {
  if (event.type !== 'action') {
    return { replayable: true }; // Non-action events are always replayable
  }

  const selectors = event.data.selectors || [];
  const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
  const hasCoords = event.data.coordinates !== undefined;

  if (validSelectors.length > 0) {
    return { replayable: true, reason: 'valid-selectors' };
  }

  if ((event.data.action === 'click' || event.data.action === 'rightclick') && hasCoords) {
    return { replayable: true, reason: 'coords-only' };
  }

  return { replayable: false, reason: 'no-selectors' };
}

function formatModifiers(modifiers?: KeyboardModifier[]): string {
  if (!modifiers || modifiers.length === 0) return '';
  return `[${modifiers.join('+')}] `;
}

function getEventDescription(event: RecordingEvent): string {
  const modPrefix = formatModifiers(event.data.modifiers);
  switch (event.type) {
    case 'navigation':
      return `Navigate to ${event.data.relativePath || event.data.url || 'page'}`;
    case 'action':
      if (event.data.action === 'click') {
        const dlSuffix = event.data.downloadWrap ? ' (download)' : '';
        return `${modPrefix}Click ${event.data.selector?.slice(0, 40) || 'element'}${dlSuffix}`;
      }
      if (event.data.action === 'rightclick') {
        const coords = event.data.coordinates;
        const target = event.data.selector?.slice(0, 40) || (coords ? `at (${coords.x}, ${coords.y})` : 'element');
        return `${modPrefix}Right-click ${target}`;
      }
      if (event.data.action === 'fill') {
        return `Fill ${event.data.selector?.slice(0, 30) || 'input'} with "${event.data.value?.slice(0, 20) || ''}"`;
      }
      if (event.data.action === 'selectOption') {
        return `Select "${event.data.value?.slice(0, 20) || ''}"`;
      }
      return event.data.action || 'action';
    case 'screenshot':
      return 'Screenshot captured';
    case 'assertion':
      // Handle element assertions from Shift+right-click
      if (event.data.elementAssertion) {
        const ea = event.data.elementAssertion;
        const assertLabel = ea.type.replace(/^to/, '').replace(/([A-Z])/g, ' $1').trim();
        const selectorHint = ea.selectors[0]?.value?.slice(0, 25) || 'element';
        return `Assert: ${assertLabel} on ${selectorHint}`;
      }
      // Page-level assertions
      const labels: Record<string, string> = {
        pageLoad: 'Page Load',
        networkIdle: 'Network Idle',
        urlMatch: 'URL Match',
        domContentLoaded: 'DOM Ready',
      };
      return `Assert: ${labels[event.data.assertionType || ''] || event.data.assertionType}`;
    case 'download':
      return 'Download expected';
    case 'insert-timestamp':
      return 'Insert timestamp';
    case 'mouse-down':
      return `${modPrefix}Mouse down at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case 'mouse-up':
      return `${modPrefix}Mouse up at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case 'hover-preview':
      const info = event.data.elementInfo;
      if (info) {
        // Enhanced hover preview: show tagName, id, text, and selector count
        const parts: string[] = [];
        parts.push(`<${info.tagName}>`);
        if (info.id) parts.push(`#${info.id}`);
        if (info.textContent) parts.push(`"${info.textContent.slice(0, 15)}${info.textContent.length > 15 ? '...' : ''}"`);
        const selectorCount = info.selectors?.length || 0;
        if (selectorCount > 0) parts.push(`(${selectorCount} sel)`);
        return `${info.potentialAction || 'interact'} → ${parts.join(' ')}`;
      }
      return 'Hovering...';
    case 'keypress':
      return `${modPrefix}Press "${event.data.key || 'key'}"`;
    case 'keydown':
      return `Hold "${event.data.key || 'key'}"`;
    case 'keyup':
      return `Release "${event.data.key || 'key'}"`;
    case 'wait': {
      if (event.data.waitType === 'duration') {
        return `Wait ${event.data.durationMs ?? 0}ms`;
      }
      const sel = event.data.selector || event.data.selectors?.[0]?.value || 'element';
      const cond = event.data.condition || 'visible';
      return `Wait for ${sel.slice(0, 30)} (${cond})`;
    }
    default:
      return event.type;
  }
}

interface WaitPopoverBodyProps {
  mode: WaitType;
  setMode: (m: WaitType) => void;
  durationMs: string;
  setDurationMs: (v: string) => void;
  selector: string;
  setSelector: (v: string) => void;
  condition: WaitSelectorCondition;
  setCondition: (c: WaitSelectorCondition) => void;
  timeoutMs: string;
  setTimeoutMs: (v: string) => void;
  onInsert: () => void;
}

function WaitPopoverBody({
  mode, setMode,
  durationMs, setDurationMs,
  selector, setSelector,
  condition, setCondition,
  timeoutMs, setTimeoutMs,
  onInsert,
}: WaitPopoverBodyProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Insert Wait</div>
        <div className="text-xs text-muted-foreground">
          Pause the test at this point — useful for slow async UIs.
        </div>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode('duration')}
          className={`px-2 py-1 rounded border ${mode === 'duration' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-border'}`}
        >
          Duration
        </button>
        <button
          type="button"
          onClick={() => setMode('selector')}
          className={`px-2 py-1 rounded border ${mode === 'selector' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-border'}`}
        >
          Wait for selector
        </button>
      </div>
      {mode === 'duration' ? (
        <div className="space-y-1">
          <label className="text-xs font-medium">Duration (ms)</label>
          <Input
            type="number"
            min={0}
            value={durationMs}
            onChange={e => setDurationMs(e.target.value)}
            placeholder="3000"
          />
          <div className="text-xs text-muted-foreground">
            e.g. <code>180000</code> = 3 minutes
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">Selector</label>
            <Input
              value={selector}
              onChange={e => setSelector(e.target.value)}
              placeholder="#status, .build-done, [data-state='ready']"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Condition</label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={condition}
                onChange={e => setCondition(e.target.value as WaitSelectorCondition)}
              >
                <option value="visible">visible</option>
                <option value="hidden">hidden</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Timeout (ms)</label>
              <Input
                type="number"
                min={0}
                value={timeoutMs}
                onChange={e => setTimeoutMs(e.target.value)}
                placeholder="30000"
              />
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={onInsert}>Insert</Button>
      </div>
    </div>
  );
}

interface ActionSelector {
  type: string;
  value: string;
}

interface SelectorMatch {
  type: string;
  value: string;
  count: number;
}

interface VerificationStatus {
  syntaxValid: boolean;
  domVerified?: boolean;
  lastChecked?: number;
  selectorMatches?: SelectorMatch[];
  chosenSelector?: string;
  autoRepaired?: boolean;
}

type KeyboardModifier = 'Alt' | 'Control' | 'Shift' | 'Meta';

interface RecordingEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: VerificationStatus;
  data: {
    action?: string;
    selector?: string;
    selectors?: ActionSelector[];
    value?: string;
    url?: string;
    relativePath?: string;
    screenshotPath?: string;
    /** data: URL for the post-action element thumbnail captured by the
     *  recorder. Populated late via verificationUpdates — may be undefined
     *  if the screenshot timed out or the user nav'd before it landed. */
    thumbnailPath?: string;
    assertionType?: string;
    elementAssertion?: {
      type: string;
      selectors: ActionSelector[];
      expectedValue?: string;
      attributeName?: string;
      attributeValue?: string;
    };
    coordinates?: { x: number; y: number };
    button?: number;
    actionId?: string;
    modifiers?: KeyboardModifier[];
    key?: string;
    deltaX?: number;
    deltaY?: number;
    downloadWrap?: boolean;
    autoDetected?: boolean;
    waitType?: WaitType;
    durationMs?: number;
    condition?: WaitSelectorCondition;
    timeoutMs?: number;
    elementInfo?: {
      tagName: string;
      id?: string;
      textContent?: string;
      potentialAction?: 'click' | 'fill' | 'select';
      potentialSelector?: string;
      selectors?: ActionSelector[];
    };
  };
}

export function RecordingClient({
  areas: initialAreas,
  settings,
  repositoryId,
  defaultBaseUrl,
  enabledEngines = DEFAULT_RECORDING_ENGINES,
  defaultEngine = 'lastest',
  rerecordTest,
  repositorySetupSteps = [],
  availableTests = [],
  availableScripts = [],
  onStepChange,
}: RecordingClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<RecordingStep>('setup');
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);
  const [selectedEngine, setSelectedEngine] = useState<RecordingEngine>(defaultEngine);
  const [runSetupBeforeRecording, setRunSetupBeforeRecording] = useState(true);
  const [extraSetupSteps, setExtraSetupSteps] = useState<ExtraStep[]>([]);
  const [skippedDefaultStepIds, setSkippedDefaultStepIds] = useState<Set<string>>(new Set());
  const [selectedStorageStateId, setSelectedStorageStateId] = useState<string | null>(null);
  const [storageStateOptions, setStorageStateOptions] = useState<Array<{ id: string; name: string; cookieCount: number; originCount: number }>>([]);
  const [capturedStorageState, setCapturedStorageState] = useState<string | null>(null);
  const [domSnapshot, setDomSnapshot] = useState<import('@/lib/db/schema').DomSnapshotData | null>(null);
  const [saveCookieName, setSaveCookieName] = useState('');

  // Re-record mode
  const isRerecording = !!rerecordTest;

  // Load saved storage states
  useEffect(() => {
    async function loadStorageStates() {
      const states = await listStorageStates(repositoryId ?? null);
      setStorageStateOptions(states.map(s => ({ id: s.id, name: s.name, cookieCount: s.cookieCount ?? 0, originCount: s.originCount ?? 0 })));
    }
    loadStorageStates();
  }, [repositoryId]);

  // Setup form state - pre-fill from rerecordTest if available
  const [url, setUrl] = useState(rerecordTest?.targetUrl || defaultBaseUrl || 'https://');
  const [testName, setTestName] = useState(rerecordTest?.name || '');
  const [areaId, setAreaId] = useState<string>(rerecordTest?.functionalAreaId || '');
  const [newAreaName, setNewAreaName] = useState('');
  const [areas, setAreas] = useState(initialAreas);

  // Recording state
  const [_sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [requiredCapabilities, setRequiredCapabilities] = useState<{ fileUpload?: boolean; clipboard?: boolean; networkInterception?: boolean; downloads?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSequenceRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState({ isPending: false, showSaved: false });
  const [embeddedStreamUrl, setEmbeddedStreamUrl] = useState<string | null>(null);
  const [savedTestId, setSavedTestId] = useState<string | null>(null);
  const [autoPlayStatus, setAutoPlayStatus] = useState<'idle' | 'saving' | 'playing' | 'finished' | 'error'>('idle');
  const [playbackStreamUrl, setPlaybackStreamUrl] = useState<string | null>(null);
  const [playbackJobId, setPlaybackJobId] = useState<string | null>(null);
  const [playbackFrameSize, setPlaybackFrameSize] = useState<{ width: number; height: number } | null>(null);
  const autoTriggeredRef = useRef(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [isRecordingFullscreen, setIsRecordingFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const recordingLayoutRef = useRef<HTMLDivElement>(null);

  // Optimistic update for selector promotion from a step card. The runner
  // round-trip will re-emit the event with the same selector chosen, so
  // this just shortens the perceived gap until the timeline reflects it.
  const handlePromoteOptimistic = useCallback((actionId: string, selectorValue: string) => {
    setEvents(prev => {
      const updated = [...prev];
      const event = updated.find(e => e.data.actionId === actionId);
      if (!event) return prev;
      event.verification = {
        ...(event.verification ?? { syntaxValid: true }),
        chosenSelector: selectorValue,
        autoRepaired: true,
      };
      return updated;
    });
  }, []);

  // Insert-Wait popover state
  const [waitPopoverOpen, setWaitPopoverOpen] = useState(false);
  const [waitMode, setWaitMode] = useState<WaitType>('duration');
  const [waitDurationMs, setWaitDurationMs] = useState<string>('3000');
  const [waitSelector, setWaitSelector] = useState<string>('');
  const [waitCondition, setWaitCondition] = useState<WaitSelectorCondition>('visible');
  const [waitTimeoutMs, setWaitTimeoutMs] = useState<string>('30000');

  // Poll for recording status and events when in recording step
  useEffect(() => {
    if (step !== 'recording') return;

    // Guard against overlapping polls. setInterval fires on a fixed clock —
    // when getRecordingStatus takes longer than the interval (DB busy,
    // large event payloads, etc.) callbacks pile up and React batches the
    // resulting setEvents(prev => […, …event]) calls, causing the same
    // sequence to be appended multiple times. Symptom: 6× duplicated rows
    // for a single click. Skip the tick when one is already in flight; the
    // next tick will pick up any new state.
    let pollInFlight = false;

    const pollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const status = await getRecordingStatus(repositoryId, lastSequenceRef.current);

        // If recording stopped (browser was closed), check for completed session
        if (!status.isRecording) {
          if (status.lastCompletedSession) {
            setGeneratedCode(status.lastCompletedSession.generatedCode);
            setRequiredCapabilities((status.lastCompletedSession as Record<string, unknown>).requiredCapabilities as typeof requiredCapabilities ?? null);
            setCapturedStorageState((status as Record<string, unknown>).capturedStorageState as string ?? null);
            setDomSnapshot((status.lastCompletedSession as Record<string, unknown>).domSnapshot as typeof domSnapshot ?? null);
            await clearLastCompletedSession(repositoryId);
            setStep('saving');
          } else if (status.errorMessage) {
            // Recording start failed (e.g. setup step threw on the EB) — surface
            // the error and unblock the UI instead of spinning forever.
            setStep('setup');
            setError(`Recording failed: ${status.errorMessage}`);
            await clearLastCompletedSession(repositoryId);
          } else {
            // Recording was stopped but no session - go back to setup
            setStep('setup');
            setError('Recording was stopped unexpectedly');
          }
          clearInterval(pollInterval);
          return;
        }

        // Sync pause state
        if ((status as Record<string, unknown>).isPaused !== undefined) {
          setIsPaused((status as Record<string, unknown>).isPaused as boolean);
        }

        // Apply late updates (verification settled, autorepair fired,
        // thumbnail came back) to events the timeline has already rendered.
        // Widened from the prior verified-only signal so the selector pill
        // and element thumbnail can refresh without a full re-fetch.
        if (status.verificationUpdates && status.verificationUpdates.length > 0) {
          setEvents(prev => {
            const updated = [...prev];
            for (const update of status.verificationUpdates) {
              const event = updated.find(e => e.data.actionId === update.actionId);
              if (!event) continue;
              event.verification = {
                ...(event.verification ?? { syntaxValid: true }),
                domVerified: update.verified,
                lastChecked: Date.now(),
                ...(update.selectorMatches !== undefined ? { selectorMatches: update.selectorMatches } : {}),
                ...(update.chosenSelector !== undefined ? { chosenSelector: update.chosenSelector } : {}),
                ...(update.autoRepaired !== undefined ? { autoRepaired: update.autoRepaired } : {}),
              };
              if (update.thumbnailPath !== undefined) {
                event.data = { ...event.data, thumbnailPath: update.thumbnailPath };
              }
            }
            return updated;
          });
        }

        // Process new events. Re-emissions (verification settled,
        // thumbnail attached) reuse their original sequence — replace in
        // place rather than append so timing races (overlapping polls,
        // out-of-order responses) can't grow the timeline unboundedly.
        if (status.events.length > 0) {
          setEvents(prev => {
            const newEvents = [...prev];
            for (const event of status.events) {
              if (event.type === 'cursor-move') continue;

              // hover-preview events get fresh sequences each time but the
              // recorder always replaces the previous preview rather than
              // accumulating — keep that splice-by-type semantic.
              if (event.type === 'hover-preview') {
                const lastIdx = newEvents.findLastIndex(e => e.type === 'hover-preview');
                if (lastIdx !== -1) newEvents.splice(lastIdx, 1);
                newEvents.push(event);
                continue;
              }

              const existingIdx = newEvents.findIndex(e => e.sequence === event.sequence);
              if (existingIdx >= 0) {
                newEvents[existingIdx] = event;
              } else {
                newEvents.push(event);
              }
            }
            return newEvents;
          });
          lastSequenceRef.current = status.lastSequence;

          // Auto-scroll timeline
          setTimeout(() => {
            timelineRef.current?.scrollTo({
              top: timelineRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }, 50);
        }
      } catch (err) {
        console.error('Failed to poll recording status:', err);
      } finally {
        pollInFlight = false;
      }
    }, 150); // 150 ms keeps perceived row-appearance latency under the
            // Doherty 400 ms responsiveness threshold (paired with the
            // 150 ms recorder batch flush on the runner/EB side).

    return () => clearInterval(pollInterval);
  }, [step, repositoryId]);

  const handleStartRecording = async () => {
    if (!url || !testName) return;

    setIsLoading(true);
    setError(null);

    try {
      // Create functional area if needed
      if (newAreaName && !areaId) {
        const area = await getOrCreateFunctionalArea(newAreaName);
        setAreas([...areas, {
          ...area,
          description: area.description ?? null,
          repositoryId: area.repositoryId ?? null,
          parentId: area.parentId ?? null,
          isRouteFolder: area.isRouteFolder ?? null,
          orderIndex: area.orderIndex ?? null,
          agentPlan: area.agentPlan ?? null,
          planGeneratedAt: area.planGeneratedAt ?? null,
          planSnapshot: area.planSnapshot ?? null,
          deletedAt: area.deletedAt ?? null,
        }]);
        setAreaId(area.id);
      }

      {
        // Start recorder with optional setup
        const activeDefaults = repositorySetupSteps.filter(s => !skippedDefaultStepIds.has(s.id));
        const allSteps = [
          ...activeDefaults.map(s => ({ stepType: s.stepType, testId: s.testId, scriptId: s.scriptId })),
          ...extraSetupSteps.map(s => ({ stepType: s.stepType, testId: s.testId ?? null, scriptId: s.scriptId ?? null })),
        ];
        const setupOptions = runSetupBeforeRecording && allSteps.length > 0
          ? { steps: allSteps }
          : undefined;

        const result = await startRecording(url, repositoryId, 'auto', setupOptions, selectedStorageStateId ?? undefined);

        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.sessionId) {
          setSessionId(result.sessionId);
          setStep('recording');
          setEvents([]);
          lastSequenceRef.current = 0;

          // Stale URL from a prior attempt would keep the BrowserViewer
          // reconnecting to the old target until the poll below resolves.
          setEmbeddedStreamUrl(null);

          // Fetch embedded stream URL if recording via an embedded runner.
          // A freshly-provisioned EB may not have completed auto-register
          // by the time startRecording returns, so poll briefly until the
          // session shows up with a streamUrl rather than failing silently.
          const resolvedTarget = result.resolvedRunnerId;
          if (resolvedTarget) {
            (async () => {
              for (let attempt = 0; attempt < 10; attempt++) {
                try {
                  const res = await fetch(`/api/embedded/stream`);
                  if (res.ok) {
                    const data = await res.json();
                    const session = data?.sessions?.find((s: { runnerId: string }) => s.runnerId === resolvedTarget);
                    if (session?.streamUrl) {
                      const token = data.streamAuthToken;
                      setEmbeddedStreamUrl(
                        token ? `${session.streamUrl}?token=${encodeURIComponent(token)}` : session.streamUrl
                      );
                      return;
                    }
                  }
                } catch {
                  // ignore transient fetch errors and retry
                }
                await new Promise(r => setTimeout(r, 500));
              }
            })();
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCaptureScreenshot = async () => {
    try {
      const { screenshotPath } = await captureScreenshot(repositoryId);
      if (screenshotPath) {
        setScreenshots([...screenshots, screenshotPath]);
        // Event will come through polling
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    }
  };

  const handleCreateAssertion = async (type: AssertionType) => {
    try {
      await createAssertion(type, repositoryId);
      // Event will come through polling
    } catch (error) {
      console.error('Failed to create assertion:', error);
    }
  };

  const handleFlagDownload = async () => {
    try {
      await flagDownload(repositoryId);
      // Event will come through polling
    } catch (error) {
      console.error('Failed to flag download:', error);
    }
  };

  const handleInsertTimestamp = async () => {
    try {
      await insertTimestamp(repositoryId);
    } catch (error) {
      console.error('Failed to insert timestamp:', error);
    }
  };

  const handleInsertWait = async () => {
    const params: WaitParams = waitMode === 'duration'
      ? { waitType: 'duration', durationMs: Number(waitDurationMs) }
      : {
          waitType: 'selector',
          selector: waitSelector.trim(),
          condition: waitCondition,
          timeoutMs: Number(waitTimeoutMs),
        };

    if (params.waitType === 'duration' && (!Number.isFinite(params.durationMs) || (params.durationMs ?? -1) < 0)) {
      toast.error('Duration must be a non-negative number of milliseconds');
      return;
    }
    if (params.waitType === 'selector' && !params.selector) {
      toast.error('Selector is required');
      return;
    }
    if (params.waitType === 'selector' && (!Number.isFinite(params.timeoutMs) || (params.timeoutMs ?? -1) < 0)) {
      toast.error('Timeout must be a non-negative number of milliseconds');
      return;
    }

    try {
      const result = await createWait(params, repositoryId);
      if (!result.success) {
        toast.error(result.error || 'Failed to insert wait');
        return;
      }
      setWaitPopoverOpen(false);
    } catch (error) {
      console.error('Failed to insert wait:', error);
      toast.error('Failed to insert wait');
    }
  };

  const handleTogglePause = async () => {
    try {
      const result = await togglePauseRecording(repositoryId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setIsPaused(result.paused);
    } catch (error) {
      console.error('Failed to toggle pause:', error);
    }
  };

  const handleStopRecording = async () => {
    setIsLoading(true);
    // Exit fullscreen before unmounting the recording layout to avoid lingering backdrop
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }
    setEmbeddedStreamUrl(null);
    try {
      const session = await stopRecording(repositoryId);
      if (session) {
        setGeneratedCode(session.generatedCode);
        setRequiredCapabilities(session.requiredCapabilities ?? null);
        setCapturedStorageState(session.capturedStorageState ?? null);
        setDomSnapshot(session.domSnapshot ?? null);
        setStep('saving');
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRecordingFullscreen = useCallback(() => {
    if (!recordingLayoutRef.current) return;
    try {
      if (!isRecordingFullscreen) {
        recordingLayoutRef.current.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    } catch {
      setIsRecordingFullscreen(false);
    }
  }, [isRecordingFullscreen]);

  // Sync fullscreen state with browser API
  useEffect(() => {
    const handler = () => setIsRecordingFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const persistRecording = async (): Promise<string | null> => {
    if (isRerecording && rerecordTest) {
      await updateRerecordedTest({
        testId: rerecordTest.id,
        code: generatedCode,
        targetUrl: url,
        viewportWidth: settings.viewportWidth ?? 1280,
        viewportHeight: settings.viewportHeight ?? 720,
      });
      return rerecordTest.id;
    }
    const test = await saveRecordedTest({
      name: testName,
      functionalAreaId: areaId || null,
      targetUrl: url,
      code: generatedCode,
      repositoryId,
      requiredCapabilities,
      viewportWidth: settings.viewportWidth ?? 1280,
      viewportHeight: settings.viewportHeight ?? 720,
      extraSetupSteps: runSetupBeforeRecording && extraSetupSteps.length > 0 ? extraSetupSteps : undefined,
      skippedDefaultStepIds: runSetupBeforeRecording && skippedDefaultStepIds.size > 0 ? Array.from(skippedDefaultStepIds) : undefined,
      domSnapshot,
    });
    return test.id;
  };

  const handleSaveTest = async () => {
    setIsLoading(true);
    try {
      const id = await persistRecording();
      if (id) {
        setSavedTestId(id);
        router.push(`/tests?test=${encodeURIComponent(id)}`);
      }
    } catch (error) {
      console.error('Failed to save test:', error);
      toast.error('Failed to save test');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-save the recording and immediately fire a headed 2x replay so the
  // user can watch the test play back while reviewing the generated code.
  // Triggered whether the user clicked Stop or the EB session ended on its own.
  useEffect(() => {
    if (step !== 'saving') return;
    if (autoTriggeredRef.current) return;
    if (!generatedCode) return;
    autoTriggeredRef.current = true;

    (async () => {
      setAutoPlayStatus('saving');
      let id: string | null = null;
      try {
        id = await persistRecording();
      } catch (err) {
        console.error('Auto-save after recording failed:', err);
        toast.error('Could not save the recorded test — try Save Test below.');
        setAutoPlayStatus('error');
        autoTriggeredRef.current = false;
        return;
      }
      if (!id) {
        setAutoPlayStatus('error');
        autoTriggeredRef.current = false;
        return;
      }
      setSavedTestId(id);
      setAutoPlayStatus('playing');
      try {
        const result = await runTests([id], repositoryId, /*headless*/ false, 'auto', undefined, /*cursorPlaybackSpeedOverride*/ 2);
        if (result?.jobId) setPlaybackJobId(result.jobId);
        toast.success('Recording saved · headed 2x replay started');
      } catch (err) {
        console.error('Auto-replay after recording failed:', err);
        toast.error('Saved, but the headed replay could not start');
        setAutoPlayStatus('error');
      }
    })();
    // generatedCode is the trigger payload; the rest are stable inputs into persistRecording
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, generatedCode]);

  // While the playback run is in flight, find the EB session the executor
  // claimed and wire its stream URL into the BrowserViewer below the code.
  // Mirrors the recorder's approach (line ~597) — poll the same shared endpoint.
  useEffect(() => {
    if (!playbackJobId) return;
    if (playbackStreamUrl) return;
    let cancelled = false;
    let runnerId: string | undefined;

    (async () => {
      // Step 1: wait for the executor to claim a runner.
      for (let attempt = 0; attempt < 60 && !cancelled; attempt++) {
        try {
          const status = await getJobStatus(playbackJobId);
          if (status.actualRunnerId) {
            runnerId = status.actualRunnerId;
            break;
          }
          if (status.isComplete) return;
        } catch {
          // keep polling
        }
        await new Promise(r => setTimeout(r, 500));
      }
      if (!runnerId || cancelled) return;

      // Step 2: wait for the EB session to register and surface a streamUrl.
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        try {
          const res = await fetch('/api/embedded/stream');
          if (res.ok) {
            const data = await res.json();
            const session = data?.sessions?.find((s: { runnerId: string }) => s.runnerId === runnerId);
            if (session?.streamUrl) {
              const token = data.streamAuthToken;
              setPlaybackStreamUrl(
                token ? `${session.streamUrl}?token=${encodeURIComponent(token)}` : session.streamUrl
              );
              return;
            }
          }
        } catch {
          // keep polling
        }
        await new Promise(r => setTimeout(r, 500));
      }
    })();

    return () => { cancelled = true; };
  }, [playbackJobId, playbackStreamUrl]);

  // When the playback job finishes, flip status and tear down the stream so the
  // BrowserViewer doesn't keep hammering a torn-down EB.
  useEffect(() => {
    if (!playbackJobId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await getJobStatus(playbackJobId);
        if (cancelled) return;
        if (status.isComplete) {
          clearInterval(interval);
          setPlaybackStreamUrl(null);
          setPlaybackFrameSize(null);
          setAutoPlayStatus(status.status === 'failed' ? 'error' : 'finished');
        }
      } catch {
        // keep polling
      }
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [playbackJobId]);

  if (step === 'setup') {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Column - Form */}
            <Card>
              <CardHeader>
                <CardTitle>{isRerecording ? 'Re-record Test' : 'New Recording'}</CardTitle>
                <CardDescription>
                  {isRerecording
                    ? `Re-recording "${rerecordTest?.name}" - new code will replace current version`
                    : 'Configure your test and start recording browser interactions'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* URL Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target URL</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => window.open(url, '_blank')}
                      disabled={!url.startsWith('http')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Test Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Test Name</label>
                  <Input
                    placeholder="login-success"
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    disabled={isRerecording}
                  />
                  {isRerecording && (
                    <p className="text-xs text-muted-foreground">
                      Test name cannot be changed when re-recording
                    </p>
                  )}
                </div>

                {/* Functional Area - hidden when re-recording */}
                {!isRerecording && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Functional Area</label>
                    <div className="flex gap-2">
                      <Select value={areaId} onValueChange={setAreaId}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select or create new" />
                        </SelectTrigger>
                        <SelectContent>
                          {areas.map((area) => (
                            <SelectItem key={area.id} value={area.id}>
                              {area.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground self-center">or</span>
                      <Input
                        placeholder="New area name"
                        value={newAreaName}
                        onChange={(e) => {
                          setNewAreaName(e.target.value);
                          setAreaId('');
                        }}
                        className="flex-1"
                      />
                    </div>
                  </div>
                )}

                {/* Recording Engine */}
                {enabledEngines.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Recording Engine</label>
                    <Select value={selectedEngine} onValueChange={(v) => setSelectedEngine(v as RecordingEngine)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {enabledEngines.includes('lastest') && (
                          <SelectItem value="lastest">Lastest Recorder</SelectItem>
                        )}
                        {enabledEngines.includes('playwright-inspector') && (
                          <SelectItem value="playwright-inspector">Playwright Inspector</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {selectedEngine === 'lastest'
                        ? 'Multi-selector recording with real-time preview'
                        : 'Official Playwright codegen tool'}
                    </p>
                  </div>
                )}

                {/* Seed Toggle */}
                {(() => {
                  const hasDefaults = repositorySetupSteps.length > 0;
                  const activeDefaultCount = repositorySetupSteps.filter(s => !skippedDefaultStepIds.has(s.id)).length;
                  const totalSteps = activeDefaultCount + extraSetupSteps.length;
                  const stepSummary = totalSteps > 0
                    ? `${totalSteps} setup step${totalSteps !== 1 ? 's' : ''}${skippedDefaultStepIds.size > 0 ? ` (${skippedDefaultStepIds.size} skipped)` : ''}`
                    : 'All steps disabled';

                  return (
                    <div className="bg-muted/30 rounded-lg border">
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <Play className="h-4 w-4 text-muted-foreground" />
                          <div className="space-y-0.5">
                            <Label htmlFor="run-setup" className="text-sm font-medium cursor-pointer">
                              Run Seed
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {runSetupBeforeRecording ? stepSummary : hasDefaults ? `${repositorySetupSteps.length} default step${repositorySetupSteps.length !== 1 ? 's' : ''} configured` : 'No setup configured'}
                            </p>
                          </div>
                        </div>
                        <Switch
                          id="run-setup"
                          checked={runSetupBeforeRecording}
                          onCheckedChange={setRunSetupBeforeRecording}
                          disabled={isLoading}
                        />
                      </div>
                      {runSetupBeforeRecording && (
                        <div className="border-t px-3 pb-3">
                          <RecordingSetupPicker
                            defaultSteps={repositorySetupSteps}
                            extraSteps={extraSetupSteps}
                            skippedDefaultStepIds={skippedDefaultStepIds}
                            availableTests={availableTests}
                            availableScripts={availableScripts}
                            onChange={setExtraSetupSteps}
                            onSkipChange={setSkippedDefaultStepIds}
                          />
                        </div>
                      )}
                      {storageStateOptions.length > 0 && (
                        <div className="flex items-center justify-between p-3 border-t">
                          <div className="flex items-center gap-3">
                            <Cookie className="h-4 w-4 text-muted-foreground" />
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">Load Saved Auth</Label>
                              <p className="text-xs text-muted-foreground">
                                Restore cookies & localStorage from a previous session
                              </p>
                            </div>
                          </div>
                          <Select
                            value={selectedStorageStateId ?? 'none'}
                            onValueChange={(v) => setSelectedStorageStateId(v === 'none' ? null : v)}
                          >
                            <SelectTrigger className="w-48 bg-background">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {storageStateOptions.map(s => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name} ({s.cookieCount} cookies)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Error Display */}
                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                    {error}
                  </div>
                )}

                {/* Start Button */}
                <Button
                  onClick={handleStartRecording}
                  disabled={!url || !testName || isLoading}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Video className="h-4 w-4 mr-2" />
                  )}
                  Start Recording
                </Button>
              </CardContent>
            </Card>

            {/* Right Column - Settings */}
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Recording Settings</CardTitle>
                  </div>
                  {(settingsSaveStatus.isPending || settingsSaveStatus.showSaved) && (
                    <div className="text-xs text-muted-foreground">
                      {settingsSaveStatus.isPending ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Saving...
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-600">
                          <Check className="w-3 h-3" />
                          Saved
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <PlaywrightSettingsCard
                  settings={settings}
                  repositoryId={repositoryId}
                  compact
                  onSaveStatusChange={setSettingsSaveStatus}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'recording') {
    // --- Embedded browser: immersive dark layout ---
    if (embeddedStreamUrl) {
      return (
        <div ref={recordingLayoutRef} className="flex-1 flex flex-col h-full overflow-hidden bg-muted/50">
          <div className="flex-1 flex min-h-0">
            {/* Browser area — centers in remaining space */}
            <div className="flex-1 relative flex items-center justify-center overflow-auto min-h-0">
              <BrowserViewer
                streamUrl={embeddedStreamUrl}
                initialViewport={{
                  width: settings.viewportWidth ?? 1280,
                  height: settings.viewportHeight ?? 720,
                }}
                hideControls
              />
            </div>

            {/* Timeline panel (flex sibling, pushes browser left) */}
            <div className={`h-full shrink-0 bg-card border-l border-border transition-all duration-200 overflow-hidden ${timelineOpen ? 'w-72' : 'w-0 border-l-0'}`}>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border w-72">
                <span className="text-sm font-medium text-foreground">Timeline</span>
                <span className="text-xs text-muted-foreground">{events.length} events</span>
              </div>
              <TooltipProvider delayDuration={120}>
                <div ref={timelineRef} className="overflow-y-auto overflow-x-hidden p-2.5 space-y-1 w-72" style={{ maxHeight: 'calc(100% - 41px)' }}>
                  {events.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Waiting for interactions...
                    </div>
                  ) : (
                    events.map((event, i) => (
                      <StepCard
                        key={`${event.sequence}-${i}`}
                        event={event}
                        description={getEventDescription(event)}
                        replayStatus={isActionReplayable(event)}
                        repositoryId={repositoryId}
                        onPromoteOptimistic={handlePromoteOptimistic}
                      />
                    ))
                  )}
                </div>
              </TooltipProvider>
            </div>
          </div>

          {/* Floating mini-menu — fixed at bottom center */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 layer-playback-controls flex items-center gap-1.5 px-3 py-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-full shadow-2xl">
            <div className="flex items-center gap-2 px-1">
              <div className={`h-2.5 w-2.5 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
              <span className="text-sm font-medium text-foreground">{isPaused ? 'Paused' : 'Recording'}</span>
            </div>
            <div className="w-px h-5 bg-border" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleTogglePause} title={isPaused ? 'Resume recording' : 'Pause recording'}>
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCaptureScreenshot} title="Screenshot" data-tutorial-target="screenshot">
              <Camera className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" data-tutorial-target="assertion">
                  <CheckCircle2 className="h-4 w-4" />
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleCreateAssertion('pageLoad')}>
                  Page Load
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateAssertion('networkIdle')}>
                  Network Idle
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateAssertion('urlMatch')}>
                  URL Match
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateAssertion('domContentLoaded')}>
                  DOM Content Loaded
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleFlagDownload} title="Wait for Download" data-tutorial-target="download">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleInsertTimestamp} title="Insert Timestamp">
              <CalendarClock className="h-4 w-4" />
            </Button>
            <Popover open={waitPopoverOpen} onOpenChange={setWaitPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Insert Wait">
                  <Timer className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-80">
                <WaitPopoverBody
                  mode={waitMode}
                  setMode={setWaitMode}
                  durationMs={waitDurationMs}
                  setDurationMs={setWaitDurationMs}
                  selector={waitSelector}
                  setSelector={setWaitSelector}
                  condition={waitCondition}
                  setCondition={setWaitCondition}
                  timeoutMs={waitTimeoutMs}
                  setTimeoutMs={setWaitTimeoutMs}
                  onInsert={handleInsertWait}
                />
              </PopoverContent>
            </Popover>
            <div className="w-px h-5 bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${timelineOpen ? 'bg-muted' : ''}`}
              onClick={() => setTimelineOpen(!timelineOpen)}
              title="Toggle timeline"
              data-tutorial-target="timeline"
            >
              <ListFilter className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleRecordingFullscreen}
              title={isRecordingFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isRecordingFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <div className="w-px h-5 bg-border" />
            <Button
              onClick={handleStopRecording}
              disabled={isLoading}
              className="h-8 bg-red-600 hover:bg-red-700 text-white rounded-full px-3 gap-1.5"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Stop
            </Button>
          </div>

          <RecordingTutorialOverlay layout="embedded" />
        </div>
      );
    }

    // --- Local Playwright: original card layout ---
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Recording Status */}
          <Card className="border-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                  <CardTitle>{isPaused ? 'Recording Paused' : 'Recording in Progress'}</CardTitle>
                </div>
                <Badge variant="outline">{testName}</Badge>
              </div>
              <CardDescription>{url}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTogglePause} variant={isPaused ? 'default' : 'outline'}>
                  {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button onClick={handleCaptureScreenshot} variant="outline" data-tutorial-target="screenshot">
                  <Camera className="h-4 w-4 mr-2" />
                  Screenshot
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" data-tutorial-target="assertion">
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Create Assertion
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleCreateAssertion('pageLoad')}>
                      Page Load
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCreateAssertion('networkIdle')}>
                      Network Idle
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCreateAssertion('urlMatch')}>
                      URL Match
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCreateAssertion('domContentLoaded')}>
                      DOM Content Loaded
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={handleFlagDownload} variant="outline" data-tutorial-target="download">
                  <Download className="h-4 w-4 mr-2" />
                  Wait for Download
                </Button>
                <Button onClick={handleInsertTimestamp} variant="outline">
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Insert Timestamp
                </Button>
                <Popover open={waitPopoverOpen} onOpenChange={setWaitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline">
                      <Timer className="h-4 w-4 mr-2" />
                      Insert Wait
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80">
                    <WaitPopoverBody
                      mode={waitMode}
                      setMode={setWaitMode}
                      durationMs={waitDurationMs}
                      setDurationMs={setWaitDurationMs}
                      selector={waitSelector}
                      setSelector={setWaitSelector}
                      condition={waitCondition}
                      setCondition={setWaitCondition}
                      timeoutMs={waitTimeoutMs}
                      setTimeoutMs={setWaitTimeoutMs}
                      onInsert={handleInsertWait}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  onClick={handleStopRecording}
                  variant="destructive"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 mr-2" />
                  )}
                  Stop Recording
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-6">
            {/* Interaction Timeline */}
            <Card className="col-span-2" data-tutorial-target="timeline">
              <CardHeader>
                <CardTitle className="text-sm">Interaction Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <TooltipProvider delayDuration={120}>
                  <div ref={timelineRef} className="space-y-1 max-h-64 overflow-y-auto overflow-x-hidden">
                    {events.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-sm">
                        Waiting for interactions...
                      </div>
                    ) : (
                      events.map((event, i) => (
                        <StepCard
                          key={`${event.sequence}-${i}`}
                          event={event}
                          description={getEventDescription(event)}
                          replayStatus={isActionReplayable(event)}
                          repositoryId={repositoryId}
                          onPromoteOptimistic={handlePromoteOptimistic}
                        />
                      ))
                    )}
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            {/* Screenshots */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Screenshots ({screenshots.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {screenshots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {screenshots.map((path, i) => (
                      <div
                        key={i}
                        className="aspect-video bg-muted rounded border cursor-pointer hover:border-primary"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={path}
                          alt={`Screenshot ${i + 1}`}
                          className="w-full h-full object-cover rounded"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Press Screenshot or Ctrl+Shift+S to capture
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="text-sm text-muted-foreground text-center space-y-1">
            <div>
              <Clock className="h-4 w-4 inline mr-1" />
              Recording... Interact with the browser window to capture actions.
            </div>
            <div>
              <ShieldCheck className="h-4 w-4 inline mr-1" />
              Tip: <span className="font-medium">Shift+Right-click</span> on any element to add assertions.
            </div>
          </div>

          <RecordingTutorialOverlay layout="card" />
        </div>
      </div>
    );
  }

  // Saving step
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <TraceScrub
          events={events}
          describe={getEventDescription}
          replayStatusOf={isActionReplayable}
          repositoryId={repositoryId}
          onPromoteOptimistic={handlePromoteOptimistic}
        />
        <Card>
          <CardHeader>
            <CardTitle>{isRerecording ? 'Update Test' : 'Save Recording'}</CardTitle>
            <CardDescription>
              {isRerecording
                ? 'Review the generated code - this will create a new version of the test'
                : 'Review the generated test code and save'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <span className="ml-2 font-medium">{testName}</span>
              </div>
            </div>

            {autoPlayStatus !== 'idle' && (
              <section className="rounded-lg border bg-card text-card-foreground overflow-hidden">
                <header className="flex items-center justify-between px-3 py-2 border-b bg-card">
                  <span className="text-sm font-medium">Headed 2x Replay</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {autoPlayStatus === 'saving' && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving recording…</>)}
                    {autoPlayStatus === 'playing' && !playbackStreamUrl && (<><Loader2 className="h-3 w-3 animate-spin" /> Provisioning browser…</>)}
                    {autoPlayStatus === 'playing' && playbackStreamUrl && (<><Play className="h-3 w-3" /> Replaying at 2x</>)}
                    {autoPlayStatus === 'finished' && (<><Check className="h-3 w-3" /> Replay finished</>)}
                    {autoPlayStatus === 'error' && (<><AlertTriangle className="h-3 w-3" /> Replay error</>)}
                  </span>
                </header>
                <div
                  className="relative flex items-center justify-center bg-card mx-auto w-full"
                  style={{
                    aspectRatio: `${playbackFrameSize?.width ?? settings.viewportWidth ?? 1280} / ${playbackFrameSize?.height ?? settings.viewportHeight ?? 720}`,
                    maxWidth: `${360 * ((playbackFrameSize?.width ?? settings.viewportWidth ?? 1280) / (playbackFrameSize?.height ?? settings.viewportHeight ?? 720))}px`,
                  }}
                >
                  {playbackStreamUrl && (
                    <BrowserViewer
                      streamUrl={playbackStreamUrl}
                      initialViewport={{
                        width: settings.viewportWidth ?? 1280,
                        height: settings.viewportHeight ?? 720,
                      }}
                      className="h-full w-full"
                      fit
                      hideControls
                      hideToolbar
                      hideStatusBar
                      onViewportChange={setPlaybackFrameSize}
                    />
                  )}
                  {!playbackStreamUrl && (
                    <p className="relative z-10 text-xs text-card-foreground p-8">
                      {autoPlayStatus === 'finished'
                        ? 'Replay finished — open the test to see the run.'
                        : autoPlayStatus === 'error'
                          ? 'Replay could not start.'
                          : 'Spinning up a headed browser to replay your recording…'}
                    </p>
                  )}
                </div>
              </section>
            )}

            <div>
              <label className="text-sm font-medium">Generated Code</label>
              <pre className="mt-2 bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
                {generatedCode || '// No code generated'}
              </pre>
            </div>

            {/* Save cookies from this session */}
            {capturedStorageState && (
              <div className="p-3 bg-muted/50 rounded-lg border space-y-2">
                <div className="flex items-center gap-2">
                  <Cookie className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Save Auth State</span>
                  <span className="text-xs text-muted-foreground">
                    (cookies & localStorage from this session)
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Name (e.g., Google Login)"
                    value={saveCookieName}
                    onChange={(e) => setSaveCookieName(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!saveCookieName.trim()}
                    onClick={async () => {
                      if (!capturedStorageState || !saveCookieName.trim()) return;
                      await saveStorageState(repositoryId ?? null, saveCookieName.trim(), capturedStorageState);
                      const states = await listStorageStates(repositoryId ?? null);
                      setStorageStateOptions(states.map(s => ({ id: s.id, name: s.name, cookieCount: s.cookieCount ?? 0, originCount: s.originCount ?? 0 })));
                      setCapturedStorageState(null);
                      setSaveCookieName('');
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                disabled={isLoading || autoPlayStatus === 'saving'}
                onClick={async () => {
                  // For a fresh recording that auto-saved, Discard means delete
                  // the persisted test so the user actually walks away clean.
                  // For re-records, the prior version is preserved by
                  // updateTestWithVersion — Discard just navigates back.
                  if (savedTestId && !isRerecording) {
                    setIsLoading(true);
                    try {
                      await deleteTest(savedTestId);
                    } catch (err) {
                      console.error('Failed to discard auto-saved test:', err);
                      toast.error('Could not delete the auto-saved test');
                    } finally {
                      setIsLoading(false);
                    }
                  }
                  setStep('setup');
                  setGeneratedCode('');
                  setRequiredCapabilities(null);
                  setCapturedStorageState(null);
                  setEvents([]);
                  setScreenshots([]);
                  setSavedTestId(null);
                  setAutoPlayStatus('idle');
                  setPlaybackStreamUrl(null);
                  setPlaybackJobId(null);
                  setPlaybackFrameSize(null);
                  autoTriggeredRef.current = false;
                  lastSequenceRef.current = 0;
                }}
              >
                Discard
              </Button>
              {savedTestId ? (
                <Button
                  onClick={() => router.push(`/tests?test=${encodeURIComponent(savedTestId)}`)}
                  disabled={isLoading}
                >
                  Open Test
                </Button>
              ) : (
                <Button onClick={handleSaveTest} disabled={isLoading || autoPlayStatus === 'saving'}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  {isRerecording ? 'Update Test' : 'Save Test'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
