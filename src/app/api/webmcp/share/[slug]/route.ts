/**
 * Public WebMCP surface for a `/r/<slug>` share page.
 *
 * Unauthenticated by design and scoped to one slug: it answers exactly the
 * three questions the share page already answers in HTML (what was tested, what
 * changed, what failed), so an agent reading the page gets structured evidence
 * instead of scraping screenshots. No session is consulted and none is usable —
 * every read is keyed by the slug, and a revoked or non-public share 404s.
 *
 * No CSRF gate here, deliberately: the route reads no cookies and performs no
 * mutation, so there is nothing for a cross-origin caller to abuse that a plain
 * fetch of the public page would not already give them.
 *
 * Because it IS anonymous and DOES real database work, two things it must not
 * skip. It is rate-limited per slug and per IP — an anonymous caller can loop
 * it, and the render context is the expensive part of the share page. And it
 * honours the owning team's regulated profile exactly as `/r/<slug>` does: a
 * team that flips `regulatedMode` must not find its already-live links have
 * quietly gained a structured, machine-readable extraction endpoint over the
 * same data.
 *
 * The render context is memoised per slug for a short window. A published
 * share's contents do not change (a revoked one 404s on the uncached share
 * lookup, which happens first), so the repeat cost of a loop is a map hit.
 */
import { NextRequest } from "next/server";
import {
  getPublicShareBySlug,
  isValidShareSlug,
  deriveShareFacts,
  hasRenderableVisualChange,
  formatShareDuration,
  type ShareVisualDiff,
  type ShareTestResult,
  type ShareStepComparison,
} from "@lastest/plugin-share";
import { appShareHost } from "@/lib/core/share-host";
import {
  WEBMCP_SHARE_OPS,
  type WebMcpShareOp,
} from "@/lib/webmcp/share-registry";
import { check as rateLimitCheck } from "@/lib/rate-limit/limiter";
import { clientIp } from "@/lib/rate-limit/runner-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A cheap cap on a route that is deliberately anonymous and deliberately does
 * real database work. Two windows: one per slug (bounds the cost of hammering
 * a single report, which is what a stuck agent does) and one per IP (bounds a
 * caller walking many slugs). Generous enough that an agent reading a report
 * with all three tools, repeatedly, never notices.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_PER_SLUG = 60;
const RATE_PER_IP = 120;

/**
 * Memoised render contexts, keyed by slug.
 *
 * The share lookup is NOT cached — a revoked share must stop answering
 * immediately, and that check runs before this. What is cached is the
 * expensive part: every diff, result and step comparison of the build, which
 * `report_summary` (eight counters) otherwise pays for in full on every
 * anonymous call.
 */
const CONTEXT_TTL_MS = 30_000;
const CONTEXT_CACHE_MAX = 200;
type RenderContext = Awaited<
  ReturnType<typeof appShareHost.getBuildRenderContext>
>;
const contextCache = new Map<string, { at: number; value: RenderContext }>();

/** Test-only: drop the memoised contexts so one case cannot answer the next.
 *  Exported rather than reached for, because a module-level cache that tests
 *  cannot clear is a cache that silently makes them pass. */
export function __resetShareContextCache(): void {
  contextCache.clear();
}

async function renderContextFor(
  slug: string,
  target: { buildId: string; testId: string | null },
): Promise<RenderContext> {
  const now = Date.now();
  const hit = contextCache.get(slug);
  if (hit && now - hit.at < CONTEXT_TTL_MS) return hit.value;

  const value = await appShareHost.getBuildRenderContext(target);
  // Sweep expired entries before inserting, then bound outright — this map
  // lives for the process lifetime and its keys come from anonymous callers.
  for (const [key, entry] of contextCache) {
    if (now - entry.at >= CONTEXT_TTL_MS) contextCache.delete(key);
  }
  if (contextCache.size >= CONTEXT_CACHE_MAX) {
    const oldest = contextCache.keys().next().value;
    if (oldest !== undefined) contextCache.delete(oldest);
  }
  contextCache.set(slug, { at: now, value });
  return value;
}

/** Share media is served through the slug-scoped route, never by raw path. */
function mediaUrl(
  slug: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  return `/share/${slug}/${path.replace(/^\/+/, "")}`;
}

