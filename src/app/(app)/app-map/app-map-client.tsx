"use client";

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  Maximize2,
  Minimize2,
  Lock,
  RefreshCw,
  ExternalLink,
  ImageOff,
  Camera,
  X,
  Waypoints,
  Home,
  Filter,
  Plus,
} from "lucide-react";
import {
  getAppMap,
  requestCoverage,
  type GetAppMapResult,
} from "@/server/actions/app-map";
import type {
  AppMapGraph,
  AppMapNode,
  AppMapEdge,
  CoverageStatus,
} from "@/lib/app-map/build-map";

// ── Layout constants ──────────────────────────────────────────────────────────
// Thumbnail is 16:9 (matches the default 1920×1080 run viewport), so
// NODE_H = 248 * 9/16 (≈140) + card body (~82).
const NODE_W = 248;
const NODE_H = 222;

const COVERAGE_COLOR: Record<CoverageStatus, string> = {
  covered: "#3f9142",
  planned: "#E09836",
  uncovered: "#9ca3af",
};
const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  covered: "Covered",
  planned: "Planned",
  uncovered: "No coverage",
};

function edgeStyle(kind: AppMapEdge["kind"]): React.CSSProperties {
  if (kind === "redirect")
    return { stroke: "#E09836", strokeWidth: 1.5, strokeDasharray: "5 4" };
  if (kind === "nav") return { stroke: "#3674A8", strokeWidth: 1.5 };
  return { stroke: "#c4c9d4", strokeWidth: 1 };
}

interface PageNodeData extends Record<string, unknown> {
  node: AppMapNode;
  isRoot: boolean;
  queued: boolean;
  requesting: boolean;
  qaAgentEnabled: boolean;
  onRequestCoverage: (node: AppMapNode) => void;
}

/** dagre positions, keyed by node id. Computed once per graph. */
function computePositions(nodes: AppMapNode[], edges: AppMapEdge[]) {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 48,
    ranksep: 96,
    marginx: 48,
    marginy: 48,
  });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target))
      g.setEdge(e.source, e.target);
  });
  Dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    positions.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return positions;
}

/** Glob-style exclude pattern → regex. `*` matches any characters, so
 *  `/r/*` hides `/r/abc` (and deeper). Case-insensitive full match. */
function patternToRegex(pattern: string): RegExp | null {
  const cleaned = pattern.trim();
  if (!cleaned) return null;
  try {
    const escaped = cleaned
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  } catch {
    return null;
  }
}

/** Suggest exclude patterns: first path segments that fan out into many
 *  same-shaped pages (share slugs, blog posts…) — prime filter candidates. */
function suggestPatterns(nodes: AppMapNode[], existing: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const seg = n.path.split("/")[1];
    if (seg) counts.set(`/${seg}/*`, (counts.get(`/${seg}/*`) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([p, c]) => c >= 5 && !existing.includes(p))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p]) => p);
}

/** Pick the map root: "/" if present, else the source-most node (no incoming
 *  edges, highest out-degree). */
function pickRootId(nodes: AppMapNode[], edges: AppMapEdge[]): string | null {
  if (nodes.some((n) => n.id === "/")) return "/";
  const incoming = new Set(edges.map((e) => e.target));
  const outDeg = new Map<string, number>();
  for (const e of edges) outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
  let best: string | null = null;
  let bestDeg = -1;
  for (const n of nodes) {
    if (incoming.has(n.id)) continue;
    const d = outDeg.get(n.id) ?? 0;
    if (d > bestDeg) {
      bestDeg = d;
      best = n.id;
    }
  }
  return best ?? nodes[0]?.id ?? null;
}

