import { NextRequest } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import * as queries from "@/lib/db/queries";
import { resolveStoragePathStrict } from "@/lib/storage/paths";
import { isValidShareSlug } from "@/lib/share/slug";
import { resolveTestVideoUrl } from "@/lib/share/video-fallback";
import { transcodeWebmToMp4 } from "@/lib/share/video-mp4";

// On-demand mp4 of a share's recording, served as a download. The recording is
// stored as VP8/9 .webm; X (Twitter) native upload wants H.264 mp4, so we
// transcode on first request (cached beside the webm) and stream it back as an
// attachment. The founder downloads it and attaches it to a tweet, where it
// autoplays inline — the only reliable path to inline video on X (link-unfurl
// player cards are allowlist-gated).
export const dynamic = "force-dynamic";
// Transcoding a long recording can take a while; keep the route handler alive.
export const maxDuration = 300;

function sanitizeFilename(raw: string): string {
  const base = raw
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9.-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "recording";
}

function normalize(p: string): string {
  return "/" + p.replace(/^\/+/, "");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response("Bad Request", { status: 400 });
  }

  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== "public") {
    return new Response("Not Found", { status: 404 });
  }

  // Resolve the share's primary recording webm — mirror the share page: prefer
  // a persisted test_results.video_path, fall back to the disk scan the
  // executor's missing-video_path case relies on.
  const build = await queries.getBuild(share.buildId);
  if (!build) return new Response("Not Found", { status: 404 });

  const resultsRaw = build.testRunId
    ? await queries.getTestResultsByRun(build.testRunId)
    : [];
  const results = share.testId
    ? resultsRaw.filter((r) => r.testId === share.testId)
    : resultsRaw;

  const withVideo =
    results.find((r) => r.testId === share.testId && r.videoPath) ??
    results.find((r) => r.videoPath) ??
    null;

  let webmRel = withVideo?.videoPath ?? null;
  if (!webmRel && share.repositoryId) {
    const fallbackTestId = share.testId ?? results[0]?.testId ?? null;
    webmRel = await resolveTestVideoUrl(share.repositoryId, fallbackTestId);
  }
  if (!webmRel) return new Response("Not Found", { status: 404 });

  const webmAbs = await resolveStoragePathStrict(normalize(webmRel));
  if (!webmAbs || !existsSync(webmAbs)) {
    return new Response("Not Found", { status: 404 });
  }

  const mp4Abs = await transcodeWebmToMp4(webmAbs);
  if (!mp4Abs || !existsSync(mp4Abs)) {
    return new Response("Video conversion failed", { status: 500 });
  }

  const fileStat = await stat(mp4Abs);
  const filename = `lastest-${sanitizeFilename(share.targetDomain || slug)}.mp4`;
  const nodeStream = createReadStream(mp4Abs);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": fileStat.size.toString(),
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The mp4 is derived deterministically from an immutable build artifact.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
