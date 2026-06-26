import { NextRequest } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import * as queries from "@/lib/db/queries";
import { resolveStoragePath } from "@/lib/storage/paths";
import { isValidShareSlug } from "@/lib/share/slug";
import { resolveTestVideoUrl } from "@/lib/share/video-fallback";
import { parseByteRange } from "@/lib/http/byte-range";
import type { CapturedScreenshot, PublicShare } from "@/lib/db/schema";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

function normalize(p: string): string {
  return "/" + p.replace(/^\/+/, "");
}

// Walk the same path set that the share page consumes — diffs, results,
// captured-step screenshots, plus active baselines for the passing-test
// fallback. Anything outside this set is rejected so a slug can't be used
// to read arbitrary storage files.
async function buildAllowedPaths(
  share: PublicShare,
  build: Awaited<ReturnType<typeof queries.resolveShareBuild>>,
): Promise<Set<string>> {
  const allowed = new Set<string>();

  // `build` is the share's RESOLVED build (test-scoped shares auto-follow the
  // latest run — see resolveShareBuild), NOT share.buildId. The share page
  // resolves the same build, so the allow-list and the page's image URLs agree.
  if (!build) return allowed;

  const diffsRaw = await queries.getVisualDiffsByBuild(build.id);
  const diffs = share.testId
    ? diffsRaw.filter((d) => d.testId === share.testId)
    : diffsRaw;
  for (const d of diffs) {
    for (const p of [
      d.baselineImagePath,
      d.currentImagePath,
      d.diffImagePath,
      d.plannedImagePath,
      d.plannedDiffImagePath,
      d.mainBaselineImagePath,
      d.mainDiffImagePath,
    ]) {
      if (p) allowed.add(normalize(p));
    }
  }

  const resultsRaw = build.testRunId
    ? await queries.getTestResultsByRun(build.testRunId)
    : [];
  const results = share.testId
    ? resultsRaw.filter((r) => r.testId === share.testId)
    : resultsRaw;
  for (const r of results) {
    if (r.screenshotPath) allowed.add(normalize(r.screenshotPath));
    if (r.videoPath) allowed.add(normalize(r.videoPath));
    const captured = (r.screenshots ?? []) as CapturedScreenshot[] | null;
    for (const s of captured ?? []) {
      if (s.path) allowed.add(normalize(s.path));
    }
  }

  // Disk-fallback: when the executor wrote a .webm but didn't persist
  // `test_results.video_path`, the share page rewrites the fallback URL
  // through /share/{slug}/videos/... — so the asset route has to allow that
  // exact file too, otherwise the <video> element 404s and the progress bar
  // never moves. Mirror the same scan `resolveTestVideoUrl` does so the URL
  // and the allow-list always agree.
  if (share.repositoryId) {
    const testIdsNeedingFallback = new Set<string>();
    for (const r of results) {
      if (!r.videoPath && r.testId) testIdsNeedingFallback.add(r.testId);
    }
    if (
      share.testId &&
      !results.some((r) => r.testId === share.testId && r.videoPath)
    ) {
      testIdsNeedingFallback.add(share.testId);
    }
    for (const tid of testIdsNeedingFallback) {
      const fallback = await resolveTestVideoUrl(share.repositoryId, tid);
      if (fallback) allowed.add(normalize(fallback));
    }
  }

  const baselineTestIds = new Set<string>();
  if (share.testId) {
    baselineTestIds.add(share.testId);
  } else {
    for (const r of resultsRaw) {
      if (r.testId) baselineTestIds.add(r.testId);
    }
  }
  for (const tid of baselineTestIds) {
    const baselines = await queries.getActiveBaselinesForTest(tid);
    for (const b of baselines) {
      if (b.imagePath) allowed.add(normalize(b.imagePath));
    }
  }

  return allowed;
}

// The allow-list for a public share is deterministic and its assets are served
// `immutable`, but a Range-served video makes the browser fire many sequential
// GETs to this route — and each one previously rebuilt the list from scratch
// (several DB round-trips + a storage readdir/stat scan in `resolveTestVideoUrl`).
// That per-request cost, paid once per byte-range request, is what stalled
// first-frame paint by seconds on the share page. Cache the computed set per
// slug so the work runs at most once per TTL instead of once per request.
const ALLOW_CACHE_TTL_MS = 60_000;
const ALLOW_CACHE_MAX = 500;
const allowedPathsCache = new Map<
  string,
  { paths: Set<string>; expiresAt: number }
>();

async function getAllowedPaths(
  slug: string,
  share: PublicShare,
): Promise<Set<string>> {
  // Resolve the build per request and key the cache by it. Test-scoped shares
  // auto-follow the latest run, so a re-run swaps the resolved build — keying
  // by build id means the new run's allow-list takes effect immediately rather
  // than 404ing every fresh image until the TTL lapses. The resolver is a
  // single indexed query, far cheaper than the per-request scan this cache
  // was introduced to avoid.
  const build = await queries.resolveShareBuild(share);
  const cacheKey = `${slug}:${build?.id ?? "none"}`;

  const hit = allowedPathsCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.paths;

  const paths = await buildAllowedPaths(share, build);

  // Bounded eviction: Map preserves insertion order, so the first key is the
  // oldest. Keeps the cache from growing unbounded across many distinct slugs.
  if (allowedPathsCache.size >= ALLOW_CACHE_MAX) {
    const oldest = allowedPathsCache.keys().next().value;
    if (oldest !== undefined) allowedPathsCache.delete(oldest);
  }
  allowedPathsCache.set(cacheKey, {
    paths,
    expiresAt: Date.now() + ALLOW_CACHE_TTL_MS,
  });
  return paths;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path: segments } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response("Bad Request", { status: 400 });
  }

  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== "public") {
    return new Response("Not Found", { status: 404 });
  }

  const requested = "/" + segments.join("/");
  if (requested.includes("..")) {
    return new Response("Bad Request", { status: 400 });
  }

  const allowed = await getAllowedPaths(slug, share);
  if (!allowed.has(requested)) {
    return new Response("Not Found", { status: 404 });
  }

  const filePath = resolveStoragePath(requested);
  if (!filePath || !existsSync(filePath)) {
    return new Response("Not Found", { status: 404 });
  }

  const fileStat = await stat(filePath);
  const contentType = getContentType(filePath);
  const totalSize = fileStat.size;

  // Mirrors the Range support in `/api/media/...`. Without `Accept-Ranges`
  // and `206 Partial Content`, the browser's <video> element can't seek to
  // un-buffered timestamps — `currentTime = X` triggers a Range request,
  // gets back a plain 200 with the full file, and resets to 0. That surfaces
  // on the share page as the scrubber thumb jumping back to the start.
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, totalSize) : null;

  if (rangeHeader && !range) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${totalSize}` },
    });
  }

  if (range) {
    const { start, end } = range;
    const partialStream = createReadStream(filePath, { start, end });
    const partialWebStream = Readable.toWeb(partialStream) as ReadableStream;
    return new Response(partialWebStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": (end - start + 1).toString(),
      },
    });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": totalSize.toString() },
  });
}
