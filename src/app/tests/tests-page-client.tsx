'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { createFunctionalArea, deleteTests } from '@/server/actions/tests';
import { generateBasicTests } from '@/server/actions/scanner';
import { aiFixAllFailedTests, aiFixTests } from '@/server/actions/ai';
import { runTests } from '@/server/actions/runs';
import { RouteSelectorDialog } from '@/components/routes/route-selector-dialog';
import { AICreateTestDialog } from '@/components/ai/ai-create-test-dialog';
import { MCPCreateTestDialog } from '@/components/ai/mcp-create-test-dialog';
import {
  FlaskConical,
  Plus,
  Sparkles,
  Wand2,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  FileText,
  Play,
  Trash2,
  X
} from 'lucide-react';
import Link from 'next/link';
import type { FunctionalArea, Test, Route } from '@/lib/db/schema';

interface TestWithStatus extends Test {
  latestStatus: string | null;
}

interface TestsPageClientProps {
  areas: FunctionalArea[];
  tests: TestWithStatus[];
  routes: Route[];
  repositoryId?: string;
  baseUrl?: string;
}

export function TestsPageClient({ areas, tests, routes, repositoryId, baseUrl = 'http://localhost:3000' }: TestsPageClientProps) {
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isAddTestsOpen, setIsAddTestsOpen] = useState(false);
  const [isAICreateOpen, setIsAICreateOpen] = useState(false);
  const [isMCPCreateOpen, setIsMCPCreateOpen] = useState(false);
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixed: number; failed: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkFixing, setIsBulkFixing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const failedTests = tests.filter(t => t.latestStatus === 'failed');

  const filteredTests = tests.filter(test =>
    test.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedFailedTests = Array.from(selectedIds).filter(id => {
    const test = tests.find(t => t.id === id);
    return test?.latestStatus === 'failed';
  });

  const allFilteredSelected = filteredTests.length > 0 && filteredTests.every(t => selectedIds.has(t.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTests.map(t => t.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkRun = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkRunning(true);
    try {
      await runTests(Array.from(selectedIds), repositoryId);
    } finally {
      setIsBulkRunning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      await deleteTests(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkFix = async () => {
    if (!repositoryId || selectedFailedTests.length === 0) return;
    setIsBulkFixing(true);
    setFixResult(null);
    try {
      const result = await aiFixTests(selectedFailedTests, repositoryId);
      setFixResult({ fixed: result.fixed, failed: result.failed });
    } finally {
      setIsBulkFixing(false);
    }
  };

  const getAreaName = (areaId: string | null) => {
    if (!areaId) return null;
    return areas.find(a => a.id === areaId)?.name;
  };

  const handleFixAllFailed = async () => {
    if (!repositoryId || failedTests.length === 0) return;
    setIsFixingAll(true);
    setFixResult(null);
    try {
      const result = await aiFixAllFailedTests(repositoryId);
      setFixResult({ fixed: result.fixed, failed: result.failed });
    } finally {
      setIsFixingAll(false);
    }
  };

  const handleCreateArea = async () => {
    if (!newAreaName.trim()) return;

    setIsCreating(true);
    try {
      await createFunctionalArea({ name: newAreaName.trim(), repositoryId });
      setNewAreaName('');
      setIsNewAreaOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddTests = async (routeIds: string[]) => {
    if (!repositoryId) return;
    await generateBasicTests(repositoryId, routeIds, 'http://localhost:3000');
  };

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

  const statsData = [
    { label: 'Total', value: tests.length, color: 'text-foreground' },
    { label: 'Passed', value: tests.filter(t => t.latestStatus === 'passed').length, color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Failed', value: failedTests.length, color: 'text-rose-600 dark:text-rose-400' },
    { label: 'Pending', value: tests.filter(t => !t.latestStatus).length, color: 'text-muted-foreground' },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tests</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage and run your visual regression tests
            </p>
          </div>
          <div className="flex gap-2">
            {repositoryId && failedTests.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleFixAllFailed}
                disabled={isFixingAll}
              >
                <Wrench className="h-4 w-4 mr-2" />
                {isFixingAll ? 'Fixing...' : `Fix Failed (${failedTests.length})`}
              </Button>
            )}
            {repositoryId && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddTestsOpen(true)}
                  disabled={routes.filter(r => !r.hasTest).length === 0}
                >
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Add Basic Tests
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsAICreateOpen(true)}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI Create
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsMCPCreateOpen(true)}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  MCP Create
                </Button>
              </>
            )}
            <Button asChild size="sm">
              <Link href="/record">
                <Plus className="h-4 w-4 mr-2" />
                Record Test
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          {statsData.map((stat, i) => (
            <div
              key={stat.label}
              className="p-4 rounded-lg bg-card border border-border/50"
            >
              <div className={`text-2xl font-semibold tabular-nums ${stat.color}`}>
                {stat.value}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {fixResult && (
          <div className="text-sm p-3 rounded-lg bg-muted/50 border border-border/50">
            Fixed {fixResult.fixed} test{fixResult.fixed !== 1 ? 's' : ''}.
            {fixResult.failed > 0 && ` ${fixResult.failed} could not be fixed.`}
          </div>
        )}

        {/* Tests Table */}
        <Card className="border-border/50 overflow-hidden">
          <CardHeader className="border-b border-border/50 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={filteredTests.length === 0}
                />
                <CardTitle className="text-sm font-medium">All Tests</CardTitle>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tests..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-sm bg-background"
                />
              </div>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                <span className="text-sm text-muted-foreground">
                  Selected: {selectedIds.size}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkRun}
                  disabled={isBulkRunning}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {isBulkRunning ? 'Running...' : 'Run'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isBulkDeleting}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
                {repositoryId && selectedFailedTests.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkFix}
                    disabled={isBulkFixing}
                  >
                    <Wrench className="h-3.5 w-3.5 mr-1.5" />
                    {isBulkFixing ? 'Fixing...' : `AI Fix (${selectedFailedTests.length})`}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Clear
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {tests.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                  <FolderOpen className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground mb-4">No tests created yet</p>
                <Button asChild size="sm">
                  <Link href="/record">
                    <Plus className="h-4 w-4 mr-2" />
                    Record First Test
                  </Link>
                </Button>
              </div>
            ) : filteredTests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No tests match &quot;{searchQuery}&quot;
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {filteredTests.map((test) => (
                  <div
                    key={test.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <Checkbox
                        checked={selectedIds.has(test.id)}
                        onCheckedChange={() => toggleSelect(test.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Link href={`/tests/${test.id}`} className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {test.name}
                        </div>
                        {getAreaName(test.functionalAreaId) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {getAreaName(test.functionalAreaId)}
                          </div>
                        )}
                      </Link>
                    </div>
                    <Link href={`/tests/${test.id}`} className="flex items-center gap-3">
                      <StatusBadge status={test.latestStatus} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New Area Dialog */}
      <Dialog open={isNewAreaOpen} onOpenChange={setIsNewAreaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Functional Area</DialogTitle>
            <DialogDescription>
              Group your tests by functional area (e.g., auth, checkout, dashboard)
            </DialogDescription>
          </DialogHeader>

          <Input
            placeholder="Area name"
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateArea()}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewAreaOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateArea} disabled={isCreating || !newAreaName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Basic Tests Dialog */}
      <RouteSelectorDialog
        open={isAddTestsOpen}
        onOpenChange={setIsAddTestsOpen}
        routes={routes.filter(r => !r.hasTest)}
        title="Generate Basic Tests"
        description="Select routes to generate smoke tests for (visit, screenshot, check errors)"
        actionLabel="Generate Tests"
        onAction={handleAddTests}
      />

      {/* AI Create Test Dialog */}
      {repositoryId && (
        <AICreateTestDialog
          open={isAICreateOpen}
          onOpenChange={setIsAICreateOpen}
          repositoryId={repositoryId}
          areas={areas}
        />
      )}

      {/* MCP Create Test Dialog */}
      {repositoryId && (
        <MCPCreateTestDialog
          open={isMCPCreateOpen}
          onOpenChange={setIsMCPCreateOpen}
          repositoryId={repositoryId}
          areas={areas}
          baseUrl={baseUrl}
        />
      )}

      {/* Bulk Delete Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} test{selectedIds.size !== 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected tests will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
              {isBulkDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
