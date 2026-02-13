'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AreaTree, type TreeSelection } from '@/components/areas/area-tree';
import { AreaDetailSection } from '@/components/areas/area-detail-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createArea, deleteArea, deleteAreaWithContents, moveTestToArea, moveSuiteToArea, moveArea } from '@/server/actions/areas';
import { FolderSearch, Sparkles, Globe, FileText, Loader2, BookOpen, Check, X, Circle, FileWarning } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { startRemoteRouteScan } from '@/server/actions/scanner';
import { AIScanRoutesDialog } from '@/components/ai/ai-scan-routes-dialog';
import { SpecAnalysisDialog } from '@/components/ai/spec-analysis-dialog';
import { MCPExploreRoutesDialog } from '@/components/ai/mcp-explore-routes-dialog';
import { ImportFromSpecDialog } from '@/components/ai/import-from-spec-dialog';
import { toast } from 'sonner';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import type { FunctionalAreaWithChildren } from '@/lib/db/queries';

export interface SuiteItem {
  id: string;
  name: string;
  description: string | null;
  testCount: number;
}

interface AreasPageClientProps {
  tree: FunctionalAreaWithChildren[];
  uncategorizedTests: { id: string; name: string; latestStatus: string | null }[];
  unsortedSuites: SuiteItem[];
  repositoryId: string;
  selectedBranch: string;
}

