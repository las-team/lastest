'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AreaTree, type TreeSelection } from '@/components/areas/area-tree';
import { AreaDetailSection } from '@/components/areas/area-detail-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createArea, deleteArea, deleteAreaWithContents, moveTestToArea, moveSuiteToArea, moveArea, exportAllPlans, updateAreaPlan } from '@/server/actions/areas';
import { deleteTest } from '@/server/actions/tests';
import { FolderSearch, Sparkles, FileText, Loader2, BookOpen, Check, X, Circle, FileWarning, GitCompare, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { downloadMarkdown, timeAgo } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { startRemoteRouteScan } from '@/server/actions/scanner';
import { AIScanRoutesDialog } from '@/components/ai/ai-scan-routes-dialog';
import { SpecAnalysisDialog } from '@/components/ai/spec-analysis-dialog';
import { AreaSpecsPanel } from '@/components/areas/area-specs-panel';
import { ImportFromSpecDialog } from '@/components/ai/import-from-spec-dialog';
import { CodeDiffScanDialog } from '@/components/ai/code-diff-scan-dialog';
import { toast } from 'sonner';
import type { TestSpec } from '@/lib/db/schema';
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
  uncategorizedTests: { id: string; name: string; description: string | null; latestStatus: string | null }[];
  unsortedSuites: SuiteItem[];
  repositoryId: string;
  selectedBranch: string;
  banAiMode?: boolean;
  allSpecs?: TestSpec[];
}

