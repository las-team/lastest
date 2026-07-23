/**
 * App Map explorer swarm (QA agent mode = "explore", explorers > 1).
 *
 * N explorers = N EB pods, all crawling in ONE Node process / one session,
 * sharing an in-memory frontier + visited set:
 *   - Partitioning: first path segments are assigned round-robin to explorers
 *     as they're discovered; work-stealing keeps nobody idle; the shared
 *     visited set guarantees no duplicate visits.
 *   - Dedupe: visited is keyed on the normalized href AND the canonical path
 *     (capped at ~2 concrete URLs per canonical path so `/orders/1..999`
 *     doesn't burn the budget).
 *   - Cutoffs: depth, page budget, wall-clock deadline, abort signal.
 *
 * `SharedFrontier` is pure and unit-tested; `exploreTargetApp` does the
 * browser work (CDP connect per EB, storage-state inject or login, loop
 * frontier → goto → extract → add).
 */

import { chromium, type Page } from "playwright";
import type {
  ExploreStrategy,
  QaExploreBlocked,
  QaPageSnapshot,
} from "@/lib/db/schema";
import { canonicalPath } from "@/lib/app-map/canonical";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import { isAuthLink } from "./auth-links";
import { attachPageObservers, attemptLogin, extractDom } from "./crawl";

const PAGE_NAV_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_TIMEOUT_MS = 8_000;
const IDLE_POLL_MS = 250;

const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|mp3|txt|json|xml)(\?|$)/i;

export interface FrontierEntry {
  url: string;
  depth: number;
}

export interface SharedFrontierOptions {
  /** Origin the exploration is confined to. */
  origin: string;
  strategy: ExploreStrategy;
  /** Max link hops from the entry URL (root = 0). */
  maxDepth: number;
  /** Total pages the swarm may map. */
  pageBudget: number;
  /** Number of explorer workers sharing this frontier. */
  explorers: number;
  /** Concrete URLs allowed per canonical path (default 2). */
  maxPerCanonicalPath?: number;
}

/**
 * The swarm's shared work queue. Deterministic and side-effect free — all
 * browser work lives in `exploreTargetApp`.
 */
export class SharedFrontier {
  private readonly opts: Required<SharedFrontierOptions>;
  private readonly queues: FrontierEntry[][];
  private readonly seen = new Set<string>();
  private readonly canonicalCounts = new Map<string, number>();
  private readonly segmentOwner = new Map<string, number>();
  private nextOwner = 0;
  private inFlight = 0;
  private mapped = 0;
  private balancedToggle = false;

  constructor(options: SharedFrontierOptions) {
    this.opts = { maxPerCanonicalPath: 2, ...options };
    this.queues = Array.from({ length: options.explorers }, () => []);
  }

  /** Same-origin normalize: resolve vs base, strip hash, drop assets. */
  private normalize(raw: string, base?: string): string | null {
    if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
    let url: URL;
    try {
      url = new URL(raw, base || this.opts.origin);
    } catch {
      return null;
    }
    if (url.origin !== this.opts.origin) return null;
    if (ASSET_RE.test(url.pathname)) return null;
    url.hash = "";
    return url.href;
  }

  private ownerFor(url: string): number {
    const segment = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
    let owner = this.segmentOwner.get(segment);
    if (owner === undefined) {
      owner = this.nextOwner % this.opts.explorers;
      this.nextOwner++;
      this.segmentOwner.set(segment, owner);
    }
    return owner;
  }

  /**
   * Enqueue a discovered URL. Returns true when it entered the frontier —
   * false for duplicates, foreign origins, over-depth, or canonical-path-cap
   * rejections.
   */
  add(rawUrl: string, depth: number, base?: string): boolean {
    if (depth > this.opts.maxDepth) return false;
    const url = this.normalize(rawUrl, base);
    if (!url || this.seen.has(url)) return false;
    const cp = canonicalPath(url, this.opts.origin, null) ?? url;
    const count = this.canonicalCounts.get(cp) ?? 0;
    if (count >= this.opts.maxPerCanonicalPath) return false;
    this.seen.add(url);
    this.canonicalCounts.set(cp, count + 1);
    this.queues[this.ownerFor(url)]!.push({ url, depth });
    return true;
  }