// ── Custom node ───────────────────────────────────────────────────────────────
const PageNode = memo(function PageNode({ data }: NodeProps) {
  const {
    node,
    isRoot,
    queued,
    requesting,
    qaAgentEnabled,
    onRequestCoverage,
  } = data as PageNodeData;
  const covered = node.coverageStatus === "covered";

  return (
    <div
      className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden"
      style={{ width: NODE_W }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground/60"
      />

      {/* Thumbnail — 16:9, the default run viewport ratio; full-page shots
          show their above-the-fold region (object-top) instead of a squash. */}
      <div className="relative aspect-video w-full bg-muted flex items-center justify-center">
        {node.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media${node.screenshot.path}`}
            alt={node.title ?? node.path}
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageOff className="h-5 w-5" />
            <span className="text-[10px]">No screenshot</span>
          </div>
        )}
        <span
          className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: COVERAGE_COLOR[node.coverageStatus] }}
        >
          {COVERAGE_LABEL[node.coverageStatus]}
        </span>
        {isRoot && (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center rounded-full bg-black/60 p-1 text-white">
            <Home className="h-3 w-3" />
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-2 space-y-1.5">
        <div
          className="truncate text-xs font-medium"
          title={node.title ?? node.path}
        >
          {node.title ?? node.path}
        </div>
        <div
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={node.path}
        >
          {node.path}
        </div>
        <div className="flex flex-wrap gap-1">
          {node.sources.map((s) => (
            <span
              key={s}
              className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground"
            >
              {s}
            </span>
          ))}
          {node.isExtraPath && (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              extra
            </span>
          )}
        </div>

        {!covered &&
          (qaAgentEnabled ? (
            <button
              type="button"
              disabled={queued || requesting}
              onClick={(e) => {
                e.stopPropagation();
                onRequestCoverage(node);
              }}
              className="mt-1 w-full rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
            >
              {queued
                ? "Queued for QA agent"
                : requesting
                  ? "Queuing…"
                  : "Ask QA agent to cover"}
            </button>
          ) : (
            <a
              href="/settings"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
            >
              <Lock className="h-3 w-3" /> Cover with QA agent · Pro
            </a>
          ))}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground/60"
      />
    </div>
  );
});

const nodeTypes = { page: PageNode };

// ── Main client ───────────────────────────────────────────────────────────────
interface AppMapClientProps {
  initialGraph: AppMapGraph | null;
  emptyReason: "no-repo" | "no-data" | null;
  repositoryId: string;
  branch: string;
  qaAgentEnabled: boolean;
}

export function AppMapClient({
  initialGraph,
  emptyReason,
  repositoryId,
  branch,
  qaAgentEnabled,
}: AppMapClientProps) {
  const [graph, setGraph] = useState<AppMapGraph | null>(initialGraph);
  const [selected, setSelected] = useState<AppMapNode | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Exclude filters (glob patterns like "/r/*"), persisted per repo ──
  // Loaded after mount (not in the initializer) to keep SSR/client HTML equal.
  const filterStorageKey = `app-map:filters:${repositoryId}`;
  const [excludePatterns, setExcludePatterns] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [patternDraft, setPatternDraft] = useState("");
  const filtersLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(filterStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setExcludePatterns(parsed.filter((p) => typeof p === "string"));
        }
      }
    } catch {
      // corrupted entry — start clean
    }
    filtersLoadedRef.current = true;
  }, [filterStorageKey]);
  useEffect(() => {
    if (!filtersLoadedRef.current) return;
    try {
      localStorage.setItem(filterStorageKey, JSON.stringify(excludePatterns));
    } catch {
      // storage full/blocked — filter still works for the session
    }
  }, [excludePatterns, filterStorageKey]);

  const addPattern = useCallback((pattern: string) => {
    const cleaned = pattern.trim();
    if (!cleaned || !patternToRegex(cleaned)) return;
    setExcludePatterns((prev) =>
      prev.includes(cleaned) ? prev : [...prev, cleaned],
    );
    setPatternDraft("");
  }, []);
  const removePattern = useCallback((pattern: string) => {
    setExcludePatterns((prev) => prev.filter((p) => p !== pattern));
  }, []);

  // Fullscreen wiring (native) — reuse the video-player pattern.
  useEffect(() => {
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const onRequestCoverage = useCallback(
    async (node: AppMapNode) => {
      if (!qaAgentEnabled) return;
      setRequesting(node.path);
      try {
        await requestCoverage({ path: node.path, url: node.url });
        setQueued((q) => {
          const next = new Set(q);
          next.add(node.path);
          return next;
        });
        toast.success("Queued for the QA agent", { description: node.path });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not queue this page",
        );
      } finally {
        setRequesting(null);
      }
    },
    [qaAgentEnabled],
  );

  const refresh = useCallback(() => {
    startRefresh(async () => {
      try {
        const result: GetAppMapResult = await getAppMap({ branch });
        if (result.ok) {
          setGraph(result.graph);
          toast.success("App map refreshed");
        } else {
          toast.message("Nothing to map yet");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not refresh the map",
        );
      }
    });
  }, [branch]);

  // Apply exclude filters, then drop edges whose endpoints were hidden.
  const filtered = useMemo(() => {
    const allNodes = graph?.nodes ?? [];
    const allEdges = graph?.edges ?? [];
    const regexes = excludePatterns
      .map(patternToRegex)
      .filter((r): r is RegExp => r !== null);
    if (regexes.length === 0) {
      return { nodes: allNodes, edges: allEdges, hiddenCount: 0 };
    }
    const nodes = allNodes.filter((n) => !regexes.some((r) => r.test(n.path)));
    const kept = new Set(nodes.map((n) => n.id));
    const edges = allEdges.filter(
      (e) => kept.has(e.source) && kept.has(e.target),
    );
    return { nodes, edges, hiddenCount: allNodes.length - nodes.length };
  }, [graph, excludePatterns]);

  const suggestions = useMemo(
    () => suggestPatterns(graph?.nodes ?? [], excludePatterns),
    [graph, excludePatterns],
  );

  const rootId = useMemo(
    () => pickRootId(filtered.nodes, filtered.edges),
    [filtered],
  );
  const positions = useMemo(
    () => computePositions(filtered.nodes, filtered.edges),
    [filtered],
  );

  const rfNodes: Node[] = useMemo(
    () =>
      filtered.nodes.map((n) => ({
        id: n.id,
        type: "page",
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        // Explicit dimensions so the MiniMap can draw every node immediately
        // (it renders nothing for nodes it can't size before first measure).
        width: NODE_W,
        height: NODE_H,
        data: {
          node: n,
          isRoot: n.id === rootId,
          queued: queued.has(n.path),
          requesting: requesting === n.path,
          qaAgentEnabled,
          onRequestCoverage,
        } satisfies PageNodeData,
      })),
    [
      filtered,
      positions,
      rootId,
      queued,
      requesting,
      qaAgentEnabled,
      onRequestCoverage,
    ],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      filtered.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.kind === "redirect",
        style: edgeStyle(e.kind),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeStyle(e.kind).stroke as string,
        },
      })),
    [filtered],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  useEffect(() => setNodes(rfNodes), [rfNodes, setNodes]);
  useEffect(() => setEdges(rfEdges), [rfEdges, setEdges]);

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => setSelected((n.data as PageNodeData).node),
    [],
  );

  if (!graph) {
    return (
      <EmptyState
        reason={emptyReason}
        onRefresh={refresh}
        refreshing={refreshing}
      />
    );
  }

  const coveredCount = filtered.nodes.filter(
    (n) => n.coverageStatus === "covered",
  ).length;
  const uncoveredCount = filtered.nodes.filter(
    (n) => n.coverageStatus === "uncovered",
  ).length;

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 bg-background">
      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        <Waypoints className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">App Map</span>
        <span className="text-xs text-muted-foreground">
          {filtered.nodes.length} pages · {coveredCount} covered ·{" "}
          {uncoveredCount} uncovered
          {filtered.hiddenCount > 0 && ` · ${filtered.hiddenCount} hidden`}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {graph.branch}
        </span>
      </div>

      {/* Legend + actions */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 text-[11px] shadow-sm backdrop-blur sm:flex">
          {(["covered", "planned", "uncovered"] as CoverageStatus[]).map(
            (c) => (
              <span key={c} className="flex items-center gap-1">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: COVERAGE_COLOR[c] }}
                />
                {COVERAGE_LABEL[c]}
              </span>
            ),
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className={`flex items-center gap-1 rounded-lg border bg-card/95 px-2.5 py-2 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted ${
              excludePatterns.length > 0 ? "text-primary border-primary/40" : ""
            }`}
            title="Filter pages"
          >
            <Filter className="h-4 w-4" />
            {excludePatterns.length > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {excludePatterns.length}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border bg-card p-3 shadow-xl">
              <div className="mb-2 text-xs font-semibold">Hide pages</div>
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  addPattern(patternDraft);
                }}
              >
                <input
                  value={patternDraft}
                  onChange={(e) => setPatternDraft(e.target.value)}
                  placeholder="/r/*"
                  className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!patternDraft.trim()}
                  className="flex h-7 items-center gap-1 rounded-md border bg-muted px-2 text-xs font-medium hover:bg-muted/70 disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              </form>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Glob patterns against the page path — <code>*</code> matches
                anything.
              </p>

              {excludePatterns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {excludePatterns.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => removePattern(p)}
                      className="group flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 font-mono text-[11px] hover:border-destructive/50"
                      title="Remove filter"
                    >
                      {p}
                      <X className="h-3 w-3 text-muted-foreground group-hover:text-destructive" />
                    </button>
                  ))}
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Suggested
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {suggestions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => addPattern(p)}
                        className="flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="h-3 w-3" /> {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filtered.hiddenCount > 0 && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {filtered.hiddenCount} page
                  {filtered.hiddenCount === 1 ? "" : "s"} hidden
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1 rounded-lg border bg-card/95 px-2.5 py-2 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted disabled:opacity-60"
          title="Rebuild the map"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center gap-1 rounded-lg border bg-card/95 px-2.5 py-2 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        nodesDraggable
        fitView
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            COVERAGE_COLOR[
              ((n.data as PageNodeData)?.node?.coverageStatus ??
                "uncovered") as CoverageStatus
            ]
          }
        />
      </ReactFlow>

      {selected && (
        <NodeDetailPanel
          node={selected}
          queued={queued.has(selected.path)}
          requesting={requesting === selected.path}
          qaAgentEnabled={qaAgentEnabled}
          onRequestCoverage={onRequestCoverage}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── Detail panel (in-container so it renders in fullscreen too) ───────────────
function NodeDetailPanel({
  node,
  queued,
  requesting,
  qaAgentEnabled,
  onRequestCoverage,
  onClose,
}: {
  node: AppMapNode;
  queued: boolean;
  requesting: boolean;
  qaAgentEnabled: boolean;
  onRequestCoverage: (node: AppMapNode) => void;
  onClose: () => void;
}) {
  const covered = node.coverageStatus === "covered";
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l bg-card shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {node.title ?? node.path}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {node.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {node.screenshot ? (
          <a
            href={`/api/media${node.screenshot.path}`}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media${node.screenshot.path}`}
              alt={node.path}
              className="w-full object-cover"
            />
          </a>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-md border bg-muted text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="text-xs">No screenshot captured yet</span>
          </div>
        )}

        <Row label="Coverage">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: COVERAGE_COLOR[node.coverageStatus] }}
          >
            {COVERAGE_LABEL[node.coverageStatus]}
          </span>
        </Row>

        <Row label="URL">
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-primary hover:underline"
          >
            {node.url} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </Row>

        <Row label="Sources">
          <div className="flex flex-wrap gap-1">
            {node.sources.map((s) => (
              <span
                key={s}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {s}
              </span>
            ))}
            {node.isExtraPath && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                extra path
              </span>
            )}
          </div>
        </Row>

        {node.area && <Row label="Area">{node.area}</Row>}

        {node.screenshot?.testName && (
          <Row label="Covered by">
            <span className="inline-flex items-center gap-1">
              <Camera className="h-3 w-3" /> {node.screenshot.testName}
            </span>
          </Row>
        )}

        {node.apiEndpoints.length > 0 && (
          <Row label="API calls">
            <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {node.apiEndpoints.slice(0, 12).map((ep, i) => (
                <div key={i} className="truncate">
                  <span className="text-foreground">{ep.method}</span> {ep.path}
                </div>
              ))}
            </div>
          </Row>
        )}
      </div>

      {!covered && (
        <div className="border-t p-3">
          {qaAgentEnabled ? (
            <button
              type="button"
              disabled={queued || requesting}
              onClick={() => onRequestCoverage(node)}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {queued
                ? "Queued for QA agent"
                : requesting
                  ? "Queuing…"
                  : "Ask QA agent to cover this page"}
            </button>
          ) : (
            <a
              href="/settings"
              className="flex w-full items-center justify-center gap-1 rounded-md border bg-muted px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/70"
            >
              <Lock className="h-4 w-4" /> QA agent coverage is a Pro feature
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({
  reason,
  onRefresh,
  refreshing,
}: {
  reason: "no-repo" | "no-data" | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Waypoints className="h-10 w-10 text-muted-foreground" />
      <div className="text-lg font-semibold">No pages to map yet</div>
      <p className="max-w-md text-sm text-muted-foreground">
        {reason === "no-repo"
          ? "Select a repository to build its app map."
          : "Run a route scan or a QA agent crawl, or run a test that walks the app, and the discovered pages will appear here as a connected map."}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        Rebuild map
      </button>
    </div>
  );
}
