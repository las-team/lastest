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
  mainBaselineBuildId?: string;
  branchBaselineBuildId?: string;
  branchHeads?: Record<string, string>;
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

export function BuildGraphView({ builds, defaultBranch, mainBaselineBuildId, branchBaselineBuildId, branchHeads }: BuildGraphViewProps) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { nodes, branchColumns, svgWidth, svgHeight, curvePath, aheadIndicators } = useMemo(() => {
    // Sort builds newest first (top of graph)
    const sorted = [...builds].sort(
      (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );

    // Assign column indices: default branch = 0, others by most recent build (newest first)
    const colMap = new Map<string, number>();
    const defBranch = defaultBranch || 'main';
    colMap.set(defBranch, 0);

    // sorted is already newest-first, so first appearance = most recent
    let nextCol = 1;
    for (const b of sorted) {
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

    // Find branches that are ahead — place one step above that branch's latest build
    const positionedAhead: Array<{ branch: string; col: number; x: number; y: number; buildY: number; headSha: string }> = [];
    if (branchHeads) {
      for (const [branch, col] of colMap.entries()) {
        const headSha = branchHeads[branch];
        if (!headSha) continue;
        const latestBuild = sorted.find(b => (b.gitBranch || defBranch) === branch);
        if (!latestBuild?.gitCommit) continue;
        if (!headSha.startsWith(latestBuild.gitCommit) && !latestBuild.gitCommit.startsWith(headSha)) {
          const topNode = nodeList.find(n => n.branch === branch);
          const buildY = topNode?.y ?? PAD_Y;
          const aheadY = buildY - ROW_HEIGHT * 0.6;
          positionedAhead.push({
            branch,
            col,
            x: PAD_X + col * COL_WIDTH + COL_WIDTH / 2,
            y: aheadY,
            buildY,
            headSha,
          });
        }
      }
    }

    // Build a single curved path through all nodes (bottom→top, i.e. reversed nodeList)
    // Nodes are newest-first, so reverse to go oldest→newest (bottom→top)
    const chronoNodes = [...nodeList].reverse();
    let curvePath = '';
    if (chronoNodes.length > 0) {
      curvePath = `M${chronoNodes[0].x},${chronoNodes[0].y}`;
      for (let i = 1; i < chronoNodes.length; i++) {
        const prev = chronoNodes[i - 1];
        const curr = chronoNodes[i];
        if (prev.x === curr.x) {
          // Same column — straight line
          curvePath += ` L${curr.x},${curr.y}`;
        } else {
          // Different column — smooth cubic bezier S-curve
          const midY = (prev.y + curr.y) / 2;
          curvePath += ` C${prev.x},${midY} ${curr.x},${midY} ${curr.x},${curr.y}`;
        }
      }
    }

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
      curvePath,
      aheadIndicators: positionedAhead,
    };
  }, [builds, defaultBranch, branchHeads]);

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

        {/* Single curved line through all build nodes */}
        {curvePath && (
          <path
            d={curvePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            opacity={0.15}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Ahead-of-build indicators */}
        {aheadIndicators.map((a) => {
          const color = BRANCH_COLORS[a.col % BRANCH_COLORS.length];
          return (
            <g key={`ahead-${a.branch}`}>
              {/* Dotted line from commit to latest build */}
              <line
                x1={a.x}
                y1={a.y + 7}
                x2={a.x}
                y2={a.buildY - NODE_R}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                opacity={0.4}
              />
              {/* Diamond shape for unbuilt commit */}
              <rect
                x={a.x - 5}
                y={a.y - 5}
                width={10}
                height={10}
                rx={2}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                transform={`rotate(45 ${a.x} ${a.y})`}
              />
              {/* Arrow-up icon inside */}
              <path
                d={`M${a.x} ${a.y - 3} L${a.x} ${a.y + 2} M${a.x - 2} ${a.y - 1} L${a.x} ${a.y - 3} L${a.x + 2} ${a.y - 1}`}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Label */}
              <text
                x={a.x + 12}
                y={a.y + 3}
                fontSize={9}
                fill={color}
                opacity={0.8}
              >
                <tspan fontFamily="monospace">{a.headSha.slice(0, 7)}</tspan>
                <tspan fill={color} opacity={0.6}> ahead</tspan>
              </text>
            </g>
          );
        })}

        {/* Build nodes */}
        {nodes.map((node) => {
          const status = node.build.overallStatus as BuildStatus;
          const fill = STATUS_COLORS[status] || '#6b7280';
          const branchColor = BRANCH_COLORS[node.col % BRANCH_COLORS.length];
          const isMainBaseline = node.build.id === mainBaselineBuildId;
          const isBranchBaseline = node.build.id === branchBaselineBuildId;
          const isBaseline = isMainBaseline || isBranchBaseline;

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
              {/* Baseline outer ring */}
              {isBaseline && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_R + 4}
                  fill="none"
                  stroke={isMainBaseline ? '#a855f7' : '#3b82f6'}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                />
              )}
              {/* Visible node */}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_R}
                fill={fill}
                stroke="white"
                strokeWidth={2}
              />
              {/* Stats label to the right */}
              <text
                x={node.x + NODE_R + 6}
                y={node.y - 2}
                fontSize={10}
                fill="currentColor"
                opacity={0.6}
              >
                <tspan fill="#22c55e">{node.build.passedCount ?? 0}</tspan>
                <tspan fill="currentColor" opacity={0.3}>/</tspan>
                <tspan fill="#eab308">{node.build.changesDetected ?? 0}</tspan>
                <tspan fill="currentColor" opacity={0.3}>/</tspan>
                <tspan fill="#ef4444">{node.build.failedCount ?? 0}</tspan>
              </text>
              <text
                x={node.x + NODE_R + 6}
                y={node.y + 10}
                fontSize={9}
                fill="currentColor"
                opacity={0.4}
              >
                {formatDuration(node.build.elapsedMs)}
                {isMainBaseline && (
                  <tspan fill="#a855f7" opacity={1}> baseline</tspan>
                )}
                {isBranchBaseline && (
                  <tspan fill="#3b82f6" opacity={1}> baseline</tspan>
                )}
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
            {tooltip.build.id === mainBaselineBuildId && (
              <span className="text-purple-500 font-normal ml-1">Main Baseline</span>
            )}
            {tooltip.build.id === branchBaselineBuildId && (
              <span className="text-blue-500 font-normal ml-1">Branch Baseline</span>
            )}
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