export function AreasPageClient({ tree, uncategorizedTests, unsortedSuites, repositoryId, selectedBranch, banAiMode = false, allSpecs = [] }: AreasPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'plan' ? 'plan' : 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [selectedAreaIds, setSelectedAreaIds] = useState<Set<string>>(new Set());
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaParentId, setNewAreaParentId] = useState<string | undefined>();
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaDescription, setNewAreaDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteAreaId, setDeleteAreaId] = useState<string | null>(null);
  const [deleteAreaIds, setDeleteAreaIds] = useState<string[]>([]);
  const [deleteTestId, setDeleteTestId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showAIScanDialog, setShowAIScanDialog] = useState(false);
  const [showSpecAnalysisDialog, setShowSpecAnalysisDialog] = useState(false);
  const [showImportFromSpecDialog, setShowImportFromSpecDialog] = useState(false);
  const [showCodeDiffDialog, setShowCodeDiffDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // When Plan tab is active and tree item is clicked, scroll to that area's plan editor
  const handleTreeSelect = useCallback((sel: TreeSelection | null) => {
    setSelection(sel);
    if (activeTab === 'plan' && sel?.type === 'area') {
      setTimeout(() => {
        const el = document.getElementById(`plan-area-${sel.id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [activeTab]);

  // Delete key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && !deleteAreaId && !deleteAreaIds.length && !deleteTestId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (selectedAreaIds.size > 0) {
          setDeleteAreaIds(Array.from(selectedAreaIds));
        } else if (selection?.type === 'area') {
          setDeleteAreaId(selection.id);
        } else if (selection?.type === 'test') {
          setDeleteTestId(selection.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, deleteAreaId, deleteAreaIds, deleteTestId, selectedAreaIds]);

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

  const handleDeleteMultipleAreas = async (withContents: boolean) => {
    if (!deleteAreaIds.length) return;
    setIsDeleting(true);
    try {
      for (const id of deleteAreaIds) {
        if (withContents) {
          await deleteAreaWithContents(id);
        } else {
          await deleteArea(id);
        }
      }
      if (selection?.type === 'area' && deleteAreaIds.includes(selection.id)) {
        setSelection(null);
      }
      setDeleteAreaIds([]);
      setSelectedAreaIds(new Set());
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteTest = async () => {
    if (!deleteTestId) return;
    setIsDeleting(true);
    try {
      await deleteTest(deleteTestId);
      if (selection?.type === 'test' && selection.id === deleteTestId) {
        setSelection(null);
      }
      setDeleteTestId(null);
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

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      const md = await exportAllPlans(repositoryId);
      downloadMarkdown(md, 'testing-manifesto.md');
      toast.success('Manifesto exported');
    } catch {
      toast.error('Failed to export');
    } finally {
      setIsExporting(false);
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

  // Flatten tree for plan tab
  function flattenAreas(items: FunctionalAreaWithChildren[], depth = 0): Array<FunctionalAreaWithChildren & { depth: number }> {
    const result: Array<FunctionalAreaWithChildren & { depth: number }> = [];
    for (const item of items) {
      result.push({ ...item, depth });
      result.push(...flattenAreas(item.children, depth + 1));
    }
    return result;
  }

  const flatAreas = flattenAreas(tree);
  const areasWithPlans = flatAreas;

  // Group specs by area for the plan tab
  const specsByArea = new Map<string, TestSpec[]>();
  for (const spec of allSpecs) {
    if (spec.functionalAreaId) {
      const existing = specsByArea.get(spec.functionalAreaId) || [];
      existing.push(spec);
      specsByArea.set(spec.functionalAreaId, existing);
    }
  }
  const specsWithTests = allSpecs.filter(s => s.testId != null).length;

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
      {/* Left Sidebar - Area Tree */}
      <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%" className="bg-muted/30 h-full overflow-hidden">
        <AreaTree
          tree={tree}
          uncategorizedTests={uncategorizedTests}
          unsortedSuites={unsortedSuites}
          selection={selection}
          selectedAreaIds={selectedAreaIds}
          onSelect={handleTreeSelect}
          onMultiSelect={setSelectedAreaIds}
          onNewArea={handleNewArea}
          onEditArea={(id) => setSelection({ type: 'area', id })}
          onDeleteArea={setDeleteAreaId}
          onDeleteMultipleAreas={setDeleteAreaIds}
          onMoveTest={handleMoveTest}
          onMoveSuite={handleMoveSuite}
          onMoveArea={handleMoveArea}
          onDeleteTest={setDeleteTestId}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />

      {/* Main Content */}
      <ResizablePanel defaultSize="80%" className="overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 pt-4 pb-0 shrink-0">
            <TabsList className="h-11 w-full max-w-3xl p-1 bg-white dark:bg-zinc-950 border">
              <TabsTrigger value="overview" className="flex-1 px-6 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                Overview
              </TabsTrigger>
              <TabsTrigger value="plan" className="flex-1 px-6 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                Plan
                {areasWithPlans.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] data-[state=active]:bg-primary-foreground/20 data-[state=active]:text-primary-foreground">
                    {areasWithPlans.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="overflow-auto flex-1">
            <div className="p-6 pt-2">
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
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
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
                      {!banAiMode && (
                        <>
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
                            <span className="font-medium text-sm">Discover Areas</span>
                            <span className="text-xs text-muted-foreground">AI-powered discovery</span>
                          </button>
                          <button
                            onClick={() => setShowCodeDiffDialog(true)}
                            className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                          >
                            <GitCompare className="h-6 w-6 text-primary" />
                            <span className="font-medium text-sm">Code Diff</span>
                            <span className="text-xs text-muted-foreground">Branch changes</span>
                          </button>
                        </>
                      )}
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
          </TabsContent>

          {/* Plan Tab */}
          <TabsContent value="plan" className="overflow-auto flex-1">
            <div className="p-6 pt-2">
              <div className="max-w-4xl">
                {/* Plan tab header */}
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-sm text-muted-foreground">
                    {areasWithPlans.length} area{areasWithPlans.length !== 1 ? 's' : ''}
                  </div>
                  {allSpecs.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Spec coverage: <span className="font-medium text-foreground">{specsWithTests}/{allSpecs.length}</span> ({allSpecs.length > 0 ? Math.round((specsWithTests / allSpecs.length) * 100) : 0}%)
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportAll}
                    disabled={isExporting || areasWithPlans.length === 0}
                  >
                    {isExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                    Export Manifesto
                  </Button>
                </div>

                <div className="divide-y">
                  {areasWithPlans.map((area) => (
                    <div key={area.id}>
                      <PlanAreaEditor
                        areaId={area.id}
                        areaName={area.name}
                        description={area.description}
                        agentPlan={area.agentPlan || ''}
                        planGeneratedAt={area.planGeneratedAt}
                        depth={area.depth}
                      />
                      <div className="px-4 pb-4">
                        <AreaSpecsPanel
                          areaId={area.id}
                          repositoryId={repositoryId}
                          specs={specsByArea.get(area.id) || []}
                          hasAgentPlan={!!area.agentPlan}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
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

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={deleteAreaIds.length > 0} onOpenChange={(open) => !open && setDeleteAreaIds([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteAreaIds.length} Areas</DialogTitle>
            <DialogDescription>
              What would you like to do with the tests, suites, and sub-folders inside these areas?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button
              variant="outline"
              onClick={() => handleDeleteMultipleAreas(false)}
              disabled={isDeleting}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{isDeleting ? 'Deleting...' : 'Delete areas only'}</div>
                <div className="text-xs text-muted-foreground font-normal">Move contents to Unsorted and sub-folders to root</div>
              </div>
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteMultipleAreas(true)}
              disabled={isDeleting}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{isDeleting ? 'Deleting...' : 'Delete everything'}</div>
                <div className="text-xs font-normal opacity-90">Remove all {deleteAreaIds.length} areas and their tests, suites, and sub-folders</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Test Confirmation Dialog */}
      <Dialog open={!!deleteTestId} onOpenChange={(open) => !open && setDeleteTestId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this test? It will be soft-deleted and can be restored later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTestId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTest}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
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
      <ImportFromSpecDialog
        open={showImportFromSpecDialog}
        onOpenChange={setShowImportFromSpecDialog}
        repositoryId={repositoryId}
        branch={selectedBranch}
        onComplete={() => router.refresh()}
      />
      <CodeDiffScanDialog
        open={showCodeDiffDialog}
        onOpenChange={setShowCodeDiffDialog}
        repositoryId={repositoryId}
        onSaved={() => router.refresh()}
      />
    </ResizablePanelGroup>
  );
}

function PlanAreaEditor({
  areaId,
  areaName,
  description,
  agentPlan,
  planGeneratedAt,
  depth,
}: {
  areaId: string;
  areaName: string;
  description: string | null;
  agentPlan: string;
  planGeneratedAt: Date | null;
  depth: number;
}) {
  const [content, setContent] = useState(agentPlan);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(agentPlan);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Auto-resize on mount
  useEffect(() => {
    autoResize(textareaRef.current);
  }, [autoResize]);

  const doSave = useCallback(async (text: string) => {
    if (text === lastSavedRef.current) return;
    setSaving(true);
    try {
      await updateAreaPlan(areaId, text);
      lastSavedRef.current = text;
    } catch {
      toast.error(`Failed to save plan for ${areaName}`);
    } finally {
      setSaving(false);
    }
  }, [areaId, areaName]);

  const handleChange = (value: string) => {
    setContent(value);
    autoResize(textareaRef.current);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(value), 500);
  };

  // Save on unmount if pending
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div id={`plan-area-${areaId}`} className="py-3 space-y-1.5" style={{ paddingLeft: depth > 0 ? `${depth * 16}px` : undefined }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold">{areaName}</h3>
          {planGeneratedAt && (
            <span className="text-[10px] text-muted-foreground">{timeAgo(planGeneratedAt)}</span>
          )}
        </div>
        {saving && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        className="font-mono text-[11px] resize-none overflow-hidden min-h-[2lh] border-muted/60"
        placeholder="No plan content yet..."
      />
    </div>
  );
}
