/**
 * App Map graph builder.
 *
 * Merges a repo's pages/URLs from four discovery sources into a single
 * node-network:
 *   - source-code route scan  (`routes` table)
 *   - the app's sitemap.xml    (fetched live)
 *   - the QA agent's live crawl (agent_sessions.metadata.qaDiscovery)
 *   - URL trajectories captured during test runs (test_results.urlTrajectory)
 *
 * Nodes are keyed by a canonical path so dynamic-param variants collapse
 * (`/orders/123`, `/orders/[id]`, `/orders/:id` → one `/orders/:id` node).
 * Edges come from crawl links, trajectory step adjacency, and redirect chains.
 * Each node is decorated with the best test screenshot covering it (if any) and
 * a coverage status the UI uses to drive the "Ask QA agent to cover" CTA.
 *
 * Pure data — no layout (positions are computed client-side by dagre).
 */

import {
  getRoutesByRepo,
  getFunctionalAreasByRepo,
  getTestsByRepo,
  getLatestAgentSession,
  getEnvironmentConfig,
  getRepository,
  getLatestTestResultsWithTrajectoryByRepo,
} from "@/lib/db/queries";
import type {
  QaDiscovery,
  CapturedScreenshot,
  UrlTrajectoryStep,
} from "@/lib/db/schema";
import { fetchSitemapUrls } from "./sitemap";

export type AppMapSource = "route" | "sitemap" | "crawl" | "trajectory";
export type CoverageStatus = "covered" | "planned" | "uncovered";
export type AppMapEdgeKind = "link" | "nav" | "redirect";

export interface AppMapScreenshot {
  /** Storage path — rendered as `/api/media${path}`. */
  path: string;
  testId: string;
  testName?: string;
  stepLabel?: string;
  capturedAt: string | null;
  gitBranch?: string;
}

export interface AppMapNode {
  /** Canonical path — stable node id (e.g. "/orders/:id"). */
  id: string;
  /** Best absolute URL for display / open-in-new-tab. */
  url: string;
  /** Canonical path portion. */
  path: string;
  title: string | null;
  sources: AppMapSource[];
  area: string | null;
  functionalAreaId: string | null;
  routeId: string | null;
  hasTest: boolean;
  coverageStatus: CoverageStatus;
  /** Discovered by crawl/tests but not in the source route list. */
  isExtraPath: boolean;
  screenshot?: AppMapScreenshot;
  apiEndpoints: Array<{ method: string; path: string }>;
}

export interface AppMapEdge {
  id: string;
  source: string;
  target: string;
  kind: AppMapEdgeKind;
}

export interface AppMapGraph {
  nodes: AppMapNode[];
  edges: AppMapEdge[];
  baseUrl: string;
  branch: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    coveredCount: number;
    uncoveredCount: number;
    extraCount: number;
  };
  sourcesAvailable: {
    routes: boolean;
    sitemap: boolean;
    crawl: boolean;
    trajectories: boolean;
  };
}

const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|map|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|mp3|wav|txt|json|xml|rss|csv)$/i;
const NON_PAGE_PREFIX_RE =
  /^\/(_next|api|static|assets|_static|cdn-cgi)(\/|$)/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduce a raw href/path to a canonical path used as the node id.
 * Mirrors the segment rules of `normalizeTrajectoryUrl` (digits → :id, long
 * hex → :hash) and additionally folds framework dynamic-route syntax
 * (`[id]`, `{id}`, `:id`). Returns null for external / asset / non-page URLs.
 *
 * @param base           URL/origin to resolve relative hrefs against ("" = none)
 * @param restrictOrigins if set, drop absolute URLs whose origin is not a known
 *                        app origin (used to filter external links out of edges)
 */
