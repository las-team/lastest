'use server';

import { requireTeamAccess } from '@/lib/auth';
import { createJob, completeJob, failJob, updateJobProgress } from '@/server/actions/jobs';
import { updateBackgroundJob, getBackgroundJob } from '@/lib/db/queries';
import { captureUrl, type CaptureSide, type PoolTier } from '@/lib/url-diff/capture';
import { buildUrlDiff, type UrlDiffResult } from '@/lib/url-diff/engine';
import { validateTargetUrl, SsrfBlockedError } from '@/lib/url-diff/ssrf';

export interface StartUrlDiffInput {
  urlA: string;
  urlB: string;
  viewport?: { width: number; height: number };
  /** Pool tier for capture. Server-set: 'interactive' for in-app calls. */
  poolTier?: PoolTier;
  /** SSRF policy bypass — true for cookie-session in-app users. */
  isCookieSession?: boolean;
  /** Source IP (for SSRF allowlist), pass through from request. */
  sourceIp?: string;
  /** Optional repo association for the job row (purely cosmetic in v1). */
  repositoryId?: string | null;
}

export async function startUrlDiff(input: StartUrlDiffInput): Promise<{ jobId: string }> {
  const session = await requireTeamAccess();

  // SSRF pre-flight — throws SsrfBlockedError on disallowed targets.
  const ssrfOpts = {
    isCookieSession: input.isCookieSession ?? true, // server-action default = in-app
    sourceIp: input.sourceIp ?? '',
  };
  await validateTargetUrl(input.urlA, ssrfOpts);
  await validateTargetUrl(input.urlB, ssrfOpts);

  const label = `URL Diff: ${truncate(input.urlA)} vs ${truncate(input.urlB)}`;
  const jobId = await createJob('url_diff', label, 4, input.repositoryId ?? null, {
    urlA: input.urlA,
    urlB: input.urlB,
    viewport: input.viewport,
    teamId: session.team.id,
  });

  // Fire-and-forget orchestration. We do NOT await — the route returns
  // immediately and the client polls /api/jobs/:id via useJobResult.
  void runUrlDiffAsync({
    jobId,
    urlA: input.urlA,
    urlB: input.urlB,
    viewport: input.viewport,
    poolTier: input.poolTier ?? 'interactive',
  });

  return { jobId };
}

export async function getUrlDiffResult(jobId: string): Promise<UrlDiffResult | null> {
  await requireTeamAccess();
  const job = await getBackgroundJob(jobId);
  const meta = (job?.metadata ?? {}) as { urlDiffResult?: UrlDiffResult };
  return meta.urlDiffResult ?? null;
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
    const sides: Array<['a' | 'b', string]> = [
      ['a', urlA],
      ['b', urlB],
    ];
    const captures = await Promise.all(
      sides.map(([side, url]) =>
        captureUrl({ url, jobId, side: side as CaptureSide, viewport, poolTier }),
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
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
