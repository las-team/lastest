'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  FolderInput,
  Check,
  X,
  Pause,
  Route,
  ListChecks,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { FunctionalAreaWithChildren } from '@/lib/db/queries';

export interface TreeSelection {
  type: 'area' | 'test' | 'suite';
  id: string;
}

export interface SuiteItem {
  id: string;
  name: string;
  description: string | null;
  testCount: number;
}

interface AreaTreeProps {
  tree: FunctionalAreaWithChildren[];
  uncategorizedTests: { id: string; name: string; latestStatus: string | null; isPlaceholder?: boolean }[];
  unsortedSuites: SuiteItem[];
  selection: TreeSelection | null;
  selectedAreaIds: Set<string>;
  onSelect: (selection: TreeSelection | null) => void;
  onMultiSelect: (ids: Set<string>) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onDeleteMultipleAreas: (ids: string[]) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
  onMoveSuite: (suiteId: string, areaId: string | null) => void;
  onMoveArea: (areaId: string, newParentId: string | null) => void;
}

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'passed':
      return <Check className="h-3 w-3 text-green-500" />;
    case 'failed':
      return <X className="h-3 w-3 text-destructive" />;
    case 'running':
      return <Pause className="h-3 w-3 text-yellow-500" />;
    default:
      return <div className="h-3 w-3 rounded-full bg-muted" />;
  }
}

interface AreaNodeProps {
  area: FunctionalAreaWithChildren;
  depth: number;
  selection: TreeSelection | null;
  selectedAreaIds: Set<string>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (selection: TreeSelection | null) => void;
  onAreaClick: (id: string, shiftKey: boolean) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
  onMoveSuite: (suiteId: string, areaId: string | null) => void;
  onMoveArea: (areaId: string, newParentId: string | null) => void;
}

function computeAreaCoverage(area: FunctionalAreaWithChildren): { total: number; executed: number; rate: number } {
  let passed = 0, failed = 0, notRun = 0;
  function walk(a: FunctionalAreaWithChildren) {
    for (const t of a.tests) {
      if (t.isPlaceholder) continue;
      if (t.latestStatus === 'passed') passed++;
      else if (t.latestStatus === 'failed') failed++;
      else notRun++;
    }
    for (const child of a.children) walk(child);
  }
  walk(area);
  const total = passed + failed + notRun;
  const executed = passed + failed;
  const rate = total > 0 ? Math.round((executed / total) * 100) : 0;
  return { total, executed, rate };
}

function CoverageBadge({ area }: { area: FunctionalAreaWithChildren }) {
  const cov = useMemo(() => computeAreaCoverage(area), [area]);
  if (cov.total === 0) return null;

  let color = 'bg-red-500/15 text-red-600 dark:text-red-400';
  if (cov.rate >= 80) color = 'bg-green-500/15 text-green-600 dark:text-green-400';
  else if (cov.rate >= 50) color = 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400';

  return (
    <span className={cn('text-[10px] font-medium px-1 rounded', color)}>
      {cov.rate}%
    </span>
  );
}

