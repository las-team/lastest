'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
  GripVertical,
  ScrollText,
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
  type: 'area' | 'test';
  id: string;
}

interface AreaTreeProps {
  tree: FunctionalAreaWithChildren[];
  uncategorizedTests: { id: string; name: string; specTitle: string | null; latestStatus: string | null; isPlaceholder?: boolean }[];
  selection: TreeSelection | null;
  selectedAreaIds: Set<string>;
  selectedTestIds?: Set<string>;
  onSelect: (selection: TreeSelection | null) => void;
  onMultiSelect: (ids: Set<string>) => void;
  onMultiSelectTests?: (ids: Set<string>) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onDeleteMultipleAreas: (ids: string[]) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
  onMoveArea: (areaId: string, newParentId: string | null) => void;
  onDeleteTest?: (id: string) => void;
  headerExtra?: React.ReactNode;
  addButtonClassName?: string;
}

const EMPTY_SET: Set<string> = new Set();

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
  selectedTestIds: Set<string>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (selection: TreeSelection | null) => void;
  onAreaClick: (id: string, shiftKey: boolean) => void;
  onTestClick: (id: string, shiftKey: boolean) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
  onMoveArea: (areaId: string, newParentId: string | null) => void;
  onDeleteTest?: (id: string) => void;
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
  selectedTestIds,
  expandedIds,
  onToggle,
  onSelect,
  onAreaClick,
  onTestClick,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onMoveTest,
  onMoveArea,
  onDeleteTest,
}: AreaNodeProps) {
  const isExpanded = expandedIds.has(area.id);
  const isSelected = selection?.type === 'area' && selection.id === area.id;
  const isMultiSelected = selectedAreaIds.has(area.id);
  const hasChildren = area.children.length > 0 || area.tests.length > 0;
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
    const areaId = e.dataTransfer.getData('text/area-id');
    if (testId) {
      onMoveTest(testId, area.id);
    } else if (areaId && areaId !== area.id) {
      // Move the dragged area to become a child of this area
      onMoveArea(areaId, area.id);
    }
  };

  return (
    <div>
      <div
        role="treeitem"
        aria-label={area.name}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        className={cn(
          'group flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted select-none',
          isSelected && 'bg-primary/10 hover:bg-primary/15',
          isMultiSelected && !isSelected && 'bg-primary/10 hover:bg-primary/15'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onMouseDown={(e) => {
          // Prevent the browser's default text selection on shift-click
          // before it interferes with the click → drag interaction.
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.shiftKey) {
            window.getSelection()?.removeAllRanges();
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
        {area.agentPlan && <ScrollText className="h-3 w-3 text-muted-foreground shrink-0" />}
        <CoverageBadge area={area} />
        <span className="text-xs text-muted-foreground">{area.tests.length}</span>
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
              selectedTestIds={selectedTestIds}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onAreaClick={onAreaClick}
              onTestClick={onTestClick}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
              onMoveArea={onMoveArea}
              onDeleteTest={onDeleteTest}
            />
          ))}
          {area.tests.map((test) => (
            <TestNode
              key={test.id}
              test={test}
              depth={depth + 1}
              selection={selection}
              isMultiSelected={selectedTestIds.has(test.id)}
              onSelect={onSelect}
              onTestClick={onTestClick}
              onDeleteTest={onDeleteTest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TestNodeProps {
  test: { id: string; name: string; specTitle: string | null; latestStatus: string | null; isPlaceholder?: boolean };
  depth: number;
  selection: TreeSelection | null;
  isMultiSelected: boolean;
  onSelect: (selection: TreeSelection | null) => void;
  onTestClick: (id: string, shiftKey: boolean) => void;
  onDeleteTest?: (id: string) => void;
}

function TestNode({ test, depth, selection, isMultiSelected, onSelect, onTestClick, onDeleteTest }: TestNodeProps) {
  const isSelected = selection?.type === 'test' && selection.id === test.id;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/test-id', test.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // The tree shows linked spec title (single short line). Full markdown spec lives in the Spec tab.
  const specPreview = test.specTitle && test.specTitle !== test.name ? test.specTitle : null;

  return (
    <div
      role="treeitem"
      aria-label={test.name}
      aria-selected={isSelected}
      className={cn(
        'group/test py-1 px-2 rounded cursor-pointer hover:bg-muted select-none',
        isSelected && 'bg-primary/10 hover:bg-primary/15',
        isMultiSelected && !isSelected && 'bg-primary/10 hover:bg-primary/15'
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.shiftKey) {
          window.getSelection()?.removeAllRanges();
          onTestClick(test.id, true);
        } else {
          onTestClick(test.id, false);
          onSelect({ type: 'test', id: test.id });
        }
      }}
      draggable
      onDragStart={handleDragStart}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover/test:opacity-100 cursor-grab" />
        <StatusIcon status={test.latestStatus} />
        <FileCode className={cn("h-4 w-4 shrink-0", test.isPlaceholder ? "text-amber-500" : "text-muted-foreground")} />
        <span className="flex-1 truncate text-sm">
          {test.name}
          {test.isPlaceholder && <span className="text-xs text-muted-foreground ml-1">(placeholder)</span>}
        </span>
        {onDeleteTest && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover/test:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onDeleteTest(test.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {specPreview && (
        <p className="ml-[52px] mt-0.5 text-xs text-muted-foreground truncate">{specPreview}</p>
      )}
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

// Flatten tree into ordered list of test IDs (depth-first, then uncategorized).
// All tests are included regardless of expansion state, so range selection
// behaves predictably even when sub-folders are collapsed.
function flattenTestIds(
  areas: FunctionalAreaWithChildren[],
  uncategorized: { id: string }[],
): string[] {
  const result: string[] = [];
  function walk(area: FunctionalAreaWithChildren) {
    for (const child of area.children) walk(child);
    for (const t of area.tests) result.push(t.id);
  }
  for (const a of areas) walk(a);
  for (const t of uncategorized) result.push(t.id);
  return result;
}

export function AreaTree({
  tree,
  uncategorizedTests,
  selection,
  selectedAreaIds,
  selectedTestIds,
  onSelect,
  onMultiSelect,
  onMultiSelectTests,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onDeleteMultipleAreas,
  onMoveTest,
  onMoveArea,
  onDeleteTest,
  headerExtra,
  addButtonClassName,
}: AreaTreeProps) {
  const effectiveSelectedTestIds = selectedTestIds ?? EMPTY_SET;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Anchors for shift-click range selection. Refs avoid stale closures and
  // let us seed them from `selection` so shift-click works even when the
  // current single selection was set externally (URL, breadcrumb, etc).
  const lastClickedAreaIdRef = useRef<string | null>(null);
  const lastClickedTestIdRef = useRef<string | null>(null);

  const flatIds = useMemo(() => flattenAreaIds(tree), [tree]);
  const flatTestIds = useMemo(
    () => flattenTestIds(tree, uncategorizedTests),
    [tree, uncategorizedTests],
  );

  // Keep the anchors in sync with the single selection, so shift-click
  // always extends from whatever is currently selected.
  useEffect(() => {
    if (selection?.type === 'area') {
      lastClickedAreaIdRef.current = selection.id;
    } else if (selection?.type === 'test') {
      lastClickedTestIdRef.current = selection.id;
    }
  }, [selection]);

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
    const anchor = lastClickedAreaIdRef.current;
    if (shiftKey && anchor && anchor !== id && flatIds.indexOf(anchor) !== -1) {
      // Range select between anchor and id (replaces previous range, anchor stays)
      const startIdx = flatIds.indexOf(anchor);
      const endIdx = flatIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx);
        const to = Math.max(startIdx, endIdx);
        const rangeIds = flatIds.slice(from, to + 1);
        onMultiSelect(new Set(rangeIds));
      }
    } else {
      // Normal click — set anchor and clear multi-select
      lastClickedAreaIdRef.current = id;
      onMultiSelect(new Set());
    }
  }, [flatIds, onMultiSelect]);

  const handleTestClick = useCallback((id: string, shiftKey: boolean) => {
    const anchor = lastClickedTestIdRef.current;
    if (shiftKey && onMultiSelectTests && anchor && anchor !== id && flatTestIds.indexOf(anchor) !== -1) {
      const startIdx = flatTestIds.indexOf(anchor);
      const endIdx = flatTestIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx);
        const to = Math.max(startIdx, endIdx);
        const rangeIds = flatTestIds.slice(from, to + 1);
        onMultiSelectTests(new Set(rangeIds));
      }
    } else {
      // Normal click — anchor and clear test multi-select
      lastClickedTestIdRef.current = id;
      onMultiSelectTests?.(new Set());
    }
  }, [flatTestIds, onMultiSelectTests]);

  const handleUnsortedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const testId = e.dataTransfer.getData('text/test-id');
    const areaId = e.dataTransfer.getData('text/area-id');
    if (testId) {
      onMoveTest(testId, null);
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
            <div className="flex items-center gap-1">
              {headerExtra}
              <Button variant="ghost" size="icon" className={cn("h-6 w-6", addButtonClassName)} onClick={() => onNewArea()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-hidden" type="auto">
        <div className="p-2 overflow-x-auto" role="tree">
          {/* Areas */}
          {tree.map((area) => (
            <AreaNode
              key={area.id}
              area={area}
              depth={0}
              selection={selection}
              selectedAreaIds={selectedAreaIds}
              selectedTestIds={effectiveSelectedTestIds}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={onSelect}
              onAreaClick={handleAreaClick}
              onTestClick={handleTestClick}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
              onMoveArea={onMoveArea}
              onDeleteTest={onDeleteTest}
            />
          ))}

          {/* Unsorted section (tests and drop zone for moving areas to root) */}
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
              {uncategorizedTests.length > 0 && (
                <span className="text-xs">({uncategorizedTests.length})</span>
              )}
            </div>
            {uncategorizedTests.map((test) => (
              <TestNode
                key={test.id}
                test={test}
                depth={0}
                selection={selection}
                isMultiSelected={effectiveSelectedTestIds.has(test.id)}
                onSelect={onSelect}
                onTestClick={handleTestClick}
                onDeleteTest={onDeleteTest}
              />
            ))}
            {uncategorizedTests.length === 0 && (
              <div className="py-2 px-2 text-xs text-muted-foreground/60 italic">
                Drop items here to unsort
              </div>
            )}
          </div>

          {tree.length === 0 && uncategorizedTests.length === 0 && (
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