export function AreasPageClient({ tree, uncategorizedTests, unsortedSuites, repositoryId, selectedBranch }: AreasPageClientProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaParentId, setNewAreaParentId] = useState<string | undefined>();
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaDescription, setNewAreaDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteAreaId, setDeleteAreaId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showAIScanDialog, setShowAIScanDialog] = useState(false);
  const [showSpecAnalysisDialog, setShowSpecAnalysisDialog] = useState(false);
  const [showMCPExploreDialog, setShowMCPExploreDialog] = useState(false);
  const [showImportFromSpecDialog, setShowImportFromSpecDialog] = useState(false);

  // Delete key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selection?.type === 'area' && !deleteAreaId) {
        // Don't trigger if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        setDeleteAreaId(selection.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, deleteAreaId]);

  function computeCoverage(
    items: FunctionalAreaWithChildren[],
    uncategorized: { id: string; name: string; latestStatus: string | null }[]
  ) {
    let passed = 0, failed = 0, notRun = 0, placeholders = 0;

    function walk(areas: FunctionalAreaWithChildren[]) {
      for (const area of areas) {
        for (const t of area.tests) {
          if (t.isPlaceholder) { placeholders++; continue; }
          if (t.latestStatus === 'passed') passed++;
          else if (t.latestStatus === 'failed') failed++;
          else notRun++;
        }
        walk(area.children);
      }
    }
    walk(items);

    for (const t of uncategorized) {
      if (t.latestStatus === 'passed') passed++;
      else if (t.latestStatus === 'failed') failed++;
      else notRun++;
    }

    const total = passed + failed + notRun;
    const executed = passed + failed;
    const rate = total > 0 ? Math.round((executed / total) * 100) : 0;
    return { passed, failed, notRun, placeholders, total, executed, rate };
  }

  const coverage = computeCoverage(tree, uncategorizedTests);

  function getCoverageColor(rate: number) {
    if (rate >= 80) return 'text-green-600 dark:text-green-400';
    if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  }

  function getCoverageBarClass(rate: number) {
    if (rate >= 80) return '[&_[data-slot=progress-indicator]]:bg-green-500';
    if (rate >= 50) return '[&_[data-slot=progress-indicator]]:bg-yellow-500';
    return '[&_[data-slot=progress-indicator]]:bg-red-500';
  }

  const handleNewArea = (parentId?: string) => {
    setNewAreaParentId(parentId);
    setNewAreaName('');
    setNewAreaDescription('');
    setIsNewAreaOpen(true);
  };

  const handleCreateArea = async () => {
    if (!newAreaName.trim()) return;
    setIsCreating(true);
    try {
      await createArea({
        name: newAreaName.trim(),
        description: newAreaDescription.trim() || undefined,
        repositoryId,
        parentId: newAreaParentId,
      });
      setIsNewAreaOpen(false);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteArea = async (withContents: boolean) => {
    if (!deleteAreaId) return;
    setIsDeleting(true);
    try {
      if (withContents) {
        await deleteAreaWithContents(deleteAreaId);
      } else {
        await deleteArea(deleteAreaId);
      }
      if (selection?.type === 'area' && selection.id === deleteAreaId) {
        setSelection(null);
      }
      setDeleteAreaId(null);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMoveTest = async (testId: string, areaId: string | null) => {
    await moveTestToArea(testId, areaId);
    router.refresh();
  };

  const handleMoveSuite = async (suiteId: string, areaId: string | null) => {
    await moveSuiteToArea(suiteId, areaId);
    router.refresh();
  };

  const handleMoveArea = async (areaId: string, newParentId: string | null) => {
    await moveArea(areaId, newParentId);
    router.refresh();
  };

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const result = await startRemoteRouteScan(repositoryId, selectedBranch);
      if (result.success) {
        toast.success(`${result.routesFound} routes found!`);
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to scan routes');
      }
    } finally {
      setIsScanning(false);
    }
  };

  // Collect all suites (sorted and unsorted) for the detail section
  const allSuites: SuiteItem[] = [
    ...unsortedSuites,
    ...collectSuites(tree),
  ];

  function collectSuites(items: FunctionalAreaWithChildren[]): SuiteItem[] {
    const result: SuiteItem[] = [];
    for (const item of items) {
      result.push(...item.suites);
      result.push(...collectSuites(item.children));
    }
    return result;
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
      {/* Left Sidebar - Area Tree */}
      <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%" className="bg-muted/30 h-full overflow-hidden">
        <AreaTree
          tree={tree}
          uncategorizedTests={uncategorizedTests}
          unsortedSuites={unsortedSuites}
          selection={selection}
          onSelect={setSelection}
          onNewArea={handleNewArea}
          onEditArea={(id) => setSelection({ type: 'area', id })}
          onDeleteArea={setDeleteAreaId}
          onMoveTest={handleMoveTest}
          onMoveSuite={handleMoveSuite}
          onMoveArea={handleMoveArea}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />

      {/* Main Content */}
      <ResizablePanel defaultSize="80%" className="overflow-auto">
        <div className="p-6">
        <div className="max-w-3xl space-y-6">
          {/* Discovery Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Discovery Actions</CardTitle>
              <CardDescription>
                Discover and import routes using these tools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3">
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center disabled:opacity-50"
                >
                  {isScanning ? (
                    <Loader2 className="h-6 w-6 text-primary animate-spin" />
                  ) : (
                    <FolderSearch className="h-6 w-6 text-primary" />
                  )}
                  <span className="font-medium text-sm">Scan Routes</span>
                  <span className="text-xs text-muted-foreground">Discover from repo</span>
                </button>
                <button
                  onClick={() => setShowSpecAnalysisDialog(true)}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <FileText className="h-6 w-6 text-primary" />
                  <span className="font-medium text-sm">Analyze Specs</span>
                  <span className="text-xs text-muted-foreground">Parse API/route specs</span>
                </button>
                <button
                  onClick={() => setShowImportFromSpecDialog(true)}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <BookOpen className="h-6 w-6 text-primary" />
                  <span className="font-medium text-sm">Import Spec</span>
                  <span className="text-xs text-muted-foreground">US/AC to tests</span>
                </button>
                <button
                  onClick={() => setShowAIScanDialog(true)}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <Sparkles className="h-6 w-6 text-primary" />
                  <span className="font-medium text-sm">AI Scan</span>
                  <span className="text-xs text-muted-foreground">AI-powered discovery</span>
                </button>
                <button
                  onClick={() => setShowMCPExploreDialog(true)}
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <Globe className="h-6 w-6 text-primary" />
                  <span className="font-medium text-sm">MCP Explore</span>
                  <span className="text-xs text-muted-foreground">MCP-based exploration</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Areas Overview</CardTitle>
              <CardDescription>
                Organize your tests and suites into functional areas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Coverage progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Test coverage</span>
                  <span className={cn('font-semibold', getCoverageColor(coverage.rate))}>
                    {coverage.executed}/{coverage.total} tested ({coverage.rate}%)
                  </span>
                </div>
                <Progress
                  value={coverage.rate}
                  className={cn('h-2.5', getCoverageBarClass(coverage.rate))}
                />
              </div>

              {/* Status breakdown */}
              <div className="grid grid-cols-4 gap-3">
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                  <div>
                    <div className="text-lg font-bold leading-none">{coverage.passed}</div>
                    <div className="text-xs text-muted-foreground">Passed</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <X className="h-4 w-4 text-red-500 shrink-0" />
                  <div>
                    <div className="text-lg font-bold leading-none">{coverage.failed}</div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-lg font-bold leading-none">{coverage.notRun}</div>
                    <div className="text-xs text-muted-foreground">Not Run</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <FileWarning className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <div className="text-lg font-bold leading-none">{coverage.placeholders}</div>
                    <div className="text-xs text-muted-foreground">Placeholders</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <AreaDetailSection
            selection={selection}
            areas={tree}
            suites={allSuites}
            repositoryId={repositoryId}
            onUpdate={() => router.refresh()}
            onDeleteArea={setDeleteAreaId}
          />
        </div>
        </div>
      </ResizablePanel>

      {/* New Area Dialog */}
      <Dialog open={isNewAreaOpen} onOpenChange={setIsNewAreaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Area</DialogTitle>
            <DialogDescription>
              {newAreaParentId
                ? 'Create a new sub-folder inside the selected area'
                : 'Create a new top-level area'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="area-name">Name</Label>
              <Input
                id="area-name"
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                placeholder="e.g., Authentication, Dashboard"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="area-description">Description (optional)</Label>
              <Textarea
                id="area-description"
                value={newAreaDescription}
                onChange={(e) => setNewAreaDescription(e.target.value)}
                placeholder="What tests belong in this area?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewAreaOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateArea} disabled={isCreating || !newAreaName.trim()}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteAreaId} onOpenChange={(open) => !open && setDeleteAreaId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Area</DialogTitle>
            <DialogDescription>
              What would you like to do with the tests, suites, and sub-folders inside this area?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button
              variant="outline"
              onClick={() => handleDeleteArea(false)}
              disabled={isDeleting}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{isDeleting ? 'Deleting...' : 'Delete area only'}</div>
                <div className="text-xs text-muted-foreground font-normal">Move contents to Unsorted and sub-folders to root</div>
              </div>
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteArea(true)}
              disabled={isDeleting}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{isDeleting ? 'Deleting...' : 'Delete everything'}</div>
                <div className="text-xs font-normal opacity-90">Remove the area and all its tests, suites, and sub-folders</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discovery Dialogs */}
      <AIScanRoutesDialog
        open={showAIScanDialog}
        onOpenChange={setShowAIScanDialog}
        repositoryId={repositoryId}
        branch={selectedBranch}
        onSaved={() => router.refresh()}
      />
      <SpecAnalysisDialog
        open={showSpecAnalysisDialog}
        onOpenChange={setShowSpecAnalysisDialog}
        repositoryId={repositoryId}
        branch={selectedBranch}
      />
      <MCPExploreRoutesDialog
        open={showMCPExploreDialog}
        onOpenChange={setShowMCPExploreDialog}
        repositoryId={repositoryId}
        onSaved={() => router.refresh()}
      />
      <ImportFromSpecDialog
        open={showImportFromSpecDialog}
        onOpenChange={setShowImportFromSpecDialog}
        repositoryId={repositoryId}
        branch={selectedBranch}
        onComplete={() => router.refresh()}
      />
    </ResizablePanelGroup>
  );
}
