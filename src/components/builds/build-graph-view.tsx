'use client';

import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import type { Build, BuildStatus } from '@/lib/db/schema';

interface BuildWithBranch extends Build {
  gitBranch?: string;
  gitCommit?: string;
}

interface BuildGraphViewProps {
  builds: BuildWithBranch[];
  defaultBranch: string | null;
}

const COL_WIDTH = 100;
const ROW_HEIGHT = 56;
const NODE_R = 8;
const PAD_X = 40;
const PAD_Y = 40;

const BRANCH_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
  '#14b8a6', '#6366f1', '#84cc16',
];

const STATUS_COLORS: Record<BuildStatus, string> = {
  safe_to_merge: '#22c55e',
  review_required: '#eab308',
  blocked: '#ef4444',
};

const STATUS_LABELS: Record<BuildStatus, string> = {
  safe_to_merge: 'Safe to Merge',
  review_required: 'Review Required',
  blocked: 'Blocked',
};

function formatDuration(elapsedMs: number | null): string {
  if (!elapsedMs) return '-';
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

interface TooltipData {
  build: BuildWithBranch;
  x: number;
  y: number;
}

export function BuildGraphView({ builds, defaultBranch }: BuildGraphViewProps) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { nodes, branchColumns, svgWidth, svgHeight, branchLines } = useMemo(() => {
    // Sort builds newest first (top of graph)
    const sorted = [...builds].sort(
      (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );

    // Assign column indices: default branch = 0, others by first chronological appearance
    const colMap = new Map<string, number>();
    const defBranch = defaultBranch || 'main';
    colMap.set(defBranch, 0);

    // Walk chronologically (oldest first) to assign columns
    const chronological = [...sorted].reverse();
    let nextCol = 1;
    for (const b of chronological) {
      const branch = b.gitBranch || defBranch;
      if (!colMap.has(branch)) {
        colMap.set(branch, nextCol++);
      }
    }

    const numCols = colMap.size;
    const width = PAD_X * 2 + numCols * COL_WIDTH;
    const height = PAD_Y + sorted.length * ROW_HEIGHT + 20;

    // Build node positions (sorted = newest first = row 0 at top)
    const nodeList = sorted.map((build, rowIdx) => {
      const branch = build.gitBranch || defBranch;
      const col = colMap.get(branch) ?? 0;
      return {
        build,
        x: PAD_X + col * COL_WIDTH + COL_WIDTH / 2,
        y: PAD_Y + rowIdx * ROW_HEIGHT + ROW_HEIGHT / 2,
        branch,
        col,
      };
    });

    // Compute vertical lines per branch (first to last node)
    const branchExtents = new Map<string, { minY: number; maxY: number; col: number }>();
    for (const node of nodeList) {
      const ext = branchExtents.get(node.branch);
      if (!ext) {
        branchExtents.set(node.branch, { minY: node.y, maxY: node.y, col: node.col });
      } else {
        ext.minY = Math.min(ext.minY, node.y);
        ext.maxY = Math.max(ext.maxY, node.y);
      }
    }

    const lines = Array.from(branchExtents.entries()).map(([branch, ext]) => ({
      branch,
      x: PAD_X + ext.col * COL_WIDTH + COL_WIDTH / 2,
      y1: ext.minY,
      y2: ext.maxY,
      color: BRANCH_COLORS[ext.col % BRANCH_COLORS.length],
    }));

    return {
      nodes: nodeList,
      branchColumns: Array.from(colMap.entries()).map(([name, col]) => ({
        name,
        col,
        x: PAD_X + col * COL_WIDTH + COL_WIDTH / 2,
        color: BRANCH_COLORS[col % BRANCH_COLORS.length],
      })),
      svgWidth: width,
      svgHeight: height,
      branchLines: lines,
    };
  }, [builds, defaultBranch]);

  const handleNodeClick = useCallback(
    (buildId: string) => {
      router.push(`/builds/${buildId}`);
    },
    [router]
  );

  const handleNodeHover = useCallback(
    (build: BuildWithBranch, x: number, y: number) => {
      setTooltip({ build, x, y });
    },
    []
  );

  const handleNodeLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (builds.length === 0) return null;

  return (
    <div className="relative overflow-auto max-h-[600px]">
      <svg
        width={svgWidth}
        height={svgHeight}
        className="block"
      >
        {/* Branch header labels */}
        {branchColumns.map((bc) => (
          <text
            key={bc.name}
            x={bc.x}
            y={18}
            textAnchor="middle"
            fill={bc.color}
            fontSize={11}
            fontWeight={600}
          >
            {bc.name.length > 12 ? bc.name.slice(0, 12) + '\u2026' : bc.name}
          </text>
        ))}

        {/* Vertical branch lines */}
        {branchLines.map((line) => (
          <line
            key={line.branch}
            x1={line.x}
            y1={line.y1}
            x2={line.x}
            y2={line.y2}
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={0.3}
          />
        ))}

        {/* Build nodes */}
        {nodes.map((node) => {
          const status = node.build.overallStatus as BuildStatus;
          const fill = STATUS_COLORS[status] || '#6b7280';
          const branchColor = BRANCH_COLORS[node.col % BRANCH_COLORS.length];

          return (
            <g
              key={node.build.id}
              style={{ cursor: 'pointer' }}
              role="link"
              tabIndex={0}
              onClick={() => handleNodeClick(node.build.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleNodeClick(node.build.id);
                }
              }}
              onMouseEnter={(e) => {
                const svgRect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const scrollParent = (e.currentTarget.ownerSVGElement as SVGSVGElement).parentElement!;
                handleNodeHover(
                  node.build,
                  node.x - scrollParent.scrollLeft,
                  node.y - scrollParent.scrollTop
                );
              }}
              onMouseLeave={handleNodeLeave}
            >
              {/* Invisible larger hit target */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_R + 8}
                fill="transparent"
              />
              {/* Visible node */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_R}
                fill={fill}
                stroke="white"
                strokeWidth={2}
              />
              {/* Build ID label to the right */}
              <text
                x={node.x + NODE_R + 6}
                y={node.y + 4}
                fontSize={10}
                fill={branchColor}
                opacity={0.7}
              >
                {node.build.id.slice(0, 7)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* HTML Tooltip overlay */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs min-w-[180px]"
          style={{
            left: tooltip.x + 16,
            top: tooltip.y - 12,
          }}
        >
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[tooltip.build.overallStatus as BuildStatus] }}
            />
            {STATUS_LABELS[tooltip.build.overallStatus as BuildStatus]}
          </div>
          <div className="text-muted-foreground space-y-0.5">
            {tooltip.build.gitBranch && (
              <div>
                {tooltip.build.gitBranch}
                {tooltip.build.gitCommit && (
                  <span className="font-mono ml-1">{tooltip.build.gitCommit.slice(0, 7)}</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span>{tooltip.build.totalTests ?? 0} tests</span>
              <span className="text-yellow-600">{tooltip.build.changesDetected ?? 0} changed</span>
              <span className="text-red-600">{tooltip.build.failedCount ?? 0} failed</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{formatDuration(tooltip.build.elapsedMs)}</span>
              {tooltip.build.createdAt && (
                <span>{formatDistanceToNow(new Date(tooltip.build.createdAt), { addSuffix: true })}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