  /** Mark a served URL's final destination visited too (redirects). */
  markVisited(finalUrl: string): void {
    const url = this.normalize(finalUrl);
    if (url) this.seen.add(url);
  }

  private takeFrom(queue: FrontierEntry[]): FrontierEntry | undefined {
    if (queue.length === 0) return undefined;
    switch (this.opts.strategy) {
      case "breadth":
        return queue.shift();
      case "depth":
        return queue.pop();
      case "balanced":
        this.balancedToggle = !this.balancedToggle;
        return this.balancedToggle ? queue.shift() : queue.pop();
    }
  }

  /**
   * Next entry for an explorer: its own queue first, then work-stealing from
   * the longest other queue. Null when the budget is spent or nothing is
   * queued (the worker should then idle-wait while `inFlightCount > 0`).
   */
  next(explorerIndex: number): FrontierEntry | null {
    if (this.budgetReached()) return null;
    let entry = this.takeFrom(this.queues[explorerIndex] ?? []);
    if (!entry) {
      const richest = this.queues
        .map((q, i) => ({ q, i }))
        .filter(({ q, i }) => i !== explorerIndex && q.length > 0)
        .sort((a, b) => b.q.length - a.q.length)[0];
      if (richest) entry = this.takeFrom(richest.q);
    }
    if (!entry) return null;
    this.inFlight++;
    return entry;
  }

