/**
 * Crawler politeness for the QA-agent discovery crawl and the App Map explorer
 * swarm: an identifying User-Agent, robots.txt compliance, and a shared request
 * pace.
 *
 * Why all three live together: the swarm runs up to N explorers (N EB pods)
 * against ONE target origin, so every politeness decision has to be made once
 * and shared. A per-explorer delay would still let 10 explorers hammer the
 * target 10× as hard, and a per-explorer robots fetch would be 10 fetches of
 * the same file.
 *
 * Scope note: pacing bounds *navigations*, not the subresources a page pulls in
 * on its own. One paced navigation is still a full page load. This caps how
 * fast we ask for new pages, which is the part we actually control.
 *
 * robots.txt is fetched THROUGH the browser (`page.goto`), never with a
 * host-side `fetch`. The EB already has the network posture for the target
 * (egress policy, private-range access for self-hosted apps); fetching from the
 * app process instead would hand user-supplied URLs a new host-side request
 * primitive, which is exactly what `@/lib/security/outbound-url` exists to stop.
 */

import type { Page } from "playwright";

/** Product token a target can match in robots.txt / block at the edge. */
export const CRAWLER_PRODUCT_TOKEN = "LastestBot";

/** Appended to the browser's real UA — identifies us without breaking sites
 *  that branch on Chrome/WebKit tokens for rendering. */
export const CRAWLER_UA_SUFFIX = `${CRAWLER_PRODUCT_TOKEN}/1.0 (+https://lastest.cloud/bot)`;

/** Floor on the gap between navigations, swarm-wide, when robots.txt names no
 *  Crawl-delay. 2 pages/sec total, regardless of explorer count. */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 500;

/** Crawl-delay values above this are clamped — a pathological value would burn
 *  the whole wall-clock budget waiting instead of stopping cleanly. */
export const MAX_HONORED_CRAWL_DELAY_MS = 30_000;

const ROBOTS_TIMEOUT_MS = 10_000;
const ROBOTS_MAX_BYTES = 512 * 1024;

/**
 * Escape hatch for self-hosted operators crawling an app they own that ships a
 * blanket `Disallow: /` (common on staging). Off by default — set only for
 * origins you control.
 */
