"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AppMapNode } from "@/lib/app-map/build-map";
import type { SpanningTree } from "@/lib/app-map/hierarchy";
import { COVERAGE_COLOR } from "./app-map-shared";

/**
 * Collapsible left sidebar mirroring the map's spanning tree. Click a row to
 * select + center that node on the canvas; the canvas selection highlights
 * the row (two-way sync via `selectedId`).
 */
export function TreeOutline({
  tree,
  nodesById,
  selectedId,
  onSelect,
}: {
  tree: SpanningTree;
  nodesById: Map<string, AppMapNode>;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rows: React.ReactNode[] = [];
  const walk = (id: string, depth: number) => {
    const node = nodesById.get(id);
    if (!node) return;
    const children = tree.children.get(id) ?? [];
    const isCollapsed = collapsed.has(id);
    rows.push(
      <OutlineRow
        key={id}
        node={node}
        depth={depth}
        hasChildren={children.length > 0}
        isCollapsed={isCollapsed}
        isSelected={selectedId === id}
        onToggle={() => toggle(id)}
        onSelect={() => onSelect(id)}
      />,
    );
    if (!isCollapsed) for (const child of children) walk(child, depth + 1);
  };
  walk(tree.rootId, 0);

  return (
    <div className="absolute left-0 top-0 z-10 flex h-full w-64 flex-col border-r bg-card/95 shadow-sm backdrop-blur">
      <div className="border-b px-3 py-2 text-xs font-semibold">
        Page hierarchy
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {rows}
        {tree.unreachable.length > 0 && (
          <>
            <div className="mt-2 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Unlinked
            </div>
            {tree.unreachable.map((id) => {
              const node = nodesById.get(id);
              if (!node) return null;
              return (
                <OutlineRow
                  key={id}
                  node={node}
                  depth={0}
                  hasChildren={false}
                  isCollapsed={false}
                  isSelected={selectedId === id}
                  onToggle={() => {}}
                  onSelect={() => onSelect(id)}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function OutlineRow({
  node,
  depth,
  hasChildren,
  isCollapsed,
  isSelected,
  onToggle,
  onSelect,
}: {
  node: AppMapNode;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex w-full items-center gap-1 pr-2 text-left text-xs hover:bg-muted ${
        isSelected ? "bg-primary/10 text-primary" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10"
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
        title={node.title ?? node.path}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: COVERAGE_COLOR[node.coverageStatus] }}
        />
        <span className="truncate font-mono">{node.path}</span>
        {node.title && (
          <span className="truncate text-muted-foreground">{node.title}</span>
        )}
      </button>
    </div>
  );
}
