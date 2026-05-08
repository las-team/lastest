/**
 * Multi-layer comparison capture helpers (v1.13).
 *
 * These functions run inside the EB pod alongside `test-executor.ts`. They
 * collect signals beyond the visual screenshot (URL trajectory, Web Vitals,
 * storage state) so the host can diff them against the baseline run.
 *
 * Keep these tree-shakeable — pure transforms over Playwright objects, no
 * shared state, no external deps beyond `playwright` and `crypto`.
 */

import type { BrowserContext, Page } from 'playwright';
import { createHash } from 'crypto';

// ── Types — duplicated from src/lib/db/schema.ts because the EB package can't
// reach into the host's @/ alias. Keep in sync.
export interface UrlTrajectoryStep {
  stepIndex: number;
  stepLabel?: string;
  finalUrl: string;
  redirectChain: string[];
  capturedAtMs?: number;
}

export interface WebVitalsSample {
  stepIndex?: number;
  stepLabel?: string;
  url: string;
  lcp?: number;
  cls?: number;
  inp?: number;
  fcp?: number;
  tbt?: number;
  ttfb?: number;
}

export interface StorageStateSnapshot {
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    valueHash?: string;
    redacted?: boolean;
  }>;
  localStorage: Array<{
    origin: string;
    name: string;
    value?: unknown;
    valueHash?: string;
    redacted?: boolean;
  }>;
}

// ── URL trajectory ─────────────────────────────────────────────────────────

/**
 * Tracks redirect chains per main-frame navigation. Wire this once at
 * page-creation time and then call `sampleAtStep()` from `__stepReached`.
 *
 * We listen on `framenavigated` (main frame only) and append every URL we
 * see; on `sampleAtStep()` we snapshot the chain since the last sample,
 * which gives us the redirect path for the *just-finished* step.
 */
export class UrlTrajectoryRecorder {
  private currentChain: string[] = [];
  private lastSampledLength = 0;

  constructor(page: Page) {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      try {
        const url = frame.url();
        if (url && url !== 'about:blank') this.currentChain.push(url);
      } catch { /* page may be tearing down */ }
    });
  }

  /** Snapshot the navigation chain that occurred between the previous sample
   *  and now, plus the page's current URL. */
  sampleAtStep(page: Page, stepIndex: number, stepLabel: string | undefined, capturedAtMs: number): UrlTrajectoryStep {
    const newSlice = this.currentChain.slice(this.lastSampledLength);
    this.lastSampledLength = this.currentChain.length;
    let finalUrl = '';
    try { finalUrl = page.url(); } catch { /* page closed */ }
    return {
      stepIndex,
      stepLabel,
      finalUrl,
      redirectChain: newSlice,
      capturedAtMs,
    };
  }
}

// ── Web Vitals ─────────────────────────────────────────────────────────────

/**
 * Init script that wires window.__lastestVitals as a fresh sample object on
 * every navigation. Read it via `sampleWebVitals(page)` after the step
 * finishes — values populate as user-visible paints/layout-shifts happen.
 *
 * We skip INP because it requires interaction events that our scripted
 * tests rarely fire naturally — Lighthouse-CI uses a proxy of TBT for the
 * same reason.
 */
export const VITALS_INIT_SCRIPT = `
(() => {
  if (window.__lastestVitalsInstalled) return;
  window.__lastestVitalsInstalled = true;
  const reset = () => { window.__lastestVitals = { lcp: undefined, cls: 0, fcp: undefined, ttfb: undefined, tbt: 0 }; };
  reset();
  // LCP — last entry wins per spec
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__lastestVitals.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  // CLS — sum of session-windowed shifts (we do simple sum; close enough for diff)
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__lastestVitals.cls = (window.__lastestVitals.cls || 0) + entry.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  // FCP
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          window.__lastestVitals.fcp = entry.startTime;
        }
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {}
  // TTFB — from navigation timing
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // responseStart is relative to fetchStart for navigation entries
        window.__lastestVitals.ttfb = entry.responseStart;
      }
    }).observe({ type: 'navigation', buffered: true });
  } catch {}
  // TBT proxy — accumulated long-task time over 50ms
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const blocking = Math.max(0, entry.duration - 50);
        window.__lastestVitals.tbt = (window.__lastestVitals.tbt || 0) + blocking;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // Reset on SPA route change so each route gets its own sample.
  // (Page-load navigations re-run init scripts; SPA pushState does not.)
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () { reset(); return orig.apply(this, arguments); };
  });
  window.addEventListener('popstate', reset);
})();
`;

