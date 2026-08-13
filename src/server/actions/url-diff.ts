"use server";

/**
 * Ad-hoc two-URL diff — the engine behind `POST /api/v1/diff`.
 *
 * **This is core, not a feature.** The in-app URL Diff page and its sidebar
 * entry were removed; what remains exists solely to serve the documented
 * public API (`docs/specs/url-diff-integration.md`), which is why
 * `src/lib/url-diff` and this module are listed in `CORE_SRC_PATHS` rather
 * than as a pseudo-plugin destined for `plugins/`.
 *
 * The UI-only `getUrlDiffResult` reader went with the page; API callers poll
 * `statusUrl` (`/api/jobs/:id`) instead, which is where the result blob has
 * always been written.
 */

import { requireTeamAccess } from "@/lib/auth";
import {
  createJob,
  completeJob,
  failJob,
  updateJobProgress,
} from "@/server/actions/jobs";
import { updateBackgroundJob, getBackgroundJob } from "@/lib/db/queries";
import {
  captureUrl,
  type CaptureSide,
  type PoolTier,
} from "@/lib/url-diff/capture";
import { buildUrlDiff } from "@/lib/url-diff/engine";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";

export interface StartUrlDiffInput {
  urlA: string;
  urlB: string;
  viewport?: { width: number; height: number };
  /** Pool tier for capture. Server-set: 'interactive' for in-app calls. */
  poolTier?: PoolTier;
  /** Source IP (for SSRF allowlist), pass through from request. */
  sourceIp?: string;
  /** Optional repo association for the job row (purely cosmetic in v1). */
  repositoryId?: string | null;
}

export async function startUrlDiff(
  input: StartUrlDiffInput,
): Promise<{ jobId: string }> {
  const session = await requireTeamAccess();

  // SSRF pre-flight — throws SsrfBlockedError on disallowed targets.
  const ssrfOpts = { sourceIp: input.sourceIp ?? "" };
  await assertSafeOutboundUrl(input.urlA, ssrfOpts);
  await assertSafeOutboundUrl(input.urlB, ssrfOpts);

  const label = `URL Diff: ${truncate(input.urlA)} vs ${truncate(input.urlB)}`;
  const jobId = await createJob(
    "url_diff",
    label,
    4,
    input.repositoryId ?? null,
    {
      urlA: input.urlA,
      urlB: input.urlB,
      viewport: input.viewport,
      teamId: session.team.id,
    },
  );

  // Fire-and-forget orchestration. We do NOT await — the route returns
  // immediately and the client polls /api/jobs/:id via useJobResult.
  void runUrlDiffAsync({
    jobId,
    urlA: input.urlA,
    urlB: input.urlB,
    viewport: input.viewport,
    poolTier: input.poolTier ?? "interactive",
  });

  return { jobId };
}

interface RunUrlDiffOpts {
  jobId: string;
  urlA: string;
  urlB: string;
  viewport?: { width: number; height: number };
  poolTier: PoolTier;
}

async function runUrlDiffAsync(opts: RunUrlDiffOpts): Promise<void> {
  const { jobId, urlA, urlB, viewport, poolTier } = opts;
  try {
    const sides: Array<["a" | "b", string]> = [
      ["a", urlA],
      ["b", urlB],
    ];
    const captures = await Promise.all(
      sides.map(([side, url]) =>
        captureUrl({
          url,
          jobId,
          side: side as CaptureSide,
          viewport,
          poolTier,
        }),
      ),
    );
    await updateJobProgress(jobId, 2, 4);

    const result = await buildUrlDiff(captures[0]!, captures[1]!, jobId);
    await updateJobProgress(jobId, 3, 4);

    const existing = await getBackgroundJob(jobId);
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      urlDiffResult: result,
    };
    await updateBackgroundJob(jobId, { metadata: merged });
    await completeJob(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SsrfBlockedError) {
      await failJob(jobId, `Blocked: ${message}`);
    } else {
      await failJob(jobId, message);
    }
  }
}

function truncate(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