  /** A served entry was mapped. */
  recordMapped(finalUrl: string): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.mapped++;
    this.markVisited(finalUrl);
  }

  /** A served entry failed to load — returns its budget slot. */
  recordFailed(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  budgetReached(): boolean {
    return this.mapped + this.inFlight >= this.opts.pageBudget;
  }

  get pendingCount(): number {
    return this.queues.reduce((n, q) => n + q.length, 0);
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  get mappedCount(): number {
    return this.mapped;
  }
}

/**
 * Final pass over the swarm's raw pages: one snapshot per canonical path —
 * the richest one (most structure), since buildAppMap collapses to canonical
 * nodes anyway and metadata is capped.
 */
export function dedupeRichestByCanonical(
  pages: QaPageSnapshot[],
  origin: string,
): QaPageSnapshot[] {
  const richness = (p: QaPageSnapshot) =>
    p.links.length +
    p.buttons.length +
    p.headings.length +
    p.forms.length * 3 +
    p.apiEndpoints.length;
  const byCanonical = new Map<string, QaPageSnapshot>();
  for (const p of pages) {
    const cp = canonicalPath(p.finalUrl || p.url, origin, null) ?? p.url;
    const current = byCanonical.get(cp);
    if (!current || richness(p) > richness(current)) byCanonical.set(cp, p);
  }
  return [...byCanonical.values()];
}

export interface ExploreTargetAppOptions {
  /** Claimed EBs, one per explorer. Index = explorer index. */
  ebs: Array<{ cdpUrl: string }>;
  targetUrl: string;
  strategy: ExploreStrategy;
  maxDepth: number;
  pageBudget: number;
  /** Epoch-ms wall-clock deadline. */
  deadline: number;
  /** Injected into every EB before crawling (post-auth exploration). */
  storageStateJson?: string;
  /** Fallback login when no storage state: each explorer logs in itself. */
  credentials?: { email: string; password: string };
  loginUrl?: string;
  signal?: AbortSignal;
  onPage?: (
    snapshot: QaPageSnapshot,
    explorerIndex: number,
    totalMapped: number,
  ) => void;
  onExplorerStatus?: (
    explorerIndex: number,
    status: "exploring" | "blocked" | "done" | "failed",
    detail?: string,
  ) => void;
  onBlocked?: (blocked: QaExploreBlocked) => void;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Run the explorer swarm. Resolves when every worker has stopped (budget,
 * deadline, starved frontier, or abort); pages are deduped to the richest
 * snapshot per canonical path.
 */
export async function exploreTargetApp(opts: ExploreTargetAppOptions): Promise<{
  pages: QaPageSnapshot[];
  blocked: QaExploreBlocked[];
  loginAttempted: boolean;
}> {
  const origin = new URL(opts.targetUrl).origin;
  const frontier = new SharedFrontier({
    origin,
    strategy: opts.strategy,
    maxDepth: opts.maxDepth,
    pageBudget: opts.pageBudget,
    explorers: opts.ebs.length,
  });
  frontier.add(opts.targetUrl, 0);

  const rawPages: QaPageSnapshot[] = [];
  const blocked: QaExploreBlocked[] = [];
  const blockedSeen = new Set<string>();
  let loginAttempted = false;
  const authed = Boolean(opts.storageStateJson || opts.credentials);

  const pushBlocked = (entry: QaExploreBlocked) => {
    const key = `${entry.reason} ${entry.url}`;
    if (blockedSeen.has(key)) return;
    blockedSeen.add(key);
    blocked.push(entry);
    opts.onBlocked?.(entry);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function runExplorer(index: number, cdpUrl: string): Promise<void> {
    try {
      // Post-auth exploration: replay the resolved session into THIS pod.
      if (opts.storageStateJson) {
        await injectStorageStateIntoEb(cdpUrl, opts.storageStateJson).catch(
          () => false,
        );
      }
      const browser = await chromium.connectOverCDP(cdpUrl);
      try {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const page: Page = context.pages()[0] ?? (await context.newPage());
        const observers = attachPageObservers(page, origin);

        // No storage state but creds → every explorer logs itself in (each
        // EB is its own browser).
        if (!opts.storageStateJson && opts.credentials && opts.loginUrl) {
          try {
            await page.goto(opts.loginUrl, {
              waitUntil: "domcontentloaded",
              timeout: PAGE_NAV_TIMEOUT_MS,
            });
            await page
              .waitForLoadState("networkidle", {
                timeout: PAGE_SETTLE_TIMEOUT_MS,
              })
              .catch(() => {});
            loginAttempted =
              (await attemptLogin(page, opts.credentials)) || loginAttempted;
          } catch {
            // Best-effort — the crawl still maps the public surface.
          }
        }

        opts.onExplorerStatus?.(index, "exploring");

        while (true) {
          if (opts.signal?.aborted || Date.now() >= opts.deadline) break;
          const entry = frontier.next(index);
          if (!entry) {
            if (frontier.budgetReached()) break;
            if (frontier.inFlightCount === 0 && frontier.pendingCount === 0) {
              break; // starved — nobody can produce more work
            }
            await sleep(IDLE_POLL_MS);
            continue;
          }
          observers.reset();
          try {
            await page.goto(entry.url, {
              waitUntil: "domcontentloaded",
              timeout: PAGE_NAV_TIMEOUT_MS,
            });
            await page
              .waitForLoadState("networkidle", {
                timeout: PAGE_SETTLE_TIMEOUT_MS,
              })
              .catch(() => {});
            const dom = await extractDom(page);
            const snapshot: QaPageSnapshot = {
              url: entry.url,
              ...dom,
              apiEndpoints: observers.endpoints(),
              consoleErrors: observers.consoleErrors(),
            };
            frontier.recordMapped(snapshot.finalUrl);
            rawPages.push(snapshot);
            opts.onPage?.(snapshot, index, frontier.mappedCount);

            // BLOCKED: unauthenticated request bounced to a login screen.
            const bouncedToAuth =
              !authed &&
              snapshot.finalUrl !== entry.url &&
              isAuthLink("", pathnameOf(snapshot.finalUrl)) &&
              !isAuthLink("", pathnameOf(entry.url));
            if (bouncedToAuth) {
              pushBlocked({ url: entry.url, reason: "auth_wall" });
              opts.onExplorerStatus?.(index, "blocked", entry.url);
              continue; // the auth surface itself is mapped; don't expand it
            }

            for (const link of snapshot.links) {
              frontier.add(link.href, entry.depth + 1, snapshot.finalUrl);
            }
          } catch {
            frontier.recordFailed();
          }
        }
        opts.onExplorerStatus?.(index, "done");
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (err) {
      opts.onExplorerStatus?.(
        index,
        "failed",
        err instanceof Error ? err.message : "explorer failed",
      );
    }
  }

  await Promise.all(opts.ebs.map((eb, i) => runExplorer(i, eb.cdpUrl)));

  // Starved frontier with nothing mapped beyond the entry → dead end.
  if (rawPages.length <= 1 && !frontier.budgetReached()) {
    pushBlocked({ url: opts.targetUrl, reason: "dead_end" });
  }

  return {
    pages: dedupeRichestByCanonical(rawPages, origin),
    blocked,
    loginAttempted,
  };
}
