import { NextRequest } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import * as queries from '@/lib/db/queries';
import { resolveStoragePath } from '@/lib/storage/paths';
import { isValidShareSlug } from '@/lib/share/slug';
import type { CapturedScreenshot, PublicShare } from '@/lib/db/schema';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function normalize(p: string): string {
  return '/' + p.replace(/^\/+/, '');
}

// Walk the same path set that the share page consumes — diffs, results,
// captured-step screenshots, plus active baselines for the passing-test
// fallback. Anything outside this set is rejected so a slug can't be used
// to read arbitrary storage files.
async function buildAllowedPaths(share: PublicShare): Promise<Set<string>> {
  const allowed = new Set<string>();

  const build = await queries.getBuild(share.buildId);
  if (!build) return allowed;

  const diffsRaw = await queries.getVisualDiffsByBuild(share.buildId);
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path: segments } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') {
    return new Response('Not Found', { status: 404 });
  }

  const requested = '/' + segments.join('/');
  if (requested.includes('..')) {
    return new Response('Bad Request', { status: 400 });
  }

  const allowed = await buildAllowedPaths(share);
  if (!allowed.has(requested)) {
    return new Response('Not Found', { status: 404 });
  }

  const filePath = resolveStoragePath(requested);
  if (!filePath || !existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const fileStat = await stat(filePath);
  const contentType = getContentType(filePath);
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': fileStat.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
