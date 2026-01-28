'use client';

import { useState, useCallback } from 'react';
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
  uncategorizedTests: { id: string; name: string; latestStatus: string | null }[];
  selection: TreeSelection | null;
  onSelect: (selection: TreeSelection | null) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
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
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (selection: TreeSelection | null) => void;
  onNewArea: (parentId?: string) => void;
  onEditArea: (id: string) => void;
  onDeleteArea: (id: string) => void;
  onMoveTest: (testId: string, areaId: string | null) => void;
}

function AreaNode({
  area,
  depth,
  selection,
  expandedIds,
  onToggle,
  onSelect,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onMoveTest,
}: AreaNodeProps) {
  const isExpanded = expandedIds.has(area.id);
  const isSelected = selection?.type === 'area' && selection.id === area.id;
  const hasChildren = area.children.length > 0 || area.tests.length > 0;
  const FolderIcon = area.isRouteFolder ? Route : isExpanded ? FolderOpen : Folder;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const testId = e.dataTransfer.getData('text/test-id');
    if (testId) {
      onMoveTest(testId, area.id);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted',
          isSelected && 'bg-primary/10 hover:bg-primary/15'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect({ type: 'area', id: area.id })}
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
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
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
  test: { id: string; name: string; latestStatus: string | null };
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
      <div className="w-4" />
      <StatusIcon status={test.latestStatus} />
      <FileCode className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 truncate text-sm">{test.name}</span>
    </div>
  );
}

export function AreaTree({
  tree,
  uncategorizedTests,
  selection,
  onSelect,
  onNewArea,
  onEditArea,
  onDeleteArea,
  onMoveTest,
}: AreaTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const handleUncategorizedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const testId = e.dataTransfer.getData('text/test-id');
    if (testId) {
      onMoveTest(testId, null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b font-medium text-sm flex items-center justify-between">
        <span>Areas</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onNewArea()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {tree.map((area) => (
            <AreaNode
              key={area.id}
              area={area}
              depth={0}
              selection={selection}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={onSelect}
              onNewArea={onNewArea}
              onEditArea={onEditArea}
              onDeleteArea={onDeleteArea}
              onMoveTest={onMoveTest}
            />
          ))}

          {uncategorizedTests.length > 0 && (
            <div
              className="mt-2 pt-2 border-t"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={handleUncategorizedDrop}
            >
              <div className="flex items-center gap-2 py-1 px-2 text-sm text-muted-foreground">
                <FolderInput className="h-4 w-4" />
                <span>Uncategorized</span>
                <span className="text-xs">({uncategorizedTests.length})</span>
              </div>
              {uncategorizedTests.map((test) => (
                <TestNode
                  key={test.id}
                  test={test}
                  depth={0}
                  selection={selection}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}

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
