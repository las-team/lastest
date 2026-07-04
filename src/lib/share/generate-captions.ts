/**
 * Server-side glue between a build and its recording captions. Picks the
 * build's primary test recording, runs the vision pass, and persists the
 * cues onto the build's `build_demo_notes` payload (alongside any existing
 * UI/UX summary). Shared by the in-app server action and the v1 API so both
 * authoring paths store captions identically.
 */

import * as queries from "@/lib/db/queries";
import {
  generateVideoCaptions,
  type CaptionStepInput,
} from "@/lib/share/captions";
import type {
  CapturedScreenshot,
  DemoNotes,
  VideoCaption,
} from "@/lib/db/schema";

// Seed payload when a build has no demo-notes yet — captions-only. `generatedAt`
// is empty here and filled with a real timestamp at upsert time (see the `||`
// below) so we don't capture a module-load time.
const EMPTY_NOTES: DemoNotes = {
  uxSummary: "",
  highlights: [],
  frictionPoints: [],
  testingStruggles: [],
  generatedAt: "",
};

function hasShots(r: { screenshots?: CapturedScreenshot[] | null }): boolean {
  return Array.isArray(r.screenshots) && r.screenshots.length > 0;
}

export interface CaptionTarget {
  repositoryId: string;
  productName: string;
  durationMs: number | null;
  steps: CaptionStepInput[];
  uxSummary: string | null;
}

// Resolve the build's primary recording: prefer an explicit testId, then the
// first result that has both a video and screenshots, then any result with
// screenshots. Returns null when nothing capturable exists.
export async function resolveCaptionTarget(
  buildId: string,
  opts?: { testId?: string },
): Promise<CaptionTarget | null> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return null;

  const results = await queries.getTestResultsByRun(build.testRunId);
  const candidate =
    (opts?.testId &&
      results.find((r) => r.testId === opts.testId && hasShots(r))) ||
    results.find((r) => r.videoPath && hasShots(r)) ||
    results.find(hasShots);
  if (!candidate?.testId || !hasShots(candidate)) return null;

  const test = await queries.getTest(candidate.testId);
  const repositoryId = test?.repositoryId;
  if (!repositoryId) return null;

  const existing =
    (await queries.getBuildDemoNotes(buildId)) ??
    (await queries.getLatestDemoNotesForRepo(repositoryId));

  return {
    repositoryId,
    productName: test?.name ?? "this app",
    durationMs: candidate.durationMs ?? null,
    steps: (candidate.screenshots ?? []).map((s) => ({
      path: s.path,
      label: s.label ?? null,
    })),
    uxSummary: existing?.uxSummary || null,
  };
}

// Merge captions into the build's notes payload, seeding from the build's own
// notes (or the repo's latest) so storing captions never drops an existing
// UI/UX summary. The merged row carries the summary too, so the share page's
// `getLatestDemoNotesForRepo` lookup keeps surfacing both.
export async function storeCaptionsForBuild(
  buildId: string,
  captions: VideoCaption[],
  modelId?: string,
): Promise<void> {
  // Seed the merged payload from the build's own notes, falling back to the
  // repo's latest notes (resolved via the build's recording) so a captions-only
  // write never erases an existing UI/UX summary.
  let base = await queries.getBuildDemoNotes(buildId);
  if (!base) {
    const target = await resolveCaptionTarget(buildId);
    if (target) {
      base = await queries.getLatestDemoNotesForRepo(target.repositoryId);
    }
  }
  const merged = base ?? EMPTY_NOTES;

  await queries.upsertBuildDemoNotes(buildId, {
    ...merged,
    captions,
    generatedAt: merged.generatedAt || new Date().toISOString(),
    modelId: modelId ?? merged.modelId,
  });
}

/**
 * Generate captions for a build's primary recording via the AI vision pass and
 * persist them. Returns the number of cues written (0 = nothing capturable or
 * the model produced no usable output).
 */
export async function generateAndStoreCaptionsForBuild(
  buildId: string,
  opts?: { testId?: string; onLogCreated?: (logId: string) => void },
): Promise<{ count: number; reason?: string }> {
  const target = await resolveCaptionTarget(buildId, { testId: opts?.testId });
  if (!target) return { count: 0, reason: "no_recording" };

  const captions = await generateVideoCaptions(
    {
      repositoryId: target.repositoryId,
      productName: target.productName,
      uxSummary: target.uxSummary,
      durationMs: target.durationMs,
      steps: target.steps,
    },
    { onLogCreated: opts?.onLogCreated },
  );
  if (captions.length === 0) return { count: 0, reason: "no_captions" };

  await storeCaptionsForBuild(buildId, captions);
  return { count: captions.length };
}
