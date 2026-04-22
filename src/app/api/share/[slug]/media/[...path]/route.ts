import { NextRequest } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import * as queries from '@/lib/db/queries';
import { resolveStoragePath } from '@/lib/storage/paths';
import { isValidShareSlug } from '@/lib/share/slug';
import type { VisualDiff, TestResult, CapturedScreenshot } from '@/lib/db/schema';

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

function buildAllowlist(diffs: VisualDiff[], results: TestResult[]): Set<string> {
  const allow = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p) allow.add(p.startsWith('/') ? p : `/${p}`);
  };
  for (const d of diffs) {
    add(d.baselineImagePath);
    add(d.currentImagePath);
    add(d.diffImagePath);
    add(d.plannedImagePath);
    add(d.plannedDiffImagePath);
    add(d.mainBaselineImagePath);
    add(d.mainDiffImagePath);
  }
  for (const r of results) {
    add(r.screenshotPath);
    add(r.videoPath);
    const captured = (r.screenshots ?? []) as CapturedScreenshot[];
    for (const s of captured) add(s.path);
  }
  return allow;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path: segments } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) {
    return new Response('Not Found', { status: 404 });
  }

  const requested = '/' + segments.join('/');
  if (requested.includes('..')) {
    return new Response('Bad Request', { status: 400 });
  }

  const diffs = await queries.getVisualDiffsByBuild(ctx.build.id);
  const results = ctx.build.testRunId
    ? await queries.getTestResultsByRun(ctx.build.testRunId)
    : [];
  const allowlist = buildAllowlist(diffs, results);

  if (!allowlist.has(requested)) {
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
