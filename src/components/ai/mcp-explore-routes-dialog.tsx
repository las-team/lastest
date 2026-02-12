'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { mcpExploreRoutes, saveDiscoveredRoutes, type SavedRouteInfo } from '@/server/actions/ai-routes';
import { aiCreateTest, saveGeneratedTest } from '@/server/actions/ai';
import { Loader2, Globe, Save, Check, Route, FlaskConical, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface DiscoveredRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
  testSuggestions?: string[];
}

interface MCPExploreRoutesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  onSaved?: () => void;
}

export function MCPExploreRoutesDialog({
  open,
  onOpenChange,
  repositoryId,
  onSaved,
}: MCPExploreRoutesDialogProps) {
  const [step, setStep] = useState<'input' | 'exploring' | 'preview' | 'generate'>('input');
  const [baseURL, setBaseURL] = useState('http://localhost:3000');
  const [isExploring, setIsExploring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [discoveredRoutes, setDiscoveredRoutes] = useState<DiscoveredRoute[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());

  // Generate step state
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteInfo[]>([]);
  const [selectedForGeneration, setSelectedForGeneration] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [generateTotal, setGenerateTotal] = useState(0);
  const [generateResults, setGenerateResults] = useState<{ path: string; success: boolean }[]>([]);

  const handleExplore = async () => {
    if (!baseURL.trim()) {
      toast.error('Please enter a base URL');
      return;
    }

    setStep('exploring');
    setIsExploring(true);
    try {
      const result = await mcpExploreRoutes(repositoryId, baseURL.trim());

      if (result.success && result.routes) {
        setDiscoveredRoutes(result.routes);
        setSelectedRoutes(new Set(result.routes.map((r) => r.path)));
        setStep('preview');
        toast.success(`Found ${result.routes.length} routes`);
      } else {
        toast.error(result.error || 'Failed to explore routes');
        setStep('input');
      }
    } catch {
      toast.error('Failed to explore routes');
      setStep('input');
    } finally {
      setIsExploring(false);
    }
  };

  const handleSave = async () => {
    const routesToSave = discoveredRoutes.filter((r) => selectedRoutes.has(r.path));
    if (routesToSave.length === 0) {
      toast.error('No routes selected');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveDiscoveredRoutes(repositoryId, routesToSave);

      if (result.success) {
        if (result.count === 0) {
          toast.info('All routes already exist');
          onSaved?.();
          handleClose();
        } else {
          toast.success(`Saved ${result.count} new routes`);
          onSaved?.();
          // Transition to generate step if there are saved routes
          if (result.savedRoutes && result.savedRoutes.length > 0) {
            setSavedRoutes(result.savedRoutes);
            setSelectedForGeneration(new Set(result.savedRoutes.map(r => r.routeId)));
            setGenerateResults([]);
            setGenerateProgress(0);
            setStep('generate');
          } else {
            handleClose();
          }
        }
      } else {
        toast.error(result.error || 'Failed to save routes');
      }
    } catch {
      toast.error('Failed to save routes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateTests = async () => {
    const routesToGenerate = savedRoutes.filter(r => selectedForGeneration.has(r.routeId));
    if (routesToGenerate.length === 0) {
      toast.error('No routes selected');
      return;
    }

    setIsGenerating(true);
    setGenerateTotal(routesToGenerate.length);
    setGenerateProgress(0);
    setGenerateResults([]);

    let successCount = 0;
    for (const route of routesToGenerate) {
      try {
        const suggestionText = route.testSuggestions.length > 0
          ? route.testSuggestions.join(', ')
          : `Visual regression test for ${route.path}`;

        const result = await aiCreateTest(repositoryId, {
          userPrompt: `Create a visual regression test for the page at ${route.path}. Test suggestions: ${suggestionText}`,
          routePath: route.path,
          useMCP: true,
        }, route.routeId);

        if (result.success && result.code) {
          const testName = route.path === '/' ? 'Homepage' : route.path.split('/').filter(Boolean).map(s => s.replace(/[\[\]]/g, '')).join(' - ');
          await saveGeneratedTest({
            repositoryId,
            functionalAreaId: route.areaId,
            name: `${testName} - Visual Test`,
            code: result.code,
            targetUrl: route.path,
          });
          successCount++;
          setGenerateResults(prev => [...prev, { path: route.path, success: true }]);
        } else {
          setGenerateResults(prev => [...prev, { path: route.path, success: false }]);
        }
      } catch {
        setGenerateResults(prev => [...prev, { path: route.path, success: false }]);
      }
      setGenerateProgress(prev => prev + 1);
    }

    setIsGenerating(false);
    if (successCount > 0) {
      toast.success(`Generated ${successCount} test${successCount > 1 ? 's' : ''}`);
    }
    if (successCount < routesToGenerate.length) {
      toast.error(`${routesToGenerate.length - successCount} test${routesToGenerate.length - successCount > 1 ? 's' : ''} failed to generate`);
    }
    onSaved?.();
  };

  const toggleRoute = (path: string) => {
    const newSelected = new Set(selectedRoutes);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedRoutes(newSelected);
  };

  const toggleAll = () => {
    if (selectedRoutes.size === discoveredRoutes.length) {
      setSelectedRoutes(new Set());
    } else {
      setSelectedRoutes(new Set(discoveredRoutes.map((r) => r.path)));
    }
  };

  const toggleGenerateRoute = (routeId: string) => {
    const newSelected = new Set(selectedForGeneration);
    if (newSelected.has(routeId)) {
      newSelected.delete(routeId);
    } else {
      newSelected.add(routeId);
    }
    setSelectedForGeneration(newSelected);
  };

  const toggleAllGenerate = () => {
    if (selectedForGeneration.size === savedRoutes.length) {
      setSelectedForGeneration(new Set());
    } else {
      setSelectedForGeneration(new Set(savedRoutes.map(r => r.routeId)));
    }
  };

  const handleClose = () => {
    setStep('input');
    setDiscoveredRoutes([]);
    setSelectedRoutes(new Set());
    setIsExploring(false);
    setSavedRoutes([]);
    setSelectedForGeneration(new Set());
    setGenerateResults([]);
    setGenerateProgress(0);
    setIsGenerating(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => !newOpen && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            MCP Route Explorer
          </DialogTitle>
          <DialogDescription>
            {step === 'input' && 'Enter the base URL of your running application to discover routes by browsing it.'}
            {step === 'exploring' && 'AI is browsing your application to discover routes...'}
            {step === 'preview' && `Found ${discoveredRoutes.length} routes. Select which ones to add.`}
            {step === 'generate' && (
              isGenerating
                ? `Generating test ${generateProgress + 1} of ${generateTotal}...`
                : generateResults.length > 0
                  ? 'Test generation complete.'
                  : `${savedRoutes.length} routes saved. Generate tests for them?`
            )}
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="http://localhost:3000"
              />
              <p className="text-xs text-muted-foreground">
                Make sure your application is running at this URL before starting.
              </p>
            </div>
          </div>
        )}

        {step === 'exploring' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Exploring application via MCP...</p>
            <p className="text-xs text-muted-foreground mt-2">
              The AI is navigating your app and discovering routes
            </p>
          </div>
        )}

        {step === 'preview' && (
          <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {selectedRoutes.size === discoveredRoutes.length ? 'Deselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedRoutes.size} of {discoveredRoutes.length} selected
              </span>
            </div>

            <ScrollArea className="h-[40vh] border rounded-lg">
              <div className="p-2 space-y-1">
                {discoveredRoutes.map((route) => (
                  <div
                    key={route.path}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedRoutes.has(route.path)
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted/50 border border-transparent'
                    }`}
                    onClick={() => toggleRoute(route.path)}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                      selectedRoutes.has(route.path)
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    }`}>
                      {selectedRoutes.has(route.path) && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Route className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <code className="font-mono text-sm">{route.path}</code>
                        <Badge variant={route.type === 'static' ? 'default' : 'secondary'} className="text-xs">
                          {route.type}
                        </Badge>
                      </div>
                      {route.description && (
                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                          {route.description}
                        </p>
                      )}
                      {route.testSuggestions && route.testSuggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2 ml-6">
                          {route.testSuggestions.slice(0, 2).map((suggestion, i) => (
                            <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                              {suggestion}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === 'generate' && (
          <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
            {isGenerating && (
              <div className="space-y-2">
                <Progress value={(generateProgress / generateTotal) * 100} />
                <p className="text-xs text-muted-foreground text-center">
                  Generating test {generateProgress + 1} of {generateTotal}...
                </p>
              </div>
            )}

            {!isGenerating && generateResults.length === 0 && (
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={toggleAllGenerate}>
                  {selectedForGeneration.size === savedRoutes.length ? 'Deselect All' : 'Select All'}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedForGeneration.size} of {savedRoutes.length} selected
                </span>
              </div>
            )}

            <ScrollArea className="flex-1 border rounded-lg min-h-0 max-h-[50vh]">
              <div className="p-2 space-y-1">
                {savedRoutes.map((route) => {
                  const result = generateResults.find(r => r.path === route.path);
                  return (
                    <div
                      key={route.routeId}
                      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                        result
                          ? result.success
                            ? 'bg-green-500/10 border border-green-500/20'
                            : 'bg-red-500/10 border border-red-500/20'
                          : selectedForGeneration.has(route.routeId)
                            ? 'bg-primary/10 border border-primary/20 cursor-pointer'
                            : 'hover:bg-muted/50 border border-transparent cursor-pointer'
                      }`}
                      onClick={() => !isGenerating && !result && toggleGenerateRoute(route.routeId)}
                    >
                      <div className="w-5 h-5 flex items-center justify-center mt-0.5 flex-shrink-0">
                        {result ? (
                          result.success ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )
                        ) : (
                          <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                            selectedForGeneration.has(route.routeId)
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/30'
                          }`}>
                            {selectedForGeneration.has(route.routeId) && <Check className="h-3 w-3" />}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Route className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <code className="font-mono text-sm">{route.path}</code>
                          <Badge variant="outline" className="text-xs">{route.areaName}</Badge>
                        </div>
                        {route.testSuggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 ml-6">
                            {route.testSuggestions.slice(0, 3).map((suggestion, i) => (
                              <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                                {suggestion}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          {step === 'input' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleExplore} disabled={!baseURL.trim()}>
                <Globe className="h-4 w-4 mr-2" />
                Start Exploring
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || selectedRoutes.size === 0}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save {selectedRoutes.size} Routes
              </Button>
            </>
          )}
          {step === 'generate' && (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
                {generateResults.length > 0 ? 'Done' : 'Skip'}
              </Button>
              {generateResults.length === 0 && (
                <Button
                  onClick={handleGenerateTests}
                  disabled={isGenerating || selectedForGeneration.size === 0}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4 mr-2" />
                  )}
                  Generate {selectedForGeneration.size} Test{selectedForGeneration.size !== 1 ? 's' : ''}
                </Button>
              )}
              {generateResults.length > 0 && !isGenerating && (
                <Button onClick={handleClose}>
                  Done
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
