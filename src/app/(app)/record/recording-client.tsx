'use client';

import { useState, useEffect, useRef } from 'react';
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
  saveRecordedTest,
  updateRerecordedTest,
  getOrCreateFunctionalArea,
  getRecordingStatus,
  clearLastCompletedSession,
  checkPlaywrightAvailability,
  startPlaywrightInspector,
  getInspectorStatus,
  cancelPlaywrightInspector,
  finalizeInspectorSession,
  type PlaywrightAvailability,
} from '@/server/actions/recording';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AssertionType } from '@/lib/playwright/recorder';
import {
  Video,
  Square,
  Camera,
  Loader2,
  ExternalLink,
  Clock,
  MousePointer,
  Navigation,
  Settings2,
  CheckCircle2,
  ChevronDown,
  MousePointerClick,
  Eye,
  FormInput,
  ListFilter,
  AlertTriangle,
  Check,
  RefreshCw,
  Terminal,
  Keyboard,
  ShieldCheck,
} from 'lucide-react';
import type { FunctionalArea, PlaywrightSettings, RecordingEngine, Test } from '@/lib/db/schema';
import { DEFAULT_RECORDING_ENGINES } from '@/lib/db/schema';
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';

interface RecordingClientProps {
  areas: FunctionalArea[];
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  defaultBaseUrl?: string;
  enabledEngines?: RecordingEngine[];
  defaultEngine?: RecordingEngine;
  rerecordTest?: Test | null;
}

type RecordingStep = 'setup' | 'recording' | 'inspector-running' | 'saving';

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

  if (event.data.action === 'click' && hasCoords) {
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
        return `${modPrefix}Click ${event.data.selector?.slice(0, 40) || 'element'}`;
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
    default:
      return event.type;
  }
}

interface ActionSelector {
  type: string;
  value: string;
}

