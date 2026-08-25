/**
 * Request pacing for the QA-agent discovery crawl and the App Map explorer
 * swarm, plus the User-Agent those crawls present.
 *
 * Why pacing lives here instead of in each crawler: the swarm runs up to N
 * explorers (N EB pods) against ONE target origin, so the pace has to be
 * decided once and shared. A per-explorer delay would still let 10 explorers
 * hammer the target 10x as hard.
 *
 * Scope note: pacing bounds *navigations*, not the subresources a page pulls in
 * on its own. One paced navigation is still a full page load. This caps how
 * fast we ask for new pages, which is the part we actually control.
 *
 * No robots.txt, deliberately. These crawls drive an app the user owns and has
 * explicitly asked us to test, under their own credentials — the same origin
 * the test executor already navigates without consulting robots.txt. robots.txt
 * addresses unattended third-party crawlers discovering public content, which
 * this is not; honouring it would map nothing at all on the staging and preview
 * environments that ship a blanket `Disallow: /` precisely to keep search
 * engines out, which are exactly the environments people point a QA agent at.
 * Pacing is what actually protects the target, and it always applies.
 */

import type { QaPage } from "./page";

/** Floor on the gap between navigations, swarm-wide. 2 pages/sec in total,
 *  regardless of how many explorers are running. */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 500;

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

  constructor(
    private readonly intervalMs: number = DEFAULT_MIN_REQUEST_INTERVAL_MS,
  ) {}

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

// ── crawler identity ─────────────────────────────────────────────────────────

/**
 * Apply the repository's configured `playwright_settings.userAgentOverride` to
 * a crawl page. This is the SAME setting the test executor passes to
 * `newContext()`; these crawls run on a core-claimed EB's pre-existing context,
 * so they never pass through that path and have to apply it themselves. Unset
 * leaves the browser's stock UA, matching the executor.
 *
 * Uses CDP so `navigator.userAgent` and the request header agree; falls back to
 * the request header alone. Best-effort: a failure here must not abort a crawl.
 */
export async function applyUserAgentOverride(
  page: QaPage,
  userAgent?: string | null,
): Promise<void> {
  const ua = userAgent?.trim();
  if (!ua) return;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setUserAgentOverride", { userAgent: ua });
    return;
  } catch {
    // Non-Chromium or CDP session refused — the header alone still applies.
  }
  await page
    .context()
    .setExtraHTTPHeaders({ "User-Agent": ua })
    .catch(() => {});
}
