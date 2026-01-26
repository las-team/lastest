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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  startRecording,
  stopRecording,
  captureScreenshot,
  createAssertion,
  saveRecordedTest,
  getOrCreateFunctionalArea,
  getRecordingStatus,
  clearLastCompletedSession,
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
} from 'lucide-react';
import type { FunctionalArea, PlaywrightSettings } from '@/lib/db/schema';
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';

interface RecordingClientProps {
  areas: FunctionalArea[];
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  defaultBaseUrl?: string;
}

type RecordingStep = 'setup' | 'recording' | 'saving';

function getEventDescription(event: RecordingEvent): string {
  switch (event.type) {
    case 'navigation':
      return `Navigate to ${event.data.relativePath || event.data.url || 'page'}`;
    case 'action':
      if (event.data.action === 'click') {
        return `Click ${event.data.selector?.slice(0, 40) || 'element'}`;
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
      const labels: Record<string, string> = {
        pageLoad: 'Page Load',
        networkIdle: 'Network Idle',
        urlMatch: 'URL Match',
        domContentLoaded: 'DOM Ready',
      };
      return `Assert: ${labels[event.data.assertionType || ''] || event.data.assertionType}`;
    case 'mouse-down':
      return `Mouse down at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case 'mouse-up':
      return `Mouse up at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case 'hover-preview':
      const info = event.data.elementInfo;
      if (info) {
        const target = info.id ? `#${info.id}` : info.textContent?.slice(0, 20) || info.tagName;
        return `${info.potentialAction || 'interact'} → ${target}`;
      }
      return 'Hovering...';
    default:
      return event.type;
  }
}

interface RecordingEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  data: {
    action?: string;
    selector?: string;
    value?: string;
    url?: string;
    relativePath?: string;
    screenshotPath?: string;
    assertionType?: string;
    coordinates?: { x: number; y: number };
    button?: number;
    elementInfo?: {
      tagName: string;
      id?: string;
      textContent?: string;
      potentialAction?: 'click' | 'fill' | 'select';
      potentialSelector?: string;
    };
  };
}

export function RecordingClient({ areas: initialAreas, settings, repositoryId, defaultBaseUrl }: RecordingClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<RecordingStep>('setup');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Setup form state
  const [url, setUrl] = useState(defaultBaseUrl || 'https://');
  const [testName, setTestName] = useState('');
  const [areaId, setAreaId] = useState<string>('');
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

  const handleStartRecording = async () => {
    if (!url || !testName) return;

    setIsLoading(true);
    setError(null);

    try {
      // Create functional area if needed
      let finalAreaId = areaId;
      if (newAreaName && !areaId) {
        const area = await getOrCreateFunctionalArea(newAreaName);
        finalAreaId = area.id;
        setAreas([...areas, { ...area, description: area.description ?? null, repositoryId: area.repositoryId ?? null }]);
        setAreaId(area.id);
      }

      const result = await startRecording(url, repositoryId);

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

  const handleSaveTest = async () => {
    setIsLoading(true);
    try {
      const test = await saveRecordedTest({
        name: testName,
        functionalAreaId: areaId || null,
        targetUrl: url,
        code: generatedCode,
        repositoryId,
      });
      router.push(`/tests/${test.id}`);
    } catch (error) {
      console.error('Failed to save test:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'setup') {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>New Recording</CardTitle>
                  <CardDescription>
                    Configure your test and start recording browser interactions
                  </CardDescription>
                </div>
                <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Recording Settings</SheetTitle>
                      <SheetDescription>
                        Configure selector priority and browser settings
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6">
                      <PlaywrightSettingsCard
                        settings={settings}
                        repositoryId={repositoryId}
                        compact
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
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
                />
              </div>

              {/* Functional Area */}
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

          <div className="grid grid-cols-2 gap-6">
            {/* Interaction Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Interaction Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div ref={timelineRef} className="space-y-2 max-h-64 overflow-y-auto">
                  {events.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Waiting for interactions...
                    </div>
                  ) : (
                    events.map((event, i) => (
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
                          {event.type === 'assertion' && <CheckCircle2 className="h-3 w-3 text-purple-500" />}
                          {event.type === 'mouse-down' && <MousePointerClick className="h-3 w-3 text-red-500" />}
                          {event.type === 'mouse-up' && <MousePointerClick className="h-3 w-3 text-red-300" />}
                          {event.type === 'hover-preview' && <Eye className="h-3 w-3 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-muted-foreground text-xs">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="ml-2 truncate">
                            {getEventDescription(event)}
                          </span>
                        </div>
                      </div>
                    ))
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

          <div className="text-sm text-muted-foreground text-center">
            <Clock className="h-4 w-4 inline mr-1" />
            Recording... Interact with the browser window to capture actions.
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
            <CardTitle>Save Recording</CardTitle>
            <CardDescription>
              Review the generated test code and save
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
                Save Test
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