export function robotsIgnored(): boolean {
  const raw = process.env.LASTEST_IGNORE_ROBOTS?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

// ── robots.txt ───────────────────────────────────────────────────────────────

interface RobotsRule {
  allow: boolean;
  /** Original path pattern, kept for specificity comparison. */
  pattern: string;
  matcher: RegExp;
}

export interface RobotsPolicy {
  /** May we request this URL? Path + query are matched, per RFC 9309. */
  isAllowed(url: string): boolean;
  /** Crawl-delay in ms from the matched group, already clamped. */
  crawlDelayMs: number | null;
  /** Where the rules came from — surfaced in logs/UI detail strings. */
  source: "robots" | "missing" | "unreachable" | "ignored";
}

const ALLOW_ALL: RobotsPolicy = {
  isAllowed: () => true,
  crawlDelayMs: null,
  source: "missing",
};

function patternToRegExp(pattern: string): RegExp {
  let body = "";
  for (const char of pattern) {
    if (char === "*") body += ".*";
    else body += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  // A trailing `$` anchors the match; anything else is a prefix match.
  if (body.endsWith("\\$")) return new RegExp(`^${body.slice(0, -2)}$`);
  return new RegExp(`^${body}`);
}

function pathAndQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

/**
 * Parse robots.txt and keep only the group that applies to `token` (falling
 * back to `*`). Follows RFC 9309: groups are contiguous User-agent runs, the
 * most specific matching group wins outright (no merging with `*`), an empty
 * `Disallow:` allows everything, and longest-pattern-wins decides conflicts
 * with ties going to Allow.
 */
export function parseRobotsTxt(
  text: string,
  token = CRAWLER_PRODUCT_TOKEN,
): RobotsPolicy {
  const wanted = token.toLowerCase();
  type Group = {
    agents: string[];
    rules: RobotsRule[];
    crawlDelay: number | null;
  };
  const groups: Group[] = [];
  let current: Group | null = null;
  let inAgentRun = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "user-agent") {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        inAgentRun = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue; // rule before any user-agent — not ours to apply
    inAgentRun = false;

    if (field === "allow" || field === "disallow") {
      if (field === "disallow" && value === "") continue; // empty = allow all
      if (!value) continue;
      current.rules.push({
        allow: field === "allow",
        pattern: value,
        matcher: patternToRegExp(value),
      });
    } else if (field === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        current.crawlDelay = seconds * 1000;
      }
    }
  }

  const exact = groups.find((g) =>
    g.agents.some((a) => a !== "*" && wanted.includes(a)),
  );
  const group = exact ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return { ...ALLOW_ALL, source: "robots" };

  const rules = group.rules;
  const crawlDelayMs =
    group.crawlDelay === null
      ? null
      : Math.min(group.crawlDelay, MAX_HONORED_CRAWL_DELAY_MS);

  return {
    crawlDelayMs,
    source: "robots",
    isAllowed(url: string) {
      const path = pathAndQuery(url);
      let best: RobotsRule | null = null;
      for (const rule of rules) {
        if (!rule.matcher.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          // Tie → Allow wins.
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/**
 * Fetch and parse `<origin>/robots.txt` using an already-connected browser page.
 * Never throws — an unreachable or unparseable robots.txt yields an allow-all
 * policy, because the crawl target is an app the user asked us to test and a
 * flaky robots endpoint should degrade to "polite but running", not "silently
 * mapped nothing". Pacing still applies in that case.
 */
export async function fetchRobotsPolicy(
  page: Page,
  origin: string,
): Promise<RobotsPolicy> {
  if (robotsIgnored()) {
    return { ...ALLOW_ALL, source: "ignored" };
  }
  try {
    const response = await page.goto(new URL("/robots.txt", origin).href, {
      waitUntil: "domcontentloaded",
      timeout: ROBOTS_TIMEOUT_MS,
    });
    if (!response) return { ...ALLOW_ALL, source: "unreachable" };
    const status = response.status();
    // 4xx = no robots.txt = full allow. 5xx: RFC 9309 says treat as full
    // disallow; we allow instead (see the doc comment above) but flag it.
    if (status >= 400) {
      return {
        ...ALLOW_ALL,
        source: status >= 500 ? "unreachable" : "missing",
      };
    }
    const contentType = (
      response.headers()["content-type"] ?? ""
    ).toLowerCase();
    if (contentType.includes("html")) {
      return { ...ALLOW_ALL, source: "missing" }; // SPA catch-all route
    }
    const body = (await response.text()).slice(0, ROBOTS_MAX_BYTES);
    return parseRobotsTxt(body);
  } catch {
    return { ...ALLOW_ALL, source: "unreachable" };
  }
}

// ── request pacing ───────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serializes navigations across every explorer sharing one target origin: each
 * `wait()` resolves no sooner than `intervalMs` after the previous one did.
 *
 * The promise chain is the lock — JS is single-threaded, so appending to
 * `chain` inside `wait()` is atomic and callers are served in arrival order.
 */
export class CrawlPacer {
  private chain: Promise<void> = Promise.resolve();
  private lastAt = 0;

  constructor(private readonly intervalMs: number) {}

  /** Resolves when the caller may issue its next navigation. */
  wait(): Promise<void> {
    const slot = this.chain.then(async () => {
      const waitMs = this.lastAt + this.intervalMs - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      this.lastAt = Date.now();
    });
    this.chain = slot.catch(() => {});
    return slot;
  }
}

/** Swarm-wide pace: the robots Crawl-delay when it asks for more room than our
 *  own floor, otherwise the floor. */
export function pacerFor(policy: RobotsPolicy): CrawlPacer {
  return new CrawlPacer(
    Math.max(DEFAULT_MIN_REQUEST_INTERVAL_MS, policy.crawlDelayMs ?? 0),
  );
}

// ── crawler identity ─────────────────────────────────────────────────────────

/**
 * Make the crawler identifiable — and therefore blockable — by appending our
 * product token to the page's real User-Agent. Uses CDP so `navigator.userAgent`
 * and the request header agree; falls back to the request header alone.
 * Best-effort: a failure here must not abort a crawl.
 */
export async function applyCrawlerIdentity(page: Page): Promise<void> {
  const ua = await page
    .evaluate(() => navigator.userAgent)
    .catch(() => null as string | null);
  const identified = ua ? `${ua} ${CRAWLER_UA_SUFFIX}` : CRAWLER_UA_SUFFIX;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setUserAgentOverride", {
      userAgent: identified,
    });
    return;
  } catch {
    // Non-Chromium or CDP session refused — header-only is still identifying.
  }
  await page
    .context()
    .setExtraHTTPHeaders({ "User-Agent": identified })
    .catch(() => {});
}