export async function sampleWebVitals(
  page: Page,
  stepIndex?: number,
  stepLabel?: string,
): Promise<WebVitalsSample | null> {
  try {
    const sample = await page.evaluate(() => {
      const v = (window as unknown as { __lastestVitals?: Record<string, number | undefined> }).__lastestVitals || {};
      return {
        url: window.location.href,
        lcp: v.lcp,
        cls: v.cls,
        fcp: v.fcp,
        ttfb: v.ttfb,
        tbt: v.tbt,
      };
    });
    return { stepIndex, stepLabel, ...sample };
  } catch {
    return null;
  }
}

// ── Storage state ─────────────────────────────────────────────────────────

const TOKEN_NAME_PATTERNS = [
  /token/i, /sid$/i, /session/i, /csrf/i, /xsrf/i, /auth/i, /jwt/i,
  /bearer/i, /access[-_]key/i, /api[-_]key/i, /refresh/i,
];

function looksLikeToken(name: string): boolean {
  return TOKEN_NAME_PATTERNS.some((re) => re.test(name));
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Capture cookies + localStorage from the live context. Token-shaped names
 * are redacted (presence + hash only); other values get a hash so the diff
 * engine can detect changes without storing PII.
 */
export async function captureStorageStateSnapshot(
  context: BrowserContext,
  page: Page,
): Promise<StorageStateSnapshot> {
  const snapshot: StorageStateSnapshot = { cookies: [], localStorage: [] };

  try {
    const state = await context.storageState();
    for (const c of state.cookies || []) {
      const isToken = looksLikeToken(c.name);
      snapshot.cookies.push({
        name: c.name,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        valueHash: c.value ? shortHash(c.value) : undefined,
        redacted: isToken,
      });
    }
    for (const origin of state.origins || []) {
      for (const item of origin.localStorage || []) {
        const isToken = looksLikeToken(item.name);
        if (isToken) {
          snapshot.localStorage.push({
            origin: origin.origin,
            name: item.name,
            valueHash: item.value ? shortHash(item.value) : undefined,
            redacted: true,
          });
        } else {
          let parsed: unknown = item.value;
          try { parsed = JSON.parse(item.value); } catch { /* keep string */ }
          snapshot.localStorage.push({
            origin: origin.origin,
            name: item.name,
            value: parsed,
            valueHash: item.value ? shortHash(item.value) : undefined,
            redacted: false,
          });
        }
      }
    }
  } catch {
    // best-effort — context may already be closed
  }

  // Best-effort: also surface the *current page's* sessionStorage which
  // storageState() doesn't include. We dump it under a synthetic origin so
  // the diff engine treats it consistently with localStorage.
  try {
    const sessionEntries = await page.evaluate(() => {
      const out: Array<{ name: string; value: string }> = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k != null) out.push({ name: k, value: sessionStorage.getItem(k) ?? '' });
      }
      return { origin: window.location.origin, entries: out };
    });
    for (const item of sessionEntries.entries) {
      const isToken = looksLikeToken(item.name);
      snapshot.localStorage.push({
        origin: `session:${sessionEntries.origin}`,
        name: item.name,
        ...(isToken
          ? { valueHash: shortHash(item.value), redacted: true }
          : { value: tryParseJson(item.value), valueHash: shortHash(item.value), redacted: false }),
      });
    }
  } catch { /* ignore */ }

  return snapshot;
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
