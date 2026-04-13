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
import { mcpExploreRoutes, saveDiscoveredRoutes, type SavedRouteInfo, type DiscoveredArea } from '@/server/actions/ai-routes';
import { createTest, saveGeneratedTest } from '@/server/actions/ai';
import { Loader2, Globe, Save, Check, Minus, Route, FlaskConical, CheckCircle2, XCircle, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

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
  const [_isExploring, setIsExploring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [discoveredAreas, setDiscoveredAreas] = useState<DiscoveredArea[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  // Generate step state
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteInfo[]>([]);
  const [selectedForGeneration, setSelectedForGeneration] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [generateTotal, setGenerateTotal] = useState(0);
  const [generateResults, setGenerateResults] = useState<{ path: string; success: boolean }[]>([]);

  const allRoutes = discoveredAreas.flatMap((a) => a.routes);
  const totalRouteCount = allRoutes.length;

  const handleExplore = async () => {
    if (!baseURL.trim()) {
      toast.error('Please enter a base URL');
      return;
    }

    setStep('exploring');
    setIsExploring(true);
    try {
      const result = await mcpExploreRoutes(repositoryId, baseURL.trim());

      if (result.success && result.functionalAreas) {
        setDiscoveredAreas(result.functionalAreas);
        const allPaths = result.functionalAreas.flatMap((a) => a.routes.map((r) => r.path));
        setSelectedRoutes(new Set(allPaths));
        setExpandedAreas(new Set(result.functionalAreas.map((a) => a.name)));
        setStep('preview');
        toast.success(`Found ${allPaths.length} routes in ${result.functionalAreas.length} areas`);
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

  const toggleAreaExpansion = (areaName: string) => {
    const next = new Set(expandedAreas);
    if (next.has(areaName)) {
      next.delete(areaName);
    } else {
      next.add(areaName);
    }
    setExpandedAreas(next);
  };

  const getAreaSelectionState = (area: DiscoveredArea): 'all' | 'some' | 'none' => {
    const paths = area.routes.map((r) => r.path);
    const selectedCount = paths.filter((p) => selectedRoutes.has(p)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === paths.length) return 'all';
    return 'some';
  };

  const toggleArea = (area: DiscoveredArea) => {
    const next = new Set(selectedRoutes);
    const state = getAreaSelectionState(area);
    for (const route of area.routes) {
      if (state === 'all') {
        next.delete(route.path);
      } else {
        next.add(route.path);
      }
    }
    setSelectedRoutes(next);
  };

  const toggleRoute = (path: string) => {
    const next = new Set(selectedRoutes);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setSelectedRoutes(next);
  };

  const toggleAll = () => {
    if (selectedRoutes.size === totalRouteCount) {
      setSelectedRoutes(new Set());
    } else {
      setSelectedRoutes(new Set(allRoutes.map((r) => r.path)));
    }
  };

  const handleSave = async () => {
    // Build areas with only selected routes
    const areasToSave: DiscoveredArea[] = discoveredAreas
      .map((area) => ({
        ...area,
        routes: area.routes.filter((r) => selectedRoutes.has(r.path)),
      }))
      .filter((area) => area.routes.length > 0);

    if (areasToSave.length === 0) {
      toast.error('No routes selected');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveDiscoveredRoutes(repositoryId, areasToSave);

      if (result.success) {
        if (result.count === 0) {
          toast.info('All routes already exist');
          onSaved?.();
          handleClose();
        } else {
          toast.success(`Saved ${result.count} new routes`);
          onSaved?.();
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

        const result = await createTest(repositoryId, {
          userPrompt: `Create a visual regression test for the page at ${route.path}. Test suggestions: ${suggestionText}`,
          routePath: route.path,
          useMCP: true,
        });

        if (result.success && result.code) {
          const testName = route.path === '/' ? 'Homepage' : route.path.split('/').filter(Boolean).map(s => s.replace(/[\[\]]/g, '')).join(' - ');
          await saveGeneratedTest({
            repositoryId,
            functionalAreaId: route.areaId,
            name: `${testName} - Visual Test`,
            code: result.code,
            targetUrl: route.path,
            description: route.testSuggestions.length > 0 ? route.testSuggestions.join('\n') : undefined,
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

  const toggleGenerateRoute = (routeId: string) => {
    const next = new Set(selectedForGeneration);
    if (next.has(routeId)) {
      next.delete(routeId);
    } else {
      next.add(routeId);
    }
    setSelectedForGeneration(next);
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
    setDiscoveredAreas([]);
    setSelectedRoutes(new Set());
    setExpandedAreas(new Set());
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
            {step === 'preview' && `Found ${totalRouteCount} routes in ${discoveredAreas.length} areas. Select which ones to add.`}
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
                {selectedRoutes.size === totalRouteCount ? 'Deselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedRoutes.size} of {totalRouteCount} selected
              </span>
            </div>

            <ScrollArea className="h-[40vh] border rounded-lg">
              <div className="p-2 space-y-1">
                {discoveredAreas.map((area) => {
                  const areaState = getAreaSelectionState(area);
                  const isExpanded = expandedAreas.has(area.name);
                  return (
                    <div key={area.name}>
                      <div
                        className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleAreaExpansion(area.name)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <div
                          className={`w-5 h-5 rounded border flex items-center justify-center ${
                            areaState === 'all'
                              ? 'bg-primary border-primary text-primary-foreground'
                              : areaState === 'some'
                                ? 'bg-primary/50 border-primary text-primary-foreground'
                                : 'border-muted-foreground/30'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleArea(area);
                          }}
                        >
                          {areaState === 'all' && <Check className="h-3 w-3" />}
                          {areaState === 'some' && <Minus className="h-3 w-3" />}
                        </div>
                        <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium text-sm">{area.name}</span>
                        <Badge variant="outline" className="text-xs ml-auto">
                          {area.routes.length} route{area.routes.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      {isExpanded && (
                        <div className="ml-7 space-y-1">
                          {area.routes.map((route) => (
                            <div
                              key={route.path}
                              className={`flex items-start gap-3 p-2 pl-4 rounded-lg cursor-pointer transition-colors ${
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
                      )}
                    </div>
                  );
                })}
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
