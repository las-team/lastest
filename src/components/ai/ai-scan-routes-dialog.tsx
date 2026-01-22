'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { aiScanRoutes, saveDiscoveredRoutes } from '@/server/actions/ai-routes';
import { Loader2, Sparkles, Save, RefreshCw, Check, Route } from 'lucide-react';
import { toast } from 'sonner';

interface DiscoveredRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
  testSuggestions?: string[];
}

interface AIScanRoutesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  localPath: string;
  onSaved?: () => void;
}

export function AIScanRoutesDialog({
  open,
  onOpenChange,
  repositoryId,
  localPath,
  onSaved,
}: AIScanRoutesDialogProps) {
  const [step, setStep] = useState<'scanning' | 'preview'>('scanning');
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [discoveredRoutes, setDiscoveredRoutes] = useState<DiscoveredRoute[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);
  const [hasStartedScan, setHasStartedScan] = useState(false);

  // Trigger scan when dialog opens
  useEffect(() => {
    if (open && !hasStartedScan && !hasScanned) {
      setHasStartedScan(true);
      handleScan();
    }
  }, [open, hasStartedScan, hasScanned]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const result = await aiScanRoutes(repositoryId, localPath);

      if (result.success && result.routes) {
        setDiscoveredRoutes(result.routes);
        setSelectedRoutes(new Set(result.routes.map((r) => r.path)));
        setStep('preview');
        setHasScanned(true);
        toast.success(`Found ${result.routes.length} routes`);
      } else {
        toast.error(result.error || 'Failed to scan routes');
      }
    } catch (error) {
      toast.error('Failed to scan routes');
    } finally {
      setIsScanning(false);
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
        } else {
          toast.success(`Saved ${result.count} new routes`);
        }
        onSaved?.();
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save routes');
      }
    } catch (error) {
      toast.error('Failed to save routes');
    } finally {
      setIsSaving(false);
    }
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

  const handleClose = () => {
    setStep('scanning');
    setDiscoveredRoutes([]);
    setSelectedRoutes(new Set());
    setHasScanned(false);
    setHasStartedScan(false);
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && !hasScanned) {
      // Scan will be triggered by useEffect
    } else if (!newOpen) {
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Route Discovery
          </DialogTitle>
          <DialogDescription>
            {step === 'scanning'
              ? 'AI is analyzing your codebase to discover testable routes...'
              : `Found ${discoveredRoutes.length} routes. Select which ones to add.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'scanning' ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Scanning codebase...</p>
            <p className="text-xs text-muted-foreground mt-2">
              This may take a minute depending on your codebase size
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {selectedRoutes.size === discoveredRoutes.length ? 'Deselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedRoutes.size} of {discoveredRoutes.length} selected
              </span>
            </div>

            <ScrollArea className="flex-1 border rounded-lg">
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

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {step === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={handleScan}
                disabled={isScanning}
              >
                {isScanning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Rescan
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
