'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePreferredRunner } from '@/hooks/use-preferred-runner';
import { AreaTree, type TreeSelection } from '@/components/areas/area-tree';
import { AreaSpecsPanel } from '@/components/areas/area-specs-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { RouteSelectorDialog } from '@/components/routes/route-selector-dialog';
import { AICreateTestDialog } from '@/components/ai/ai-create-test-dialog';
import { AIScanRoutesDialog } from '@/components/ai/ai-scan-routes-dialog';
import { SpecAnalysisDialog } from '@/components/ai/spec-analysis-dialog';
import { ImportFromSpecDialog } from '@/components/ai/import-from-spec-dialog';
import { CodeDiffScanDialog } from '@/components/ai/code-diff-scan-dialog';
import { createArea, deleteArea, deleteAreaWithContents, moveTestToArea, moveSuiteToArea, moveArea, exportAllPlans, updateAreaPlan, updateArea } from '@/server/actions/areas';
import { deleteTests, restoreTests, permanentlyDeleteTests, getTest, createTest, getTestDetailData } from '@/server/actions/tests';
import { TestDetailClient } from '@/app/(app)/tests/[id]/test-detail-client';
import { runTests } from '@/server/actions/runs';
import { aiFixAllFailedTests, aiFixTests } from '@/server/actions/ai';
import { startRemoteRouteScan, generateBasicTests } from '@/server/actions/scanner';
import { toast } from 'sonner';
import { downloadMarkdown, timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  FolderSearch,
  Sparkles,
  FileText,
  Loader2,
  BookOpen,
  GitCompare,
  Download,
  FlaskConical,
  Plus,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Play,
  Trash2,
  X,
  RotateCcw,
  Pencil,
  FolderPlus,
  Folder,
  FileCode,
  Save,
  ExternalLink,
} from 'lucide-react';
import type { FunctionalArea, Test, Route, TestSpec } from '@/lib/db/schema';
import type { FunctionalAreaWithChildren } from '@/lib/db/queries';

interface TestWithStatus extends Test {
  latestStatus: string | null;
}

interface SuiteItem {
  id: string;
  name: string;
  description: string | null;
  testCount: number;
}

interface DefinitionPageClientProps {
  tree: FunctionalAreaWithChildren[];
  uncategorizedTests: { id: string; name: string; description: string | null; latestStatus: string | null; isPlaceholder: boolean }[];
  unsortedSuites: SuiteItem[];
  repositoryId: string;
  selectedBranch: string;
  banAiMode: boolean;
  allSpecs: TestSpec[];
  earlyAdopterMode?: boolean;
  areas: FunctionalArea[];
  tests: TestWithStatus[];
  routes: Route[];
  baseUrl: string;
  deletedTests: Test[];
}

// Collect all test IDs recursively from an area subtree
function collectTestIdsFromArea(area: FunctionalAreaWithChildren): Set<string> {
  const ids = new Set<string>();
  for (const t of area.tests) ids.add(t.id);
  for (const child of area.children) {
    for (const id of collectTestIdsFromArea(child)) ids.add(id);
  }
  return ids;
}

function findAreaInTree(areas: FunctionalAreaWithChildren[], id: string): FunctionalAreaWithChildren | null {
  for (const area of areas) {
    if (area.id === id) return area;
    const found = findAreaInTree(area.children, id);
    if (found) return found;
  }
  return null;
}

// Build breadcrumb path from root to target area
function buildBreadcrumb(areas: FunctionalAreaWithChildren[], targetId: string): { id: string; name: string }[] {
  function search(items: FunctionalAreaWithChildren[], path: { id: string; name: string }[]): { id: string; name: string }[] | null {
    for (const area of items) {
      const current = [...path, { id: area.id, name: area.name }];
      if (area.id === targetId) return current;
      const found = search(area.children, current);
      if (found) return found;
    }
    return null;
  }
  return search(areas, []) || [];
}