export function canonicalPath(
  raw: string,
  base: string,
  restrictOrigins: Set<string> | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  // Reject any explicit scheme that isn't http(s): mailto:, tel:, javascript:,
  // data:, blob:, and non-navigable browser URLs (about:blank,
  // chrome-error://…, chrome://…) that show up in trajectories of failed runs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const isAbsolute = /^https?:\/\//i.test(trimmed);
  const isRelativeUrlish =
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../");

  let pathname: string;
  if (isAbsolute || (base && isRelativeUrlish)) {
    let u: URL;
    try {
      u = new URL(trimmed, base || undefined);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (restrictOrigins && isAbsolute && !restrictOrigins.has(u.origin)) {
      return null; // external link
    }
    pathname = u.pathname;
  } else {
    // Path-only route ("/orders/[id]") or a relative href with no base.
    pathname = trimmed.split("#")[0]!.split("?")[0]!;
    if (!pathname.startsWith("/")) pathname = "/" + pathname;
  }

  if (ASSET_RE.test(pathname) || NON_PAGE_PREFIX_RE.test(pathname)) return null;

  const normalized = pathname
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^\[.+\]$/.test(seg)) return ":id"; // Next [id] / [...slug]
      if (/^\{.+\}$/.test(seg)) return ":id"; // {id}
      if (/^:.+/.test(seg)) return ":id"; // :id
      if (/^\d+$/.test(seg)) return ":id"; // 123
      if (UUID_RE.test(seg)) return ":id"; // uuid
      if (/^[0-9a-f]{24,}$/i.test(seg)) return ":hash"; // long hex
      return seg;
    })
    .join("/");

  const cleaned =
    normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return cleaned || "/";
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const GENERIC_LABEL_RE = /^(step\s*\d+|screenshot\s*\d*|shot\s*\d*)$/i;

interface MutableNode extends AppMapNode {
  _sources: Set<AppMapSource>;
  _screenshotRank: number; // higher = better
}

