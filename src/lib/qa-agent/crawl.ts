import { chromium, type Page } from "playwright";
import type { QaPageSnapshot } from "@/lib/db/schema";
import { isAuthLink } from "@/lib/qa-agent/auth-links";

/**
 * QA Agent live discovery crawl. Connects to a provisioned Embedded Browser
 * over CDP (never a host-process browser), renders the target URL, extracts a
 * structured page map of the LIVE DOM, then follows a handful of same-origin
 * links and maps those too. While each page loads, same-origin fetch/XHR
 * responses are recorded so the planner can ground API-group tests in real
 * endpoints. Deterministic — no AI involved. Driving the EB's page makes the
 * crawl watchable via the EB screencast.
 */

const PAGE_NAV_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_TIMEOUT_MS = 8_000;

export interface QaCrawlOptions {
  /** Total pages to map, including the root. */
  maxPages?: number;
  /** Upper clamp applied to maxPages. Defaults to 12 (the planner-discovery
   *  cap); explore runs raise it to allow deeper maps. */
  maxPagesHardCap?: number;
  /** Max link hops from the entry URL (root = depth 0). Unset = unlimited. */
  maxDepth?: number;
  /** Epoch-ms wall-clock deadline — the crawl stops cleanly when reached
   *  (checked beside `signal` between pages). */
  deadline?: number;
  /** Optional per-page callback for progress reporting. */
  onPage?: (snapshot: QaPageSnapshot, index: number) => void;
  /** Login before crawling: fills the first form containing a password field. */
  credentials?: { email: string; password: string };
  /** DOM-discovered login page (from qa_login). When set with credentials,
   *  the crawl logs in THERE before mapping, instead of relying on the first
   *  crawled page happening to show a password form. */
  loginUrl?: string;
  /** Rank login/signup/register links first when picking pages to follow, so
   *  public-only discovery reliably maps the auth surface within maxPages. */
  prioritizeAuthLinks?: boolean;
  signal?: AbortSignal;
}

export async function extractDom(
  page: Page,
): Promise<Omit<QaPageSnapshot, "url" | "apiEndpoints">> {
  return (await page.evaluate(() => {
    const text = (el: Element | null): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const uniq = (arr: string[]): string[] =>
      Array.from(new Set(arr.filter(Boolean)));

    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((h) => ({ level: Number(h.tagName[1]), text: text(h) }))
      .filter((h) => h.text)
      .slice(0, 30);

    const labelFor = (el: Element): string | null => {
      const id = el.getAttribute("id");
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) return text(lab);
      }
      return (
        el.getAttribute("aria-label") || el.getAttribute("placeholder") || null
      );
    };

    const forms = Array.from(document.querySelectorAll("form"))
      .slice(0, 8)
      .map((f) => ({
        name: f.getAttribute("name") || f.getAttribute("id"),
        action: f.getAttribute("action"),
        method: (f.getAttribute("method") || "get").toLowerCase(),
        inputs: Array.from(f.querySelectorAll("input,textarea,select"))
          .slice(0, 20)
          .map((i) => ({
            tag: i.tagName.toLowerCase(),
            type: i.getAttribute("type"),
            name: i.getAttribute("name"),
            id: i.getAttribute("id"),
            label: labelFor(i),
          })),
      }));

    const buttons = uniq(
      Array.from(
        document.querySelectorAll(
          "button,[role=button],input[type=submit],input[type=button]",
        ),
      )
        .map(
          (b) =>
            text(b) ||
            b.getAttribute("value") ||
            b.getAttribute("aria-label") ||
            "",
        )
        .filter(Boolean),
    ).slice(0, 30);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        text: text(a),
        href: (a as HTMLAnchorElement).getAttribute("href") || "",
      }))
      .filter((l) => l.href && !l.href.startsWith("javascript:"))
      .slice(0, 60);

    const testIds = uniq(
      Array.from(document.querySelectorAll("[data-testid]")).map(
        (e) => e.getAttribute("data-testid") || "",
      ),
    ).slice(0, 40);

    const candidateSelectors = uniq([
      ...testIds.map((t) => `getByTestId('${t}')`),
      ...buttons
        .slice(0, 10)
        .map(
          (b) =>
            `getByRole('button', { name: /${b
              .slice(0, 40)
              .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/i })`,
        ),
    ]).slice(0, 40);

    return {
      title: document.title || null,
      finalUrl: location.href,
      headings,
      forms,
      buttons,
      links,
      testIds,
      candidateSelectors,
    };
  })) as Omit<QaPageSnapshot, "url" | "apiEndpoints">;
}