function AreaNode({
  area,
  depth,
  selection,
  selectedAreaIds,
  expandedIds,
  onToggle,
  onSelect,
  onAreaClick,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onMoveTest,
  onMoveSuite,
  onMoveArea,
}: AreaNodeProps) {
  const isExpanded = expandedIds.has(area.id);
  const isSelected = selection?.type === 'area' && selection.id === area.id;
  const isMultiSelected = selectedAreaIds.has(area.id);
  const hasChildren = area.children.length > 0 || area.tests.length > 0 || area.suites.length > 0;
  const FolderIcon = area.isRouteFolder ? Route : isExpanded ? FolderOpen : Folder;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/area-id', area.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // Check if dragging an area - don't allow dropping on itself
    const draggedAreaId = e.dataTransfer.types.includes('text/area-id');
    if (draggedAreaId) {
      e.dataTransfer.dropEffect = 'move';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const testId = e.dataTransfer.getData('text/test-id');
    const suiteId = e.dataTransfer.getData('text/suite-id');
    const areaId = e.dataTransfer.getData('text/area-id');
    if (testId) {
      onMoveTest(testId, area.id);
    } else if (suiteId) {
      onMoveSuite(suiteId, area.id);
    } else if (areaId && areaId !== area.id) {
      // Move the dragged area to become a child of this area
      onMoveArea(areaId, area.id);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted',
          isSelected && 'bg-primary/10 hover:bg-primary/15',
          isMultiSelected && !isSelected && 'bg-primary/10 hover:bg-primary/15'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={(e) => {
          if (e.shiftKey) {
            onAreaClick(area.id, true);
          } else {
            onAreaClick(area.id, false);
            onSelect({ type: 'area', id: area.id });
          }
        }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(area.id);
          }}
          className="p-0.5 hover:bg-muted-foreground/20 rounded"
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <div className="w-4" />
          )}
        </button>
        <FolderIcon className={cn('h-4 w-4', area.isRouteFolder ? 'text-blue-500' : 'text-primary')} />
        <span className="flex-1 truncate text-sm">{area.name}</span>
        <CoverageBadge area={area} />
        <span className="text-xs text-muted-foreground">{area.tests.length + area.suites.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onNewArea(area.id)}>
              <Plus className="h-4 w-4 mr-2" />
              New Sub-folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEditArea(area.id)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDeleteArea(area.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <div>
          {area.children.map((child) => (
            <AreaNode
              key={child.id}
              area={child}
              depth={depth + 1}
              selection={selection}
              selectedAreaIds={selectedAreaIds}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onAreaClick={onAreaClick}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
              onMoveSuite={onMoveSuite}
              onMoveArea={onMoveArea}
            />
          ))}
          {area.suites.map((suite) => (
            <SuiteNode
              key={suite.id}
              suite={suite}
              depth={depth + 1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
          {area.tests.map((test) => (
            <TestNode
              key={test.id}
              test={test}
              depth={depth + 1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TestNodeProps {
  test: { id: string; name: string; latestStatus: string | null; isPlaceholder?: boolean };
  depth: number;
  selection: TreeSelection | null;
  onSelect: (selection: TreeSelection | null) => void;
}

function TestNode({ test, depth, selection, onSelect }: TestNodeProps) {
  const isSelected = selection?.type === 'test' && selection.id === test.id;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/test-id', test.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-muted',
        isSelected && 'bg-primary/10 hover:bg-primary/15'
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSelect({ type: 'test', id: test.id })}
      draggable
      onDragStart={handleDragStart}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />
      <StatusIcon status={test.latestStatus} />
      <FileCode className={cn("h-4 w-4", test.isPlaceholder ? "text-amber-500" : "text-muted-foreground")} />
      <span className="flex-1 truncate text-sm">
        {test.name}
        {test.isPlaceholder && <span className="text-xs text-muted-foreground ml-1">(placeholder)</span>}
      </span>
    </div>
  );
}

interface SuiteNodeProps {
  suite: SuiteItem;
  depth: number;
  selection: TreeSelection | null;
  onSelect: (selection: TreeSelection | null) => void;
}

function SuiteNode({ suite, depth, selection, onSelect }: SuiteNodeProps) {
  const isSelected = selection?.type === 'suite' && selection.id === suite.id;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/suite-id', suite.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-muted',
        isSelected && 'bg-primary/10 hover:bg-primary/15'
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSelect({ type: 'suite', id: suite.id })}
      draggable
      onDragStart={handleDragStart}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />
      <ListChecks className="h-4 w-4 text-violet-500" />
      <span className="flex-1 truncate text-sm">{suite.name}</span>
      <span className="text-xs text-muted-foreground">{suite.testCount}</span>
    </div>
  );
}

// Flatten tree into ordered list of area IDs (depth-first)
function flattenAreaIds(areas: FunctionalAreaWithChildren[]): string[] {
  const result: string[] = [];
  for (const area of areas) {
    result.push(area.id);
    result.push(...flattenAreaIds(area.children));
  }
  return result;
}

export function AreaTree({
  tree,
  uncategorizedTests,
  unsortedSuites,
  selection,
  selectedAreaIds,
  onSelect,
  onMultiSelect,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onDeleteMultipleAreas,
  onMoveTest,
  onMoveSuite,
  onMoveArea,
}: AreaTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastClickedAreaId, setLastClickedAreaId] = useState<string | null>(null);

  const flatIds = useMemo(() => flattenAreaIds(tree), [tree]);

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleAreaClick = useCallback((id: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedAreaId) {
      // Range select between lastClickedAreaId and id
      const startIdx = flatIds.indexOf(lastClickedAreaId);
      const endIdx = flatIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx);
        const to = Math.max(startIdx, endIdx);
        const rangeIds = flatIds.slice(from, to + 1);
        const next = new Set(selectedAreaIds);
        for (const rid of rangeIds) next.add(rid);
        onMultiSelect(next);
      }
    } else {
      // Normal click — clear multi-select
      setLastClickedAreaId(id);
      onMultiSelect(new Set());
    }
  }, [lastClickedAreaId, flatIds, selectedAreaIds, onMultiSelect]);

  const handleUnsortedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const testId = e.dataTransfer.getData('text/test-id');
    const suiteId = e.dataTransfer.getData('text/suite-id');
    const areaId = e.dataTransfer.getData('text/area-id');
    if (testId) {
      onMoveTest(testId, null);
    } else if (suiteId) {
      onMoveSuite(suiteId, null);
    } else if (areaId) {
      // Move area to root level
      onMoveArea(areaId, null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b font-medium text-sm flex items-center justify-between">
        {selectedAreaIds.size > 0 ? (
          <>
            <span className="text-primary">{selectedAreaIds.size} selected</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onMultiSelect(new Set())}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={() => onDeleteMultipleAreas(Array.from(selectedAreaIds))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <span>Areas</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onNewArea()}>
              <Plus className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-hidden" type="auto">
        <div className="p-2 overflow-x-auto">
          {/* Areas */}
          {tree.map((area) => (
            <AreaNode
              key={area.id}
              area={area}
              depth={0}
              selection={selection}
              selectedAreaIds={selectedAreaIds}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={onSelect}
              onAreaClick={handleAreaClick}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
              onMoveSuite={onMoveSuite}
              onMoveArea={onMoveArea}
            />
          ))}

          {/* Unsorted section (tests, suites, and drop zone for moving areas to root) */}
          <div
            className="mt-2 pt-2 border-t"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={handleUnsortedDrop}
          >
            <div className="flex items-center gap-2 py-1 px-2 text-sm text-muted-foreground">
              <FolderInput className="h-4 w-4" />
              <span>Unsorted</span>
              {(uncategorizedTests.length > 0 || unsortedSuites.length > 0) && (
                <span className="text-xs">({uncategorizedTests.length + unsortedSuites.length})</span>
              )}
            </div>
            {unsortedSuites.map((suite) => (
              <SuiteNode
                key={suite.id}
                suite={suite}
                depth={0}
                selection={selection}
                onSelect={onSelect}
              />
            ))}
            {uncategorizedTests.map((test) => (
              <TestNode
                key={test.id}
                test={test}
                depth={0}
                selection={selection}
                onSelect={onSelect}
              />
            ))}
            {uncategorizedTests.length === 0 && unsortedSuites.length === 0 && (
              <div className="py-2 px-2 text-xs text-muted-foreground/60 italic">
                Drop items here to unsort
              </div>
            )}
          </div>

          {tree.length === 0 && uncategorizedTests.length === 0 && unsortedSuites.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No areas yet</p>
              <Button variant="link" size="sm" onClick={() => onNewArea()}>
                Create your first area
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