interface VerificationStatus {
  syntaxValid: boolean;
  domVerified?: boolean;
  lastChecked?: number;
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
}: RecordingClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<RecordingStep>('setup');
  const [playwrightStatus, setPlaywrightStatus] = useState<PlaywrightAvailability | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<RecordingEngine>(defaultEngine);
  const [inspectorSessionId, setInspectorSessionId] = useState<string | null>(null);
  const [executionTarget, setExecutionTarget] = useState<string>('local');

  // Re-record mode
  const isRerecording = !!rerecordTest;

  // Check Playwright availability on mount
  useEffect(() => {
    async function verifyPlaywright() {
      const status = await checkPlaywrightAvailability(repositoryId);
      setPlaywrightStatus(status);
    }
    verifyPlaywright();
  }, [repositoryId]);

  // Setup form state - pre-fill from rerecordTest if available
  const [url, setUrl] = useState(rerecordTest?.targetUrl || defaultBaseUrl || 'https://');
  const [testName, setTestName] = useState(rerecordTest?.name || '');
  const [areaId, setAreaId] = useState<string>(rerecordTest?.functionalAreaId || '');
  const [newAreaName, setNewAreaName] = useState('');
  const [areas, setAreas] = useState(initialAreas);

  // Recording state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lastSequenceRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState({ isPending: false, showSaved: false });

  // Poll for recording status and events when in recording step
  useEffect(() => {
    if (step !== 'recording') return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await getRecordingStatus(repositoryId, lastSequenceRef.current);

        // If recording stopped (browser was closed), check for completed session
        if (!status.isRecording) {
          if (status.lastCompletedSession) {
            setGeneratedCode(status.lastCompletedSession.generatedCode);
            await clearLastCompletedSession(repositoryId);
            setStep('saving');
          } else {
            // Recording was stopped but no session - go back to setup
            setStep('setup');
            setError('Recording was stopped unexpectedly');
          }
          clearInterval(pollInterval);
          return;
        }

        // Apply verification updates to existing events
        if (status.verificationUpdates && status.verificationUpdates.length > 0) {
          setEvents(prev => {
            const updated = [...prev];
            for (const update of status.verificationUpdates) {
              const event = updated.find(e => e.data.actionId === update.actionId);
              if (event && event.verification) {
                event.verification = {
                  ...event.verification,
                  domVerified: update.verified,
                  lastChecked: Date.now(),
                };
              }
            }
            return updated;
          });
        }

        // Process new events
        if (status.events.length > 0) {
          setEvents(prev => {
            // Replace any preview events with committed versions or add new ones
            const newEvents = [...prev];
            for (const event of status.events) {
              // Skip cursor-move events for display (too noisy)
              if (event.type === 'cursor-move') continue;

              // For hover-preview, replace the last one if exists
              if (event.type === 'hover-preview') {
                const lastIdx = newEvents.findLastIndex(e => e.type === 'hover-preview');
                if (lastIdx !== -1) {
                  newEvents.splice(lastIdx, 1);
                }
              }
              newEvents.push(event);
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
      }
    }, 500); // Poll every 500ms for better responsiveness

    return () => clearInterval(pollInterval);
  }, [step, repositoryId]);

  // Poll for inspector status when in inspector-running step
  useEffect(() => {
    if (step !== 'inspector-running' || !inspectorSessionId) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await getInspectorStatus(inspectorSessionId);

        // If inspector stopped (user closed the window), finalize session
        if (!status.isRunning) {
          const result = await finalizeInspectorSession(inspectorSessionId);
          if (result.success && result.code) {
            setGeneratedCode(result.code);
            setStep('saving');
          } else {
            setStep('setup');
            setError(result.error || 'No code was generated. Try recording some interactions.');
          }
          setInspectorSessionId(null);
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Failed to poll inspector status:', err);
      }
    }, 1000); // Poll every 1s for inspector

    return () => clearInterval(pollInterval);
  }, [step, inspectorSessionId]);

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
        }]);
        setAreaId(area.id);
      }

      if (selectedEngine === 'playwright-inspector') {
        // Start Playwright Inspector
        const result = await startPlaywrightInspector(url, repositoryId);

        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.sessionId) {
          setInspectorSessionId(result.sessionId);
          setStep('inspector-running');
        }
      } else {
        // Start Lastest recorder
        const result = await startRecording(url, repositoryId, executionTarget);

        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.sessionId) {
          setSessionId(result.sessionId);
          setStep('recording');
          setEvents([]);
          lastSequenceRef.current = 0;
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
      await createAssertion(type);
      // Event will come through polling
    } catch (error) {
      console.error('Failed to create assertion:', error);
    }
  };

  const handleStopRecording = async () => {
    setIsLoading(true);
    try {
      const session = await stopRecording(repositoryId);
      if (session) {
        setGeneratedCode(session.generatedCode);
        setStep('saving');
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelInspector = async () => {
    if (!inspectorSessionId) return;

    setIsLoading(true);
    try {
      await cancelPlaywrightInspector(inspectorSessionId);
      setInspectorSessionId(null);
      setStep('setup');
    } catch (error) {
      console.error('Failed to cancel inspector:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTest = async () => {
    setIsLoading(true);
    try {
      if (isRerecording && rerecordTest) {
        // Update existing test with new code
        await updateRerecordedTest({
          testId: rerecordTest.id,
          code: generatedCode,
          targetUrl: url,
        });
        router.push(`/tests/${rerecordTest.id}`);
      } else {
        // Create new test
        const test = await saveRecordedTest({
          name: testName,
          functionalAreaId: areaId || null,
          targetUrl: url,
          code: generatedCode,
          repositoryId,
        });
        router.push(`/tests/${test.id}`);
      }
    } catch (error) {
      console.error('Failed to save test:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'setup') {
    // Playwright status section component
    const PlaywrightStatusSection = () => {
      if (!playwrightStatus) {
        return (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Checking browser availability...</span>
              </div>
            </CardContent>
          </Card>
        );
      }

      if (playwrightStatus.available) {
        return (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>{playwrightStatus.browser.charAt(0).toUpperCase() + playwrightStatus.browser.slice(1)} browser ready</span>
              </div>
            </CardContent>
          </Card>
        );
      }

      return (
        <Card className="border-destructive/50">
          <CardContent className="py-3 space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>{playwrightStatus.error}</span>
            </div>
            {playwrightStatus.installCommand && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded font-mono text-xs">
                <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
                <code>{playwrightStatus.installCommand}</code>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setPlaywrightStatus(null);
                const status = await checkPlaywrightAvailability(repositoryId);
                setPlaywrightStatus(status);
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    };
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-4">
          <PlaywrightStatusSection />
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

                {/* Execution Target */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Execution Target</label>
                  <ExecutionTargetSelector
                    value={executionTarget}
                    onChange={setExecutionTarget}
                    disabled={isLoading}
                    capabilityFilter="record"
                  />
                  <p className="text-xs text-muted-foreground">
                    {executionTarget === 'local'
                      ? 'Record on this machine'
                      : 'Record on a remote agent'}
                  </p>
                </div>

                {/* Error Display */}
                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                    {error}
                  </div>
                )}

                {/* Start Button */}
                <Button
                  onClick={handleStartRecording}
                  disabled={!url || !testName || isLoading || !playwrightStatus?.available}
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

  if (step === 'inspector-running') {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="border-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
                  <CardTitle>Playwright Inspector Running</CardTitle>
                </div>
                <Badge variant="outline">{testName}</Badge>
              </div>
              <CardDescription>{url}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Playwright Inspector is open</span>
                </div>
                <ul className="text-sm text-muted-foreground space-y-1 ml-6">
                  <li>Interact with the browser to record actions</li>
                  <li>Use the Inspector toolbar for assertions</li>
                  <li>Close the Inspector window when done</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleCancelInspector}
                  variant="destructive"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 mr-2" />
                  )}
                  Cancel Recording
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="text-sm text-muted-foreground text-center">
            <Clock className="h-4 w-4 inline mr-1" />
            Recording... Close the Inspector window to save.
          </div>
        </div>
      </div>
    );
  }

  if (step === 'recording') {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Recording Status */}
          <Card className="border-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  <CardTitle>Recording in Progress</CardTitle>
                </div>
                <Badge variant="outline">{testName}</Badge>
              </div>
              <CardDescription>{url}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button onClick={handleCaptureScreenshot} variant="outline">
                  <Camera className="h-4 w-4 mr-2" />
                  Screenshot
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
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
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">Interaction Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div ref={timelineRef} className="space-y-2 max-h-64 overflow-y-auto overflow-x-hidden">
                  {events.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Waiting for interactions...
                    </div>
                  ) : (
                    events.map((event, i) => {
                      const replayStatus = isActionReplayable(event);
                      const verification = event.verification;
                      return (
                        <div
                          key={`${event.sequence}-${i}`}
                          className={`flex items-start gap-2 text-sm ${
                            event.status === 'preview' ? 'opacity-50 border-l-2 border-dashed border-muted-foreground pl-2' : ''
                          }`}
                        >
                          <div className="mt-0.5">
                            {event.type === 'navigation' && <Navigation className="h-3 w-3 text-blue-500" />}
                            {event.type === 'action' && event.data.action === 'click' && <MousePointer className="h-3 w-3 text-green-500" />}
                            {event.type === 'action' && event.data.action === 'fill' && <FormInput className="h-3 w-3 text-orange-500" />}
                            {event.type === 'action' && event.data.action === 'selectOption' && <ListFilter className="h-3 w-3 text-cyan-500" />}
                            {event.type === 'screenshot' && <Camera className="h-3 w-3 text-yellow-500" />}
                            {event.type === 'assertion' && !event.data.elementAssertion && <CheckCircle2 className="h-3 w-3 text-purple-500" />}
                            {event.type === 'assertion' && event.data.elementAssertion && <ShieldCheck className="h-3 w-3 text-teal-500" />}
                            {event.type === 'mouse-down' && <MousePointerClick className="h-3 w-3 text-red-500" />}
                            {event.type === 'mouse-up' && <MousePointerClick className="h-3 w-3 text-red-300" />}
                            {event.type === 'hover-preview' && <Eye className="h-3 w-3 text-gray-400" />}
                            {event.type === 'keypress' && <Keyboard className="h-3 w-3 text-indigo-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-muted-foreground text-xs">
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="ml-2 truncate">
                              {getEventDescription(event)}
                            </span>
                          </div>
                          {/* Verification indicator - fixed width to prevent layout shift */}
                          <div className="mt-0.5 flex items-center justify-end w-5 shrink-0">
                            {event.type === 'action' && event.status === 'committed' && (
                              <div title={
                                !replayStatus.replayable ? 'No selectors - may not replay' :
                                replayStatus.reason === 'coords-only' ? 'Coords fallback only' :
                                verification?.domVerified ? 'Verified' :
                                verification?.syntaxValid ? 'Verifying...' : 'Checking...'
                              }>
                                {!replayStatus.replayable ? (
                                  <AlertTriangle className="h-3 w-3 text-red-500" />
                                ) : replayStatus.reason === 'coords-only' ? (
                                  <Check className="h-3 w-3 text-yellow-500" />
                                ) : verification?.domVerified ? (
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                ) : verification?.syntaxValid ? (
                                  <div className="flex items-center">
                                    <Check className="h-3 w-3 text-green-500" />
                                    <Loader2 className="h-2.5 w-2.5 text-muted-foreground animate-spin ml-0.5" />
                                  </div>
                                ) : (
                                  <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
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
                    Press Screenshot or Ctrl+S to capture
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
        </div>
      </div>
    );
  }

  // Saving step
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
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

            <div>
              <label className="text-sm font-medium">Generated Code</label>
              <pre className="mt-2 bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
                {generatedCode || '// No code generated'}
              </pre>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('setup');
                  setGeneratedCode('');
                  setEvents([]);
                  setScreenshots([]);
                  lastSequenceRef.current = 0;
                }}
              >
                Discard
              </Button>
              <Button onClick={handleSaveTest} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {isRerecording ? 'Update Test' : 'Save Test'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
