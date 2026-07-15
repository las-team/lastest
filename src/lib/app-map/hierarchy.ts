/**
 * App Map hierarchy — spanning tree over the map graph.
 *
 * With an entry root chosen, the map renders as a clean single-rooted
 * top-down hierarchy: dagre is fed only the spanning-tree edges, non-tree
 * edges render dimmed/dashed, and nodes unreachable from the root park in a
 * bottom "unlinked" rank. The tree also drives the outline sidebar.
 *
 * Pure data — no layout, no React.
 */

import type {
  AppMapNode,
  AppMapEdge,
  AppMapEdgeKind,
} from "@/lib/app-map/build-map";

export interface SpanningTree {
  rootId: string;
  /** nodeId → parent nodeId (root maps to null). Only reachable nodes. */
  parent: Map<string, string | null>;
  /** nodeId → ordered child nodeIds (path-sorted for a stable outline). */
  children: Map<string, string[]>;
  /** nodeId → hop depth from root (root = 0). Only reachable nodes. */
  depth: Map<string, number>;
  /** Edge ids that form the tree (subset of the input edges). */
  treeEdgeIds: Set<string>;
  /** Nodes not reachable from the root, path-sorted. */
  unreachable: string[];
}

/** Edge preference when several edges reach the same undiscovered node. */
const KIND_PRIORITY: Record<AppMapEdgeKind, number> = {
  nav: 3,
  redirect: 2,
  link: 1,
};

/**
 * BFS spanning tree from `rootId` over the directed edges. When multiple
 * same-depth edges discover a node, the higher-priority kind wins
 * (`nav > redirect > link`; source path breaks remaining ties) so the tree
 * follows real user navigation over incidental links.
 */
export function buildSpanningTree(
  nodes: AppMapNode[],
  edges: AppMapEdge[],
  rootId: string,
): SpanningTree | null {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(rootId)) return null;

  const out = new Map<string, AppMapEdge[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }

  const parent = new Map<string, string | null>([[rootId, null]]);
  const depth = new Map<string, number>([[rootId, 0]]);
  const treeEdgeIds = new Set<string>();
  const parentEdge = new Map<string, AppMapEdge>();

  let frontier = [rootId];
  while (frontier.length > 0) {
    // Best discovering edge per target across the whole level, so kind
    // priority is applied level-wide rather than per expansion order.
    const discovered = new Map<string, AppMapEdge>();
    for (const source of frontier) {
      for (const e of out.get(source) ?? []) {
        if (parent.has(e.target)) continue;
        const prev = discovered.get(e.target);
        if (
          !prev ||
          KIND_PRIORITY[e.kind] > KIND_PRIORITY[prev.kind] ||
          (KIND_PRIORITY[e.kind] === KIND_PRIORITY[prev.kind] &&
            e.source < prev.source)
        ) {
          discovered.set(e.target, e);
        }
      }
    }
    const next: string[] = [];
    for (const [target, e] of discovered) {
      parent.set(target, e.source);
      depth.set(target, (depth.get(e.source) ?? 0) + 1);
      treeEdgeIds.add(e.id);
      parentEdge.set(target, e);
      next.push(target);
    }
    frontier = next;
  }

  const children = new Map<string, string[]>();
  for (const [child, p] of parent) {
    if (p === null) continue;
    const list = children.get(p);
    if (list) list.push(child);
    else children.set(p, [child]);
  }
  for (const list of children.values()) list.sort();

  const unreachable = nodes
    .map((n) => n.id)
    .filter((id) => !parent.has(id))
    .sort();

  return { rootId, parent, children, depth, treeEdgeIds, unreachable };
}