export async function buildAppMap(
  repositoryId: string,
  opts: { branch?: string; includeSitemap?: boolean } = {},
): Promise<AppMapGraph> {
  const [repo, envConfig, routeRows, areaRows, testRows, qaSession] =
    await Promise.all([
      getRepository(repositoryId),
      getEnvironmentConfig(repositoryId),
      getRoutesByRepo(repositoryId),
      getFunctionalAreasByRepo(repositoryId),
      getTestsByRepo(repositoryId),
      getLatestAgentSession(repositoryId, "qa"),
    ]);

  const branch =
    opts.branch ?? repo?.selectedBranch ?? repo?.defaultBranch ?? "main";
  const rawBase = repo?.branchBaseUrls?.[branch] ?? envConfig?.baseUrl ?? "";
  const baseOrigin = rawBase ? (safeOrigin(rawBase) ?? "") : "";

  // Branch preference is resolved above; the query returns latest-per-test.
  const trajectoryResults = await getLatestTestResultsWithTrajectoryByRepo(
    repositoryId,
    branch,
  );

  const discovery = (qaSession?.metadata?.qaDiscovery ??
    null) as QaDiscovery | null;
  const crawledPages = discovery?.crawledPages ?? [];

  // ── Known app origins (define what counts as "internal" for link edges) ──
  const appOrigins = new Set<string>();
  if (baseOrigin) appOrigins.add(baseOrigin);
  if (discovery?.targetUrl) {
    const o = safeOrigin(discovery.targetUrl);
    if (o) appOrigins.add(o);
  }
  for (const page of crawledPages) {
    const o = safeOrigin(page.finalUrl || page.url);
    if (o) appOrigins.add(o);
  }
  for (const r of trajectoryResults) {
    for (const step of (r.urlTrajectory ?? []) as UrlTrajectoryStep[]) {
      const o = safeOrigin(step.finalUrl);
      if (o) appOrigins.add(o);
    }
  }
  const primaryOrigin = baseOrigin || [...appOrigins][0] || "";
  const origins = appOrigins.size > 0 ? appOrigins : null;

  // ── Area lookups ──
  const areaNameById = new Map(areaRows.map((a) => [a.id, a.name]));
  const areasWithTests = new Set(
    testRows.map((t) => t.functionalAreaId).filter((x): x is string => !!x),
  );

  // ── Node/edge accumulators ──
  const nodes = new Map<string, MutableNode>();
  const edges = new Map<string, AppMapEdge>();

  function upsert(
    id: string,
    patch: Partial<AppMapNode> & { source: AppMapSource; isExtra?: boolean },
  ): MutableNode {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        url: primaryOrigin ? primaryOrigin + id : id,
        path: id,
        title: null,
        sources: [],
        area: null,
        functionalAreaId: null,
        routeId: null,
        hasTest: false,
        coverageStatus: "uncovered",
        isExtraPath: patch.isExtra ?? false,
        apiEndpoints: [],
        _sources: new Set(),
        _screenshotRank: -1,
      };
      nodes.set(id, node);
    }
    node._sources.add(patch.source);
    if (patch.title && !node.title) node.title = patch.title;
    if (patch.area && !node.area) node.area = patch.area;
    if (patch.functionalAreaId && !node.functionalAreaId)
      node.functionalAreaId = patch.functionalAreaId;
    if (patch.routeId && !node.routeId) node.routeId = patch.routeId;
    if (patch.hasTest) node.hasTest = true;
    // A node stays "extra" only if EVERY producing source considered it extra.
    if (patch.isExtra === false) node.isExtraPath = false;
    return node;
  }

  const PRIORITY: Record<AppMapEdgeKind, number> = {
    redirect: 3,
    nav: 2,
    link: 1,
  };
  function addEdge(source: string, target: string, kind: AppMapEdgeKind) {
    if (!source || !target || source === target) return;
    const key = `${source} ${target}`;
    const existing = edges.get(key);
    if (!existing || PRIORITY[kind] > PRIORITY[existing.kind]) {
      edges.set(key, { id: key.replace(" ", "->"), source, target, kind });
    }
  }

  // 1. Routes (source-of-record; never "extra") ──────────────────────────────
  for (const route of routeRows) {
    const id = canonicalPath(route.path, "", null);
    if (!id) continue;
    upsert(id, {
      source: "route",
      isExtra: false,
      functionalAreaId: route.functionalAreaId ?? undefined,
      area: route.functionalAreaId
        ? (areaNameById.get(route.functionalAreaId) ?? undefined)
        : undefined,
      routeId: route.id,
      hasTest: !!route.hasTest,
    });
  }

  // 2. Sitemap ────────────────────────────────────────────────────────────────
  let sitemapUsed = false;
  if (opts.includeSitemap !== false && rawBase) {
    const locs = await fetchSitemapUrls(rawBase);
    sitemapUsed = locs.length > 0;
    for (const loc of locs) {
      const id = canonicalPath(loc, primaryOrigin, null);
      if (!id) continue;
      const isNew = !nodes.has(id);
      upsert(id, { source: "sitemap", isExtra: isNew });
    }
  }

  // 3. Crawl (nodes + link edges) ──────────────────────────────────────────────
  for (const page of crawledPages) {
    const pageBase = page.finalUrl || page.url;
    const pageId = canonicalPath(pageBase, primaryOrigin, origins);
    if (!pageId) continue;
    const isNew = !nodes.has(pageId);
    const node = upsert(pageId, {
      source: "crawl",
      isExtra: isNew,
      title: page.title ?? undefined,
    });
    if (page.apiEndpoints?.length && node.apiEndpoints.length === 0) {
      const seen = new Set<string>();
      for (const ep of page.apiEndpoints) {
        const k = `${ep.method} ${ep.path}`;
        if (seen.has(k)) continue;
        seen.add(k);
        node.apiEndpoints.push({ method: ep.method, path: ep.path });
      }
    }
    for (const link of page.links ?? []) {
      const targetId = canonicalPath(link.href, pageBase, origins);
      if (!targetId) continue;
      if (!nodes.has(targetId))
        upsert(targetId, { source: "crawl", isExtra: true });
      addEdge(pageId, targetId, "link");
    }
  }

  // 4. Trajectories (nodes + nav/redirect edges) + screenshot resolution ───────
  for (const r of trajectoryResults) {
    const traj = ((r.urlTrajectory ?? []) as UrlTrajectoryStep[])
      .slice()
      .sort((a, b) => a.stepIndex - b.stepIndex);
    const shots = (r.screenshots ?? []) as CapturedScreenshot[];
    const branchMatch = r.gitBranch === branch;
    const capturedAt = r.startedAt ? new Date(r.startedAt).toISOString() : null;

    // step nodes + adjacency + redirect edges
    const stepIds: (string | null)[] = [];
    const labelToUrl = new Map<string, string>();
    for (const step of traj) {
      if (step.stepLabel) labelToUrl.set(step.stepLabel, step.finalUrl);
      const id = canonicalPath(step.finalUrl, primaryOrigin, origins);
      stepIds.push(id);
      if (id) {
        const isNew = !nodes.has(id);
        upsert(id, { source: "trajectory", isExtra: isNew, hasTest: true });
      }
      // redirect hops within this step
      const chain = step.redirectChain ?? [];
      let prev: string | null = null;
      for (const hop of chain) {
        const hopId = canonicalPath(hop, primaryOrigin, origins);
        if (hopId && prev && prev !== hopId) addEdge(prev, hopId, "redirect");
        if (hopId) prev = hopId;
      }
      if (prev && id && prev !== id) addEdge(prev, id, "redirect");
    }
    for (let i = 0; i < stepIds.length - 1; i++) {
      const a = stepIds[i];
      const b = stepIds[i + 1];
      if (a && b) addEdge(a, b, "nav");
    }

    // screenshot → node association
    const attach = (nodeId: string, shot: CapturedScreenshot) => {
      const node = nodes.get(nodeId);
      if (!node) return;
      const labelSpecific = shot.label
        ? !GENERIC_LABEL_RE.test(shot.label)
        : false;
      const startedMs = r.startedAt ? new Date(r.startedAt).getTime() : 0;
      // Rank: branch match dominates, then recency, then a specific label.
      const rank =
        (branchMatch ? 4_000_000_000_000 : 0) +
        startedMs +
        (labelSpecific ? 1 : 0);
      if (rank <= node._screenshotRank) return;
      node._screenshotRank = rank;
      node.screenshot = {
        path: shot.path,
        testId: r.testId ?? "",
        testName: r.testName ?? undefined,
        stepLabel: shot.label,
        capturedAt,
        gitBranch: r.gitBranch,
      };
      node.hasTest = true;
    };

    if (shots.length > 0) {
      let matchedAny = false;
      for (const shot of shots) {
        const url = shot.label ? labelToUrl.get(shot.label) : undefined;
        if (!url) continue;
        const id = canonicalPath(url, primaryOrigin, origins);
        if (id) {
          attach(id, shot);
          matchedAny = true;
        }
      }
      if (!matchedAny && shots.length === traj.length) {
        // positional zip fallback
        for (let i = 0; i < shots.length; i++) {
          const id = stepIds[i];
          if (id) attach(id, shots[i]!);
        }
      } else if (!matchedAny && shots.length === 1) {
        // single-shot: attribute to the final page reached
        const lastId = [...stepIds].reverse().find((x) => x);
        if (lastId) attach(lastId, shots[0]!);
      }
    }
  }

  // ── Finalize: coverage status, sources array, drop dangling edges ──
  const finalNodes: AppMapNode[] = [];
  for (const node of nodes.values()) {
    const order: AppMapSource[] = ["route", "sitemap", "crawl", "trajectory"];
    node.sources = order.filter((s) => node._sources.has(s));
    const areaHasTests =
      node.functionalAreaId && areasWithTests.has(node.functionalAreaId);
    node.coverageStatus = node.screenshot
      ? "covered"
      : node.hasTest || areaHasTests
        ? "planned"
        : "uncovered";
    const { _sources, _screenshotRank, ...clean } = node;
    void _sources;
    void _screenshotRank;
    finalNodes.push(clean);
  }
  const nodeIds = new Set(finalNodes.map((n) => n.id));
  const finalEdges = [...edges.values()].filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  const coveredCount = finalNodes.filter(
    (n) => n.coverageStatus === "covered",
  ).length;
  const uncoveredCount = finalNodes.filter(
    (n) => n.coverageStatus === "uncovered",
  ).length;
  const extraCount = finalNodes.filter((n) => n.isExtraPath).length;

  return {
    nodes: finalNodes,
    edges: finalEdges,
    baseUrl: rawBase,
    branch,
    stats: {
      nodeCount: finalNodes.length,
      edgeCount: finalEdges.length,
      coveredCount,
      uncoveredCount,
      extraCount,
    },
    sourcesAvailable: {
      routes: routeRows.length > 0,
      sitemap: sitemapUsed,
      crawl: crawledPages.length > 0,
      trajectories: trajectoryResults.length > 0,
    },
  };
}