function sameOrigin(href: string, base: URL): URL | null {
  try {
    const url = new URL(href, base);
    if (url.origin !== base.origin) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** Pick the next unvisited same-origin links, preferring short nav-like paths. */
export function pickNextLinks(
  snapshot: QaPageSnapshot,
  base: URL,
  visited: Set<string>,
  count: number,
  prioritizeAuth = false,
): string[] {
  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number }> = [];
  for (const link of snapshot.links) {
    const url = sameOrigin(link.href, base);
    if (!url) continue;
    const key = url.href;
    if (visited.has(key) || seen.has(key)) continue;
    seen.add(key);
    // Prefer labeled nav links with shallow paths; skip asset-ish URLs.
    if (/\.(png|jpe?g|svg|css|js|pdf|zip)(\?|$)/i.test(url.pathname)) continue;
    const depth = url.pathname.split("/").filter(Boolean).length;
    const authBonus =
      prioritizeAuth && isAuthLink(link.text, url.pathname) ? 10 : 0;
    const score = (link.text ? 0 : 5) + depth - authBonus;
    candidates.push({ url: key, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, count).map((c) => c.url);
}

/** Fill and submit the first form containing a password field. Shared with the
 *  qa_login step, which drives the same deterministic login on its own EB. */
export async function attemptLogin(
  page: Page,
  credentials: { email: string; password: string },
): Promise<boolean> {
  try {
    const password = page.locator('input[type="password"]').first();
    if (!(await password.isVisible({ timeout: 2000 }).catch(() => false))) {
      return false;
    }
    const user = page
      .locator(
        'input[type="email"], input[autocomplete="username"], input[name*="mail" i], input[name*="user" i], input[type="text"]',
      )
      .first();
    if (await user.isVisible({ timeout: 1000 }).catch(() => false)) {
      await user.fill(credentials.email);
    }
    await password.fill(credentials.password);
    const submit = page
      .locator(
        'button[type="submit"], input[type="submit"], form button, [role="button"]',
      )
      .first();
    await submit.click({ timeout: 3000 });
    await page
      .waitForLoadState("networkidle", { timeout: PAGE_SETTLE_TIMEOUT_MS })
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach console-error + same-origin fetch/XHR observers to a page, keyed
 * per visited page via `reset()`. Deduped and capped so a chatty page can't
 * bloat the digest. Shared by the discovery crawl and the explore swarm.
 */
export function attachPageObservers(page: Page, baseOrigin: string) {
  let consoleErrors: string[] = [];
  let endpoints: QaPageSnapshot["apiEndpoints"] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (consoleErrors.length >= 15) return;
    const text = msg.text().replace(/\s+/g, " ").trim().slice(0, 200);
    if (text && !consoleErrors.includes(text)) {
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    if (consoleErrors.length >= 15) return;
    const text = `${err.name}: ${err.message}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (text && !consoleErrors.includes(text)) {
      consoleErrors.push(text);
    }
  });
  page.on("response", (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (type !== "fetch" && type !== "xhr") return;
      const url = new URL(response.url());
      if (url.origin !== baseOrigin) return;
      if (endpoints.length >= 40) return;
      endpoints.push({
        method: req.method(),
        path: url.pathname + url.search.slice(0, 60),
        status: response.status(),
      });
    } catch {
      // Observation is best-effort.
    }
  });

  return {
    /** Clear buffers before navigating to the next page. */
    reset() {
      consoleErrors = [];
      endpoints = [];
    },
    consoleErrors: () => [...consoleErrors],
    endpoints: () => [...endpoints],
  };
}

export async function crawlTargetApp(
  cdpUrl: string,
  targetUrl: string,
  options: QaCrawlOptions = {},
): Promise<{ pages: QaPageSnapshot[]; loginAttempted: boolean }> {
  const maxPages = Math.max(
    1,
    Math.min(options.maxPages ?? 6, options.maxPagesHardCap ?? 12),
  );
  const browser = await chromium.connectOverCDP(cdpUrl);
  const pages: QaPageSnapshot[] = [];
  let loginAttempted = false;
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const base = new URL(targetUrl);
    const observers = attachPageObservers(page, base.origin);

    // With a known login page, authenticate BEFORE the crawl starts so every
    // mapped page reflects the post-login state.
    if (options.credentials && options.loginUrl) {
      try {
        await page.goto(options.loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_NAV_TIMEOUT_MS,
        });
        await page
          .waitForLoadState("networkidle", { timeout: PAGE_SETTLE_TIMEOUT_MS })
          .catch(() => {});
        loginAttempted = await attemptLogin(page, options.credentials);
      } catch {
        // Best-effort — the first-page fallback below still applies.
      }
    }

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [
      { url: new URL(targetUrl).href, depth: 0 },
    ];

    while (queue.length > 0 && pages.length < maxPages) {
      if (options.signal?.aborted) break;
      if (options.deadline && Date.now() >= options.deadline) break;
      const { url, depth } = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      observers.reset();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_NAV_TIMEOUT_MS,
        });
        await page
          .waitForLoadState("networkidle", {
            timeout: PAGE_SETTLE_TIMEOUT_MS,
          })
          .catch(() => {});

        // On the first page, log in when credentials are provided and a
        // password field is present, then re-extract the authed DOM.
        if (pages.length === 0 && options.credentials && !loginAttempted) {
          loginAttempted = await attemptLogin(page, options.credentials);
        }

        const dom = await extractDom(page);
        const snapshot: QaPageSnapshot = {
          url,
          ...dom,
          apiEndpoints: observers.endpoints(),
          consoleErrors: observers.consoleErrors(),
        };
        pages.push(snapshot);
        options.onPage?.(snapshot, pages.length - 1);
        visited.add(snapshot.finalUrl);

        if (options.maxDepth === undefined || depth < options.maxDepth) {
          for (const next of pickNextLinks(
            snapshot,
            base,
            visited,
            maxPages - pages.length,
            options.prioritizeAuthLinks,
          )) {
            queue.push({ url: next, depth: depth + 1 });
          }
        }
      } catch (err) {
        console.warn(`[QaCrawl] failed to map ${url}:`, err);
      }
    }
    return { pages, loginAttempted };
  } finally {
    // Disconnect CDP; the EB itself is released by the caller.
    await browser.close().catch(() => {});
  }
}