export function DefinitionPageClient({
  tree,
  uncategorizedTests,
  unsortedSuites,
  repositoryId,
  selectedBranch,
  banAiMode,
  allSpecs,
  earlyAdopterMode = false,
  areas,
  tests,
  routes,
  baseUrl,
  deletedTests,
}: DefinitionPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notifyJobStarted = useNotifyJobStarted();
  const initialTab = searchParams.get('tab') === 'plan' ? 'plan' : 'tests';

  // --- Tree state (from Areas page) ---
  const [treeSelection, setTreeSelection] = useState<TreeSelection | null>(null);
  const [selectedAreaIds, setSelectedAreaIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState(initialTab);

  // --- Discovery state ---
  const [isScanning, setIsScanning] = useState(false);
  const [showAIScanDialog, setShowAIScanDialog] = useState(false);
  const [showSpecAnalysisDialog, setShowSpecAnalysisDialog] = useState(false);
  const [showImportFromSpecDialog, setShowImportFromSpecDialog] = useState(false);
  const [showCodeDiffDialog, setShowCodeDiffDialog] = useState(false);

  // --- Area CRUD state ---
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaParentId, setNewAreaParentId] = useState<string | undefined>();
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaDescription, setNewAreaDescription] = useState('');
  const [isCreatingArea, setIsCreatingArea] = useState(false);
  const [deleteAreaId, setDeleteAreaId] = useState<string | null>(null);
  const [deleteAreaIds, setDeleteAreaIds] = useState<string[]>([]);
  const [deleteTestId, setDeleteTestId] = useState<string | null>(null);
  const [isDeletingArea, setIsDeletingArea] = useState(false);

  // --- Area detail/edit state ---
  const [isEditingArea, setIsEditingArea] = useState(false);
  const [isSavingArea, setIsSavingArea] = useState(false);
  const [editAreaName, setEditAreaName] = useState('');
  const [editAreaDescription, setEditAreaDescription] = useState('');
  const [isCreatingPlaceholder, setIsCreatingPlaceholder] = useState(false);
  const [newPlaceholderName, setNewPlaceholderName] = useState('');
  const [isSubmittingPlaceholder, setIsSubmittingPlaceholder] = useState(false);

  // --- Inline test detail state ---
  const [openTestId, setOpenTestId] = useState<string | null>(null);
  const [openTestData, setOpenTestData] = useState<Test | null>(null);
  const [openTestDetailData, setOpenTestDetailData] = useState<Awaited<ReturnType<typeof getTestDetailData>> | null>(null);
  const [isLoadingTestDetail, setIsLoadingTestDetail] = useState(false);

  // --- Test list state (from Tests page) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed' | 'pending'>('all');
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const [executionTarget, setExecutionTarget] = usePreferredRunner();
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkFixing, setIsBulkFixing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixed: number; failed: number } | null>(null);
  const [isAddTestsOpen, setIsAddTestsOpen] = useState(false);
  const [isAICreateOpen, setIsAICreateOpen] = useState(false);

  // --- Deleted tests state ---
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedDeletedIds, setSelectedDeletedIds] = useState<Set<string>>(new Set());
  const [isRestoring, setIsRestoring] = useState(false);
  const [isPermanentlyDeleting, setIsPermanentlyDeleting] = useState(false);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false);
  const lastSelectedDeletedIdRef = useRef<string | null>(null);

  // --- Plan state ---
  const [isExporting, setIsExporting] = useState(false);

  // Clear test selection and reset editing when tree selection changes
  useEffect(() => {
    setSelectedTestIds(new Set());
    setFixResult(null);
    setIsEditingArea(false);
    setIsCreatingPlaceholder(false);
    setNewPlaceholderName('');
    setOpenTestId(null);
    setOpenTestData(null);
    setOpenTestDetailData(null);

    // Populate area edit fields
    if (treeSelection?.type === 'area') {
      const area = findAreaInTree(tree, treeSelection.id);
      if (area) {
        setEditAreaName(area.name);
        setEditAreaDescription(area.description || '');
      }
    }
  }, [treeSelection, tree]);

  // Escape key to clear tree selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        setTreeSelection(null);
        setSelectedAreaIds(new Set());
      }
      if (e.key === 'Delete' && !deleteAreaId && !deleteAreaIds.length && !deleteTestId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (selectedAreaIds.size > 0) {
          setDeleteAreaIds(Array.from(selectedAreaIds));
        } else if (treeSelection?.type === 'area') {
          setDeleteAreaId(treeSelection.id);
        } else if (treeSelection?.type === 'test') {
          setDeleteTestId(treeSelection.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [treeSelection, deleteAreaId, deleteAreaIds, deleteTestId, selectedAreaIds]);

  // --- Compute filtered tests based on tree selection ---
  const areaTestIds = useMemo(() => {
    if (!treeSelection || treeSelection.type !== 'area') return null;
    const area = findAreaInTree(tree, treeSelection.id);
    if (!area) return null;
    return collectTestIdsFromArea(area);
  }, [treeSelection, tree]);

  const scopedTests = useMemo(() => {
    if (treeSelection?.type === 'area' && areaTestIds) {
      return tests.filter(t => areaTestIds.has(t.id));
    }
    return tests;
  }, [tests, treeSelection, areaTestIds]);

  const filteredTests = useMemo(() => {
    return scopedTests.filter(test => {
      const matchesSearch = test.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'passed') return test.latestStatus === 'passed';
      if (statusFilter === 'failed') return test.latestStatus === 'failed';
      if (statusFilter === 'pending') return !test.latestStatus;
      return true;
    });
  }, [scopedTests, searchQuery, statusFilter]);

  const failedScopedTests = useMemo(() => scopedTests.filter(t => t.latestStatus === 'failed'), [scopedTests]);

  const selectedFailedTests = useMemo(() => {
    return Array.from(selectedTestIds).filter(id => {
      const test = tests.find(t => t.id === id);
      return test?.latestStatus === 'failed';
    });
  }, [selectedTestIds, tests]);

  const breadcrumb = useMemo(() => {
    if (treeSelection?.type === 'area') {
      return buildBreadcrumb(tree, treeSelection.id);
    }
    // When a test is open, show its area's breadcrumb
    if (openTestId && openTestData?.functionalAreaId) {
      return buildBreadcrumb(tree, openTestData.functionalAreaId);
    }
    return [];
  }, [treeSelection, tree, openTestId, openTestData]);

  // Uncovered routes (from Tests page)
  const areasWithActiveTests = useMemo(() => new Set(tests.map(t => t.functionalAreaId).filter(Boolean)), [tests]);
  const uncoveredRoutes = useMemo(() => {
    return routes.length > 0
      ? routes.filter(r => !r.hasTest)
      : areas
          .filter(a => a.name.startsWith('/') && !areasWithActiveTests.has(a.id))
          .map(a => ({
            id: a.id,
            repositoryId: a.repositoryId,
            path: a.name,
            type: a.name.includes('[') ? 'dynamic' : 'static',
            description: a.description,
            filePath: null,
            framework: null,
            routerType: null,
            functionalAreaId: a.id,
            hasTest: false,
            scannedAt: null,
          } as Route));
  }, [routes, areas, areasWithActiveTests]);

  // Stats computation
  const statsData = useMemo(() => {
    const passed = scopedTests.filter(t => t.latestStatus === 'passed').length;
    const failed = scopedTests.filter(t => t.latestStatus === 'failed').length;
    const pending = scopedTests.filter(t => !t.latestStatus).length;
    return [
      { label: 'Total', value: scopedTests.length, color: 'text-foreground', filter: 'all' as const },
      { label: 'Passed', value: passed, color: 'text-emerald-600 dark:text-emerald-400', filter: 'passed' as const },
      { label: 'Failed', value: failed, color: 'text-rose-600 dark:text-rose-400', filter: 'failed' as const },
      { label: 'Pending', value: pending, color: 'text-muted-foreground', filter: 'pending' as const },
    ];
  }, [scopedTests]);

  const allFilteredSelected = filteredTests.length > 0 && filteredTests.every(t => selectedTestIds.has(t.id));

  const getAreaName = useCallback((areaId: string | null) => {
    if (!areaId) return null;
    return areas.find(a => a.id === areaId)?.name;
  }, [areas]);

  // --- Handlers ---

  const handleTreeSelect = useCallback((sel: TreeSelection | null) => {
    setTreeSelection(sel);
    if (activeTab === 'plan' && sel?.type === 'area') {
      setTimeout(() => {
        const el = document.getElementById(`plan-area-${sel.id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [activeTab]);

  const handleNewArea = (parentId?: string) => {
    setNewAreaParentId(parentId);
    setNewAreaName('');
    setNewAreaDescription('');
    setIsNewAreaOpen(true);
  };

  const handleCreateArea = async () => {
    if (!newAreaName.trim()) return;
    setIsCreatingArea(true);
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
      setIsCreatingArea(false);
    }
  };

  const handleDeleteArea = async (withContents: boolean) => {
    if (!deleteAreaId) return;
    setIsDeletingArea(true);
    try {
      if (withContents) await deleteAreaWithContents(deleteAreaId);
      else await deleteArea(deleteAreaId);
      if (treeSelection?.type === 'area' && treeSelection.id === deleteAreaId) setTreeSelection(null);
      setDeleteAreaId(null);
      router.refresh();
    } finally {
      setIsDeletingArea(false);
    }
  };

  const handleDeleteMultipleAreas = async (withContents: boolean) => {
    if (!deleteAreaIds.length) return;
    setIsDeletingArea(true);
    try {
      for (const id of deleteAreaIds) {
        if (withContents) await deleteAreaWithContents(id);
        else await deleteArea(id);
      }
      if (treeSelection?.type === 'area' && deleteAreaIds.includes(treeSelection.id)) setTreeSelection(null);
      setDeleteAreaIds([]);
      setSelectedAreaIds(new Set());
      router.refresh();
    } finally {
      setIsDeletingArea(false);
    }
  };

  const handleDeleteTest = async () => {
    if (!deleteTestId) return;
    setIsDeletingArea(true);
    try {
      await deleteTests([deleteTestId]);
      if (treeSelection?.type === 'test' && treeSelection.id === deleteTestId) setTreeSelection(null);
      setDeleteTestId(null);
      router.refresh();
    } finally {
      setIsDeletingArea(false);
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

  // Area edit handlers
  const handleSaveArea = async () => {
    if (!treeSelection || treeSelection.type !== 'area') return;
    setIsSavingArea(true);
    try {
      await updateArea(treeSelection.id, {
        name: editAreaName,
        description: editAreaDescription || undefined,
      });
      setIsEditingArea(false);
      router.refresh();
    } finally {
      setIsSavingArea(false);
    }
  };

  const handleCancelEditArea = () => {
    if (treeSelection?.type === 'area') {
      const area = findAreaInTree(tree, treeSelection.id);
      if (area) {
        setEditAreaName(area.name);
        setEditAreaDescription(area.description || '');
      }
    }
    setIsEditingArea(false);
  };

  const PLACEHOLDER_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Placeholder test — record real interactions to replace this stub
  await page.goto(baseUrl);
  await page.screenshot({ path: screenshotPath });
}`;

  const handleCreatePlaceholder = async () => {
    if (!treeSelection || treeSelection.type !== 'area' || !newPlaceholderName.trim()) return;
    setIsSubmittingPlaceholder(true);
    try {
      await createTest({
        name: newPlaceholderName.trim(),
        code: PLACEHOLDER_CODE,
        isPlaceholder: true,
        repositoryId,
        functionalAreaId: treeSelection.id,
      });
      setNewPlaceholderName('');
      setIsCreatingPlaceholder(false);
      router.refresh();
    } finally {
      setIsSubmittingPlaceholder(false);
    }
  };

  // Inline test detail handlers
  const handleOpenTest = async (testId: string) => {
    if (openTestId === testId) {
      setOpenTestId(null);
      setOpenTestData(null);
      setOpenTestDetailData(null);
      return;
    }
    setOpenTestId(testId);
    setOpenTestData(null);
    setOpenTestDetailData(null);
    setIsLoadingTestDetail(true);
    try {
      const data = await getTestDetailData(testId, repositoryId);
      if (data) {
        setOpenTestData(data.test);
        setOpenTestDetailData(data);
      }
    } finally {
      setIsLoadingTestDetail(false);
    }
  };

  // Test list handlers
  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedTestIds(new Set());
    else setSelectedTestIds(new Set(filteredTests.map(t => t.id)));
  };

  const toggleSelect = (id: string, shiftKey = false) => {
    const newSet = new Set(selectedTestIds);
    if (shiftKey && lastSelectedIdRef.current) {
      const lastIdx = filteredTests.findIndex(t => t.id === lastSelectedIdRef.current);
      const currIdx = filteredTests.findIndex(t => t.id === id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
        for (let i = start; i <= end; i++) newSet.add(filteredTests[i].id);
      }
    } else {
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
    }
    lastSelectedIdRef.current = id;
    setSelectedTestIds(newSet);
  };

  const handleBulkRun = async () => {
    if (selectedTestIds.size === 0) return;
    setIsBulkRunning(true);
    try {
      const result = await runTests(Array.from(selectedTestIds), repositoryId, true, executionTarget);
      notifyJobStarted();
      if ('queued' in result && result.queued) toast.success('Tests queued — will run when current tests finish');
    } finally {
      setIsBulkRunning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTestIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      await deleteTests(Array.from(selectedTestIds));
      setSelectedTestIds(new Set());
      setShowDeleteConfirm(false);
      router.refresh();
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkFix = async () => {
    if (selectedFailedTests.length === 0) return;
    setIsBulkFixing(true);
    setFixResult(null);
    try {
      const result = await aiFixTests(selectedFailedTests, repositoryId);
      setFixResult({ fixed: result.fixed, failed: result.failed });
    } finally {
      setIsBulkFixing(false);
    }
  };

  const handleFixAllFailed = async () => {
    if (failedScopedTests.length === 0) return;
    setIsFixingAll(true);
    setFixResult(null);
    try {
      const result = await aiFixAllFailedTests(repositoryId);
      setFixResult({ fixed: result.fixed, failed: result.failed });
    } finally {
      setIsFixingAll(false);
    }
  };

  const handleAddTests = async (routeIds: string[]) => {
    await generateBasicTests(repositoryId, routeIds, baseUrl);
    router.refresh();
  };

  // Deleted tests handlers
  const toggleDeletedSelect = (id: string, shiftKey = false) => {
    const newSet = new Set(selectedDeletedIds);
    if (shiftKey && lastSelectedDeletedIdRef.current) {
      const lastIdx = deletedTests.findIndex(t => t.id === lastSelectedDeletedIdRef.current);
      const currIdx = deletedTests.findIndex(t => t.id === id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
        for (let i = start; i <= end; i++) newSet.add(deletedTests[i].id);
      }
    } else {
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
    }
    lastSelectedDeletedIdRef.current = id;
    setSelectedDeletedIds(newSet);
  };

  const handleBulkRestore = async () => {
    if (selectedDeletedIds.size === 0) return;
    setIsRestoring(true);
    try {
      await restoreTests(Array.from(selectedDeletedIds));
      setSelectedDeletedIds(new Set());
      router.refresh();
    } finally {
      setIsRestoring(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (selectedDeletedIds.size === 0) return;
    setIsPermanentlyDeleting(true);
    try {
      await permanentlyDeleteTests(Array.from(selectedDeletedIds));
      setSelectedDeletedIds(new Set());
      setShowPermanentDeleteConfirm(false);
      router.refresh();
    } finally {
      setIsPermanentlyDeleting(false);
    }
  };

  // Plan helpers
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

  function flattenAreas(items: FunctionalAreaWithChildren[], depth = 0): Array<FunctionalAreaWithChildren & { depth: number }> {
    const result: Array<FunctionalAreaWithChildren & { depth: number }> = [];
    for (const item of items) {
      result.push({ ...item, depth });
      result.push(...flattenAreas(item.children, depth + 1));
    }
    return result;
  }

  const flatAreas = flattenAreas(tree);

  const specsByArea = useMemo(() => {
    const map = new Map<string, TestSpec[]>();
    for (const spec of allSpecs) {
      if (spec.functionalAreaId) {
        const existing = map.get(spec.functionalAreaId) || [];
        existing.push(spec);
        map.set(spec.functionalAreaId, existing);
      }
    }
    return map;
  }, [allSpecs]);

  const specsWithTests = allSpecs.filter(s => s.testId != null).length;

  // Collect all suites
  function collectSuites(items: FunctionalAreaWithChildren[]): SuiteItem[] {
    const result: SuiteItem[] = [];
    for (const item of items) {
      result.push(...item.suites);
      result.push(...collectSuites(item.children));
    }
    return result;
  }

  // StatusBadge component
  const StatusBadge = ({ status }: { status: string | null }) => {
    if (status === 'passed') {
      return (
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Passed
        </Badge>
      );
    }
    if (status === 'failed') {
      return (
        <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock className="h-3 w-3 mr-1" />
        Not run
      </Badge>
    );
  };

  // Discovery icons for the AreaTree header
  const discoveryHeaderExtra = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleScan} disabled={isScanning}>
            {isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSearch className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Scan Routes</TooltipContent>
      </Tooltip>
      {!banAiMode && (
        <>
          {earlyAdopterMode && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSpecAnalysisDialog(true)}>
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Analyze Specs</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowImportFromSpecDialog(true)}>
                    <BookOpen className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Import Spec</TooltipContent>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAIScanDialog(true)}>
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Discover Areas</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowCodeDiffDialog(true)}>
                <GitCompare className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Code Diff</TooltipContent>
          </Tooltip>
        </>
      )}
    </>
  );

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
      {/* ─── Left Sidebar ─── */}
      <ResizablePanel defaultSize="22%" minSize="15%" maxSize="35%" className="bg-muted/30 h-full overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <AreaTree
            tree={tree}
            uncategorizedTests={uncategorizedTests}
            unsortedSuites={unsortedSuites}
            selection={treeSelection}
            selectedAreaIds={selectedAreaIds}
            onSelect={handleTreeSelect}
            onMultiSelect={setSelectedAreaIds}
            onNewArea={handleNewArea}
            onEditArea={(id) => setTreeSelection({ type: 'area', id })}
            onDeleteArea={setDeleteAreaId}
            onDeleteMultipleAreas={setDeleteAreaIds}
            onMoveTest={handleMoveTest}
            onMoveSuite={handleMoveSuite}
            onMoveArea={handleMoveArea}
            onDeleteTest={setDeleteTestId}
            headerExtra={discoveryHeaderExtra}
            addButtonClassName="text-primary hover:text-primary"
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ─── Main Content ─── */}
      <ResizablePanel defaultSize="78%" className="overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 pt-4 pb-0 shrink-0">
            <TabsList className="h-11 w-full max-w-5xl p-1 bg-white dark:bg-zinc-950 border">
              <TabsTrigger value="tests" className="flex-1 px-6 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                Tests
              </TabsTrigger>
              <TabsTrigger value="plan" className="flex-1 px-6 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                Plan
                {flatAreas.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] data-[state=active]:bg-primary-foreground/20 data-[state=active]:text-primary-foreground">
                    {flatAreas.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ─── Tests Tab ─── */}
          <TabsContent value="tests" className="overflow-auto flex-1 flex flex-col">
            <div className="px-6 pt-4 pb-2 shrink-0">
              <div className="max-w-5xl">
                {/* Breadcrumb + Action Toolbar */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5 text-sm min-w-0">
                    <button
                      onClick={() => { setTreeSelection(null); setSelectedAreaIds(new Set()); setOpenTestId(null); setOpenTestData(null); }}
                      className={cn(
                        'hover:text-primary transition-colors shrink-0',
                        !treeSelection && !openTestId ? 'text-foreground font-medium' : 'text-muted-foreground'
                      )}
                    >
                      All Tests
                    </button>
                    {breadcrumb.map((crumb) => (
                      <span key={crumb.id} className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        <button
                          onClick={() => { setTreeSelection({ type: 'area', id: crumb.id }); setOpenTestId(null); setOpenTestData(null); }}
                          className={cn(
                            'hover:text-primary transition-colors truncate max-w-[160px]',
                            treeSelection?.type === 'area' && treeSelection.id === crumb.id && !openTestId
                              ? 'text-foreground font-medium'
                              : 'text-muted-foreground'
                          )}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                    {openTestId && openTestData && (
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        <span className="text-foreground font-medium truncate max-w-[200px]">{openTestData.name}</span>
                      </span>
                    )}
                  </div>

                  {!openTestId && (
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Area-specific actions */}
                    {treeSelection?.type === 'area' && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleNewArea(treeSelection.id)}>
                          <FolderPlus className="h-3.5 w-3.5 mr-1" />
                          Sub-folder
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteAreaId(treeSelection.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <div className="w-px h-4 bg-border" />
                      </>
                    )}
                    {!banAiMode && failedScopedTests.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleFixAllFailed} disabled={isFixingAll}>
                        <Wrench className="h-3.5 w-3.5 mr-1" />
                        {isFixingAll ? 'Fixing...' : `Fix Failed (${failedScopedTests.length})`}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsAddTestsOpen(true)} disabled={uncoveredRoutes.length === 0}>
                      <FlaskConical className="h-3.5 w-3.5 mr-1" />
                      Add Basic
                    </Button>
                    {!banAiMode && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsAICreateOpen(true)}>
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                        Generate
                      </Button>
                    )}
                    <Button asChild size="sm" className="h-7 text-xs">
                      <Link href="/record">
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Record
                      </Link>
                    </Button>
                  </div>
                  )}
                </div>
              </div>
            </div>

            {/* Full test detail view (replaces list when a test is opened) */}
            {openTestId ? (
              isLoadingTestDetail ? (
                <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm flex-1">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading test...
                </div>
              ) : openTestDetailData ? (
                <div className="flex flex-col h-full flex-1">
                  <TestDetailClient
                    test={openTestDetailData.test}
                    results={openTestDetailData.results}
                    repositoryId={openTestDetailData.repositoryId}
                    screenshotGroups={openTestDetailData.screenshotGroups}
                    plannedScreenshots={openTestDetailData.plannedScreenshots}
                    defaultSetupSteps={openTestDetailData.defaultSetupSteps}
                    availableTests={openTestDetailData.availableTests}
                    availableScripts={openTestDetailData.availableScripts}
                    sheetDataSources={openTestDetailData.sheetDataSources}
                    stabilizationDefaults={openTestDetailData.stabilizationDefaults}
                    banAiMode={banAiMode}
                    earlyAdopterMode={true}
                    diffDefaults={openTestDetailData.diffDefaults}
                    playwrightDefaults={openTestDetailData.playwrightDefaults}
                    envBaseUrl={openTestDetailData.envBaseUrl}
                    testSpec={openTestDetailData.testSpec}
                    contentClassName="max-w-5xl mx-0"
                  />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground py-8 text-center flex-1">Failed to load test details</div>
              )
            ) : (
            <div className="px-6 pb-6 space-y-4 overflow-auto flex-1">
              <div className="max-w-5xl space-y-4">
                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-3">
                  {statsData.map((stat) => (
                    <button
                      key={stat.label}
                      type="button"
                      onClick={() => setStatusFilter(statusFilter === stat.filter ? 'all' : stat.filter)}
                      className={cn(
                        'p-3 rounded-lg bg-card border text-left transition-all duration-150 cursor-pointer',
                        statusFilter === stat.filter
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-border/50 hover:border-border'
                      )}
                    >
                      <div className={cn('text-2xl font-semibold tabular-nums', stat.color)}>
                        {stat.value}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                    </button>
                  ))}
                </div>

                {fixResult && (
                  <div className="text-sm p-3 rounded-lg bg-muted/50 border border-border/50">
                    Fixed {fixResult.fixed} test{fixResult.fixed !== 1 ? 's' : ''}.
                    {fixResult.failed > 0 && ` ${fixResult.failed} could not be fixed.`}
                  </div>
                )}

                {/* Area Detail Card */}
                {treeSelection?.type === 'area' && (() => {
                  const selectedArea = findAreaInTree(tree, treeSelection.id);
                  if (!selectedArea) return null;
                  return (
                    <Card className="border-border/50">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Folder className="h-4 w-4 text-primary" />
                          {isEditingArea ? 'Edit Area' : selectedArea.name}
                          {selectedArea.isRouteFolder && !isEditingArea && (
                            <Badge variant="secondary" className="text-[10px]">Route</Badge>
                          )}
                        </CardTitle>
                        {!isEditingArea ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIsCreatingPlaceholder(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add Test
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setIsEditingArea(true)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              Edit
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEditArea}>
                              <X className="h-3.5 w-3.5 mr-1" />
                              Cancel
                            </Button>
                            <Button size="sm" className="h-7 text-xs" onClick={handleSaveArea} disabled={isSavingArea}>
                              <Save className="h-3.5 w-3.5 mr-1" />
                              {isSavingArea ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0 space-y-3">
                        {isEditingArea ? (
                          <>
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-area-name" className="text-xs">Name</Label>
                              <Input id="edit-area-name" value={editAreaName} onChange={(e) => setEditAreaName(e.target.value)} className="h-8 text-sm" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-area-desc" className="text-xs">Description</Label>
                              <Textarea id="edit-area-desc" value={editAreaDescription} onChange={(e) => setEditAreaDescription(e.target.value)} rows={2} className="text-sm" />
                            </div>
                          </>
                        ) : (
                          <>
                            {selectedArea.description && (
                              <p className="text-sm text-muted-foreground">{selectedArea.description}</p>
                            )}
                            {!selectedArea.description && (
                              <p className="text-sm text-muted-foreground/60 italic">No description</p>
                            )}
                          </>
                        )}

                        {isCreatingPlaceholder && (
                          <>
                            <Separator />
                            <div className="space-y-2">
                              <Label htmlFor="new-placeholder" className="text-xs">New Placeholder Test</Label>
                              <Input
                                id="new-placeholder"
                                value={newPlaceholderName}
                                onChange={(e) => setNewPlaceholderName(e.target.value)}
                                placeholder="Test name"
                                autoFocus
                                className="h-8 text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newPlaceholderName.trim()) handleCreatePlaceholder();
                                  else if (e.key === 'Escape') { setIsCreatingPlaceholder(false); setNewPlaceholderName(''); }
                                }}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="h-7 text-xs" onClick={handleCreatePlaceholder} disabled={!newPlaceholderName.trim() || isSubmittingPlaceholder}>
                                  <Save className="h-3.5 w-3.5 mr-1" />
                                  {isSubmittingPlaceholder ? 'Creating...' : 'Create'}
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setIsCreatingPlaceholder(false); setNewPlaceholderName(''); }}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Test List */}
                <Card className="border-border/50 overflow-hidden">
                  <CardHeader className="border-b border-border/50 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={toggleSelectAll}
                          disabled={filteredTests.length === 0}
                        />
                        <CardTitle className="text-sm font-medium">
                          {treeSelection?.type === 'area'
                            ? findAreaInTree(tree, treeSelection.id)?.name || 'Tests'
                            : 'All Tests'}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">{filteredTests.length}</span>
                      </div>
                      <div className="relative w-56">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search tests..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-8 h-8 text-sm bg-background"
                        />
                      </div>
                    </div>

                    {/* Bulk action bar */}
                    {selectedTestIds.size > 0 && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                        <span className="text-sm text-muted-foreground">
                          {selectedTestIds.size} selected
                        </span>
                        <ExecutionTargetSelector
                          value={executionTarget}
                          onChange={setExecutionTarget}
                          disabled={isBulkRunning}
                          capabilityFilter="run"
                          size="sm"
                        />
                        <Button variant="outline" size="sm" onClick={handleBulkRun} disabled={isBulkRunning}>
                          <Play className="h-3.5 w-3.5 mr-1.5" />
                          {isBulkRunning ? 'Running...' : 'Run'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(true)} disabled={isBulkDeleting}>
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Trash
                        </Button>
                        {!banAiMode && selectedFailedTests.length > 0 && (
                          <Button variant="outline" size="sm" onClick={handleBulkFix} disabled={isBulkFixing}>
                            <Wrench className="h-3.5 w-3.5 mr-1.5" />
                            {isBulkFixing ? 'Fixing...' : `Fix (${selectedFailedTests.length})`}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setSelectedTestIds(new Set())}>
                          <X className="h-3.5 w-3.5 mr-1.5" />
                          Clear
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    {scopedTests.length === 0 ? (
                      <div className="text-center py-16">
                        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                          <FolderOpen className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground mb-4">
                          {treeSelection?.type === 'area' ? 'No tests in this area yet' : 'No tests created yet'}
                        </p>
                        <Button asChild size="sm">
                          <Link href="/record">
                            <Plus className="h-4 w-4 mr-2" />
                            Record First Test
                          </Link>
                        </Button>
                      </div>
                    ) : filteredTests.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        No tests match {searchQuery ? `"${searchQuery}"` : 'this filter'}
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {filteredTests.map((test) => (
                          <div
                            key={test.id}
                            id={`test-row-${test.id}`}
                            className={cn(
                              'flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group cursor-pointer',
                              treeSelection?.type === 'test' && treeSelection.id === test.id && 'bg-primary/5 ring-1 ring-inset ring-primary/20'
                            )}
                            onClick={() => handleOpenTest(test.id)}
                          >
                            <div className="flex items-center gap-4 min-w-0">
                              <Checkbox
                                checked={selectedTestIds.has(test.id)}
                                onCheckedChange={() => {}}
                                onClick={(e) => { e.stopPropagation(); toggleSelect(test.id, e.shiftKey); }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                                  {test.name}
                                </div>
                                {!treeSelection?.type && getAreaName(test.functionalAreaId) && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {getAreaName(test.functionalAreaId)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <StatusBadge status={test.latestStatus} />
                              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recently Deleted */}
                {deletedTests.length > 0 && (
                  <Card className="border-border/50 overflow-hidden">
                    <CardHeader
                      className="border-b border-border/50 bg-muted/30 cursor-pointer select-none py-3"
                      onClick={() => setShowDeleted(!showDeleted)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {showDeleted ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Recently Deleted ({deletedTests.length})
                          </CardTitle>
                        </div>
                      </div>
                      {showDeleted && selectedDeletedIds.size > 0 && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                          <span className="text-sm text-muted-foreground">{selectedDeletedIds.size} selected</span>
                          <Button variant="outline" size="sm" onClick={handleBulkRestore} disabled={isRestoring}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                            {isRestoring ? 'Restoring...' : 'Restore'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowPermanentDeleteConfirm(true)} disabled={isPermanentlyDeleting}>
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                            Delete Forever
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedDeletedIds(new Set())}>
                            <X className="h-3.5 w-3.5 mr-1.5" />
                            Clear
                          </Button>
                        </div>
                      )}
                    </CardHeader>
                    {showDeleted && (
                      <CardContent className="p-0">
                        <div className="divide-y divide-border/50">
                          {deletedTests.map((test) => (
                            <div key={test.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group">
                              <div className="flex items-center gap-4 min-w-0">
                                <Checkbox
                                  checked={selectedDeletedIds.has(test.id)}
                                  onCheckedChange={() => {}}
                                  onClick={(e) => { e.stopPropagation(); toggleDeletedSelect(test.id, e.shiftKey); }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-sm truncate text-muted-foreground">{test.name}</div>
                                  {test.deletedAt && (
                                    <div className="text-xs text-muted-foreground/70 mt-0.5">
                                      Deleted {new Date(test.deletedAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={async () => { await restoreTests([test.id]); router.refresh(); }} title="Restore">
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedDeletedIds(new Set([test.id])); setShowPermanentDeleteConfirm(true); }} title="Permanently delete">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )}
              </div>
            </div>
            )}
          </TabsContent>

          {/* ─── Plan Tab ─── */}
          <TabsContent value="plan" className="overflow-auto flex-1">
            <div className="p-6 pt-4">
              <div className="max-w-4xl">
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-sm text-muted-foreground">
                    {flatAreas.length} area{flatAreas.length !== 1 ? 's' : ''}
                  </div>
                  {earlyAdopterMode && allSpecs.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Spec coverage: <span className="font-medium text-foreground">{specsWithTests}/{allSpecs.length}</span> ({allSpecs.length > 0 ? Math.round((specsWithTests / allSpecs.length) * 100) : 0}%)
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={handleExportAll} disabled={isExporting || flatAreas.length === 0}>
                    {isExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                    Export Manifesto
                  </Button>
                </div>

                <div className="divide-y">
                  {flatAreas.map((area) => (
                    <div key={area.id}>
                      <PlanAreaEditor
                        areaId={area.id}
                        areaName={area.name}
                        description={area.description}
                        agentPlan={area.agentPlan || ''}
                        planGeneratedAt={area.planGeneratedAt}
                        depth={area.depth}
                      />
                      {earlyAdopterMode && (
                        <div className="px-4 pb-4">
                          <AreaSpecsPanel
                            areaId={area.id}
                            repositoryId={repositoryId}
                            specs={specsByArea.get(area.id) || []}
                            hasAgentPlan={!!area.agentPlan}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {flatAreas.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground">
                    <p>No areas yet. Create areas to start planning.</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </ResizablePanel>

      {/* ─── Dialogs ─── */}

      {/* New Area */}
      <Dialog open={isNewAreaOpen} onOpenChange={setIsNewAreaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Area</DialogTitle>
            <DialogDescription>
              {newAreaParentId ? 'Create a new sub-folder inside the selected area' : 'Create a new top-level area'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="area-name">Name</Label>
              <Input id="area-name" value={newAreaName} onChange={(e) => setNewAreaName(e.target.value)} placeholder="e.g., Authentication, Dashboard" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="area-description">Description (optional)</Label>
              <Textarea id="area-description" value={newAreaDescription} onChange={(e) => setNewAreaDescription(e.target.value)} placeholder="What tests belong in this area?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewAreaOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateArea} disabled={isCreatingArea || !newAreaName.trim()}>
              {isCreatingArea ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Area */}
      <Dialog open={!!deleteAreaId} onOpenChange={(open) => !open && setDeleteAreaId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Area</DialogTitle>
            <DialogDescription>What would you like to do with the tests, suites, and sub-folders inside this area?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button variant="outline" onClick={() => handleDeleteArea(false)} disabled={isDeletingArea} className="justify-start h-auto py-3 px-4">
              <div className="text-left">
                <div className="font-medium">{isDeletingArea ? 'Deleting...' : 'Delete area only'}</div>
                <div className="text-xs text-muted-foreground font-normal">Move contents to Unsorted and sub-folders to root</div>
              </div>
            </Button>
            <Button variant="destructive" onClick={() => handleDeleteArea(true)} disabled={isDeletingArea} className="justify-start h-auto py-3 px-4">
              <div className="text-left">
                <div className="font-medium">{isDeletingArea ? 'Deleting...' : 'Delete everything'}</div>
                <div className="text-xs font-normal opacity-90">Remove the area and all its tests, suites, and sub-folders</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Areas */}
      <Dialog open={deleteAreaIds.length > 0} onOpenChange={(open) => !open && setDeleteAreaIds([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteAreaIds.length} Areas</DialogTitle>
            <DialogDescription>What would you like to do with the tests, suites, and sub-folders inside these areas?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button variant="outline" onClick={() => handleDeleteMultipleAreas(false)} disabled={isDeletingArea} className="justify-start h-auto py-3 px-4">
              <div className="text-left">
                <div className="font-medium">{isDeletingArea ? 'Deleting...' : 'Delete areas only'}</div>
                <div className="text-xs text-muted-foreground font-normal">Move contents to Unsorted and sub-folders to root</div>
              </div>
            </Button>
            <Button variant="destructive" onClick={() => handleDeleteMultipleAreas(true)} disabled={isDeletingArea} className="justify-start h-auto py-3 px-4">
              <div className="text-left">
                <div className="font-medium">{isDeletingArea ? 'Deleting...' : 'Delete everything'}</div>
                <div className="text-xs font-normal opacity-90">Remove all {deleteAreaIds.length} areas and their tests, suites, and sub-folders</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Test */}
      <Dialog open={!!deleteTestId} onOpenChange={(open) => !open && setDeleteTestId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>Are you sure? It will be soft-deleted and can be restored later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTestId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteTest} disabled={isDeletingArea}>
              {isDeletingArea ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Tests Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedTestIds.size} test{selectedTestIds.size !== 1 ? 's' : ''} to trash?</DialogTitle>
            <DialogDescription>Tests will be moved to the Recently Deleted section.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
              {isBulkDeleting ? 'Moving...' : 'Move to Trash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirmation */}
      <Dialog open={showPermanentDeleteConfirm} onOpenChange={setShowPermanentDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {selectedDeletedIds.size} test{selectedDeletedIds.size !== 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>This action cannot be undone. All related data will also be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPermanentDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handlePermanentDelete} disabled={isPermanentlyDeleting}>
              {isPermanentlyDeleting ? 'Deleting...' : 'Permanently Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Basic Tests */}
      <RouteSelectorDialog
        open={isAddTestsOpen}
        onOpenChange={setIsAddTestsOpen}
        routes={uncoveredRoutes}
        title="Generate Basic Tests"
        description="Select routes to generate smoke tests for (visit, screenshot, check errors)"
        actionLabel="Generate Tests"
        onAction={handleAddTests}
      />

      {/* AI Create Test */}
      {!banAiMode && (
        <AICreateTestDialog
          open={isAICreateOpen}
          onOpenChange={setIsAICreateOpen}
          repositoryId={repositoryId}
          areas={areas}
        />
      )}

      {/* Discovery Dialogs */}
      <AIScanRoutesDialog
        open={showAIScanDialog}
        onOpenChange={setShowAIScanDialog}
        repositoryId={repositoryId}
        branch={selectedBranch}
        onSaved={() => router.refresh()}
      />
      {earlyAdopterMode && (
        <>
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
        </>
      )}
      <CodeDiffScanDialog
        open={showCodeDiffDialog}
        onOpenChange={setShowCodeDiffDialog}
        repositoryId={repositoryId}
        onSaved={() => router.refresh()}
      />
    </ResizablePanelGroup>
  );
}

// ─── Plan Area Editor ───

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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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
