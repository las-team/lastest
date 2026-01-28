'use client';

import { useState } from 'react';
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
import { createArea, deleteArea, moveTestToArea, moveSuiteToArea, moveArea } from '@/server/actions/areas';
import { Folder, FolderTree, FileCode, ListChecks, FolderSearch, Sparkles, Globe, FileText, Loader2 } from 'lucide-react';
import { startRemoteRouteScan } from '@/server/actions/scanner';
import { AIScanRoutesDialog } from '@/components/ai/ai-scan-routes-dialog';
import { SpecAnalysisDialog } from '@/components/ai/spec-analysis-dialog';
import { MCPExploreRoutesDialog } from '@/components/ai/mcp-explore-routes-dialog';
import { toast } from 'sonner';
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

  const totalAreas = countAreas(tree);
  const totalTests = countTests(tree) + uncategorizedTests.length;
  const totalSuites = countSuites(tree) + unsortedSuites.length;

  function countAreas(items: FunctionalAreaWithChildren[]): number {
    return items.reduce((acc, item) => acc + 1 + countAreas(item.children), 0);
  }

  function countTests(items: FunctionalAreaWithChildren[]): number {
    return items.reduce((acc, item) => acc + item.tests.length + countTests(item.children), 0);
  }

  function countSuites(items: FunctionalAreaWithChildren[]): number {
    return items.reduce((acc, item) => acc + item.suites.length + countSuites(item.children), 0);
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

  const handleDeleteArea = async () => {
    if (!deleteAreaId) return;
    setIsDeleting(true);
    try {
      await deleteArea(deleteAreaId);
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
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar - Area Tree */}
      <div className="w-72 border-r bg-muted/30">
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
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 overflow-auto">
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
              <div className="grid grid-cols-4 gap-4">
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
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <FolderTree className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <div className="text-2xl font-bold">{totalAreas}</div>
                  <div className="text-sm text-muted-foreground">Areas</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <FileCode className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <div className="text-2xl font-bold">{totalTests}</div>
                  <div className="text-sm text-muted-foreground">Tests</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <ListChecks className="h-8 w-8 mx-auto mb-2 text-violet-500" />
                  <div className="text-2xl font-bold">{totalSuites}</div>
                  <div className="text-sm text-muted-foreground">Suites</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <Folder className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <div className="text-2xl font-bold">{uncategorizedTests.length}</div>
                  <div className="text-sm text-muted-foreground">Uncategorized</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <AreaDetailSection
            selection={selection}
            areas={tree}
            suites={allSuites}
            onUpdate={() => router.refresh()}
          />
        </div>
      </div>

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
              Are you sure you want to delete this area? Tests and suites in this area will be moved to Unsorted, and sub-folders will be moved to the root level.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAreaId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteArea}
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
      <MCPExploreRoutesDialog
        open={showMCPExploreDialog}
        onOpenChange={setShowMCPExploreDialog}
        repositoryId={repositoryId}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