function summarize(
  slug: string,
  share: { targetDomain: string | null; testId: string | null },
  build: {
    totalTests: number | null;
    passedCount: number | null;
    failedCount: number | null;
    changesDetected: number | null;
    overallStatus: string;
    completedAt: Date | null;
    createdAt: Date | null;
    a11yScore: number | null;
    a11yViolationCount: number | null;
    baseUrl: string | null;
    buildSetupTestId: string | null;
  },
  test: {
    name: string;
    targetUrl: string | null;
    setupTestId: string | null;
  } | null,
  diffs: ShareVisualDiff[],
  results: ShareTestResult[],
) {
  const facts = deriveShareFacts({ results, diffs, test, build });
  return {
    reportUrl: `/r/${slug}`,
    site: share.targetDomain ?? test?.targetUrl ?? build.baseUrl ?? null,
    scope: share.testId ? "single test" : "whole build",
    testName: test?.name ?? null,
    ranAt: (build.completedAt ?? build.createdAt)?.toISOString() ?? null,
    status: build.overallStatus,
    tests: {
      total: build.totalTests ?? 0,
      passed: build.passedCount ?? 0,
      failed: build.failedCount ?? 0,
    },
    visualChanges: facts.changeCount,
    stepsCaptured: facts.steps,
    authenticatedWalkthrough: facts.authed,
    duration: facts.duration ?? formatShareDuration(facts.durationMs),
    accessibility:
      build.a11yScore === null
        ? null
        : { score: build.a11yScore, violations: build.a11yViolationCount ?? 0 },
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return json({ ok: false, error: "Unknown report." }, 404);
  }

  // Before any parsing or database work — the point of the cap is that a loop
  // costs the server nothing.
  const ip = clientIp(req);
  const slugLimit = rateLimitCheck(
    `webmcp-share:slug:${slug}`,
    RATE_PER_SLUG,
    RATE_WINDOW_MS,
  );
  const ipLimit = slugLimit.allowed
    ? rateLimitCheck(`webmcp-share:ip:${ip}`, RATE_PER_IP, RATE_WINDOW_MS)
    : slugLimit;
  if (!slugLimit.allowed || !ipLimit.allowed) {
    const retryAfterMs = Math.max(slugLimit.retryAfterMs, ipLimit.retryAfterMs);
    return new Response(
      JSON.stringify({ ok: false, error: "Too many requests." }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(Math.ceil(retryAfterMs / 1000)),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const name = (body as { name?: unknown }).name;
  if (
    typeof name !== "string" ||
    !(WEBMCP_SHARE_OPS as readonly string[]).includes(name)
  ) {
    return json({ ok: false, error: "Unsupported tool." }, 400);
  }

  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== "public") {
    return json({ ok: false, error: "Unknown report." }, 404);
  }

  // Same refusal as `/r/<slug>`. Minting is not the only way a link exists, and
  // this route would otherwise hand a regulated team's already-live shares a
  // structured extraction endpoint over the same data. One cheap flag read,
  // and it happens before the expensive render context.
  const ownerFlags = await appShareHost.getOwnerTeamFlags(share.repositoryId);
  if (ownerFlags && !ownerFlags.sharingPermitted) {
    return json({ ok: false, error: "Unknown report." }, 404);
  }

  const rendered = await renderContextFor(slug, {
    buildId: share.buildId,
    testId: share.testId,
  });
  if (!rendered) {
    return json(
      { ok: false, error: "This report is no longer available." },
      404,
    );
  }
  const { build, test, diffs, results, stepComparisons } = rendered;

  switch (name as WebMcpShareOp) {
    case "report_summary":
      return json({
        ok: true,
        op: "call",
        result: summarize(slug, share, build, test, diffs, results),
      });

    case "visual_changes":
      return json({
        ok: true,
        op: "call",
        result: {
          changes: diffs.filter(hasRenderableVisualChange).map((d) => ({
            id: d.id,
            test: d.testName,
            step: d.stepLabel,
            percentChanged: d.percentageDifference,
            pixelsChanged: d.pixelDifference,
            classification: d.classification,
            before: mediaUrl(slug, d.baselineImagePath),
            after: mediaUrl(slug, d.currentImagePath),
            diff: mediaUrl(slug, d.diffImagePath),
          })),
        },
      });

    case "failing_steps":
      return json({
        ok: true,
        op: "call",
        result: {
          // The share page has no error strings to show (`ShareTestResult`
          // deliberately carries no message), so this reports what it does
          // show: which tests did not pass, and which of their steps a check
          // layer marked red.
          failing: results
            .filter((r) => r.status && r.status !== "passed")
            .map((r) => ({
              testId: r.testId,
              testName:
                diffs.find((d) => d.testId === r.testId)?.testName ??
                test?.name ??
                null,
              status: r.status,
              durationMs: r.durationMs,
              redSteps: stepComparisons
                .filter(
                  (c: ShareStepComparison) =>
                    c.testId === r.testId && c.verdict === "red",
                )
                .map((c: ShareStepComparison) => ({
                  step: c.stepLabel,
                  index: c.stepIndex,
                  layers: Object.keys(c.layers ?? {}),
                })),
            })),
        },
      });
  }
}
