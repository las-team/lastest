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
  /** Optional per-page callback for progress reporting. */
  onPage?: (snapshot: QaPageSnapshot, index: number) => void;
  /** Login before crawling: fills the first form containing a password field. */
  credentials?: { email: string; password: string };
  /** Rank login/signup/register links first when picking pages to follow, so
   *  public-only discovery reliably maps the auth surface within maxPages. */
  prioritizeAuthLinks?: boolean;
  signal?: AbortSignal;
}

async function extractDom(
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
function pickNextLinks(
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

export async function crawlTargetApp(
  cdpUrl: string,
  targetUrl: string,
  options: QaCrawlOptions = {},
): Promise<{ pages: QaPageSnapshot[]; loginAttempted: boolean }> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 6, 12));
  const browser = await chromium.connectOverCDP(cdpUrl);
  const pages: QaPageSnapshot[] = [];
  let loginAttempted = false;
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const base = new URL(targetUrl);

    // Same-origin fetch/XHR observation, keyed per visited page.
    let currentEndpoints: QaPageSnapshot["apiEndpoints"] = [];
    page.on("response", (response) => {
      try {
        const req = response.request();
        const type = req.resourceType();
        if (type !== "fetch" && type !== "xhr") return;
        const url = new URL(response.url());
        if (url.origin !== base.origin) return;
        if (currentEndpoints.length >= 40) return;
        currentEndpoints.push({
          method: req.method(),
          path: url.pathname + url.search.slice(0, 60),
          status: response.status(),
        });
      } catch {
        // Observation is best-effort.
      }
    });

    const visited = new Set<string>();
    const queue: string[] = [new URL(targetUrl).href];

    while (queue.length > 0 && pages.length < maxPages) {
      if (options.signal?.aborted) break;
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      currentEndpoints = [];
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
        if (pages.length === 0 && options.credentials) {
          loginAttempted = await attemptLogin(page, options.credentials);
        }

        const dom = await extractDom(page);
        const snapshot: QaPageSnapshot = {
          url,
          ...dom,
          apiEndpoints: [...currentEndpoints],
        };
        pages.push(snapshot);
        options.onPage?.(snapshot, pages.length - 1);
        visited.add(snapshot.finalUrl);

        for (const next of pickNextLinks(
          snapshot,
          base,
          visited,
          maxPages - pages.length,
          options.prioritizeAuthLinks,
        )) {
          queue.push(next);
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
