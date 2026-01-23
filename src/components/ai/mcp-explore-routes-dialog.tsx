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
import { mcpExploreRoutes, saveDiscoveredRoutes } from '@/server/actions/ai-routes';
import { Loader2, Globe, Save, Check, Route } from 'lucide-react';
import { toast } from 'sonner';

interface DiscoveredRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
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
  const [step, setStep] = useState<'input' | 'exploring' | 'preview'>('input');
  const [baseURL, setBaseURL] = useState('http://localhost:3000');
  const [isExploring, setIsExploring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [discoveredRoutes, setDiscoveredRoutes] = useState<DiscoveredRoute[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());

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
        } else {
          toast.success(`Saved ${result.count} new routes`);
        }
        onSaved?.();
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save routes');
      }
    } catch {
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
    setStep('input');
    setDiscoveredRoutes([]);
    setSelectedRoutes(new Set());
    setIsExploring(false);
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

            <ScrollArea className="flex-1 border rounded-lg min-h-0 max-h-[50vh]">
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
          {step === 'input' && (
            <Button onClick={handleExplore} disabled={!baseURL.trim()}>
              <Globe className="h-4 w-4 mr-2" />
              Start Exploring
            </Button>
          )}
          {step === 'preview' && (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
