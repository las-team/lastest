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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

  const rendered = await appShareHost.getBuildRenderContext({
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
