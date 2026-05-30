'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { db } from '@/lib/db';
import { tests, playwrightSettings } from '@/lib/db/schema';
import type { DesignSystemConfig } from '@/lib/db/schema';
import { requireTestOwnership } from '@/lib/auth/ownership';
import { requireRepoAccess } from '@/lib/auth';
import { parseDesignSystemCss, mergeDesignSystemConfig } from '@/lib/design-system/tokens';

export async function saveTestDesignSystemOverrides(
  testId: string,
  overrides: Partial<DesignSystemConfig> | null,
) {
  await requireTestOwnership(testId);
  await db.update(tests).set({ designSystemOverrides: overrides, updatedAt: new Date() }).where(eq(tests.id, testId));
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestDesignSystemOverrides(testId: string) {
  await requireTestOwnership(testId);
  await db.update(tests).set({ designSystemOverrides: null, updatedAt: new Date() }).where(eq(tests.id, testId));
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

/**
 * Parse a pasted CSS file from the Setup page and persist the resulting
 * token map onto the test row. Returns the parsed config so the UI can
 * show counts per category without re-parsing client-side.
 */
export async function saveTestDesignSystemFromCss(testId: string, css: string) {
  await requireTestOwnership(testId);
  const parsed = parseDesignSystemCss(css);
  await db.update(tests).set({ designSystemOverrides: parsed, updatedAt: new Date() }).where(eq(tests.id, testId));
  revalidatePath(`/tests/${testId}`);
  return { success: true, config: parsed };
}

export async function saveRepoDesignSystemFromCss(repositoryId: string, css: string) {
  await requireRepoAccess(repositoryId);
  const parsed = parseDesignSystemCss(css);
  await db
    .update(playwrightSettings)
    .set({ designSystem: parsed, updatedAt: new Date() })
    .where(eq(playwrightSettings.repositoryId, repositoryId));
  revalidatePath(`/settings/${repositoryId}`);
  return { success: true, config: parsed };
}

/**
 * Accept a design-system bundle uploaded from the Setup tab. The Claude
 * Design handoff format is a tarball-of-files but the browser File API
 * gives us a ZIP, so we accept either: jszip's loader transparently
 * handles ZIP archives, and a `.tar.gz` (the original handoff shape) can
 * be re-zipped by the user before upload. Inside the archive we walk
 * every `.css` file, concatenate them, and run the same
 * `parseDesignSystemCss` the textarea path used — single parser, two
 * intake surfaces.
 *
 * The form action is invoked via `<form action={...}>` with a `FormData`
 * carrying `repositoryId` + `file`. We bound the upload to 5 MB so a
 * runaway export doesn't OOM the server; the largest Lastest handoff
 * we've seen is ~170 KB so this is generous.
 */
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export async function uploadRepoDesignSystemBundle(formData: FormData) {
  const repositoryId = formData.get('repositoryId');
  const file = formData.get('file');
  if (typeof repositoryId !== 'string' || !repositoryId) {
    return { success: false as const, error: 'Missing repositoryId' };
  }
  if (!(file instanceof File)) {
    return { success: false as const, error: 'Missing file' };
  }
  if (file.size === 0) {
    return { success: false as const, error: 'File is empty' };
  }
  if (file.size > MAX_BUNDLE_BYTES) {
    return { success: false as const, error: `Bundle exceeds 5 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` };
  }
  await requireRepoAccess(repositoryId);

  const buf = Buffer.from(await file.arrayBuffer());
  const name = (file.name || '').toLowerCase();

  // Single-file CSS upload — no archive to walk.
  if (name.endsWith('.css')) {
    const css = buf.toString('utf-8');
    const parsed = parseDesignSystemCss(css);
    parsed.meta = { files: [file.name], assets: [], hasFontFiles: false };
    await persist(repositoryId, parsed);
    return summarize(parsed, [file.name]);
  }

  // ZIP archive — collect every .css member, ignore everything else
  // (assets/, README.md, preview/*.html). We don't trust filenames for
  // categorization; the parser only cares about the actual `--token:
  // value;` declarations regardless of which file they came from.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return {
      success: false as const,
      error: 'Unsupported file. Upload a .zip bundle (or a single .css file). For .tar.gz exports, re-archive as zip first.',
    };
  }

  const cssFiles: Array<{ path: string; content: string }> = [];
  const assetFiles: string[] = [];
  let readmeContent: string | null = null;
  let hasFontFiles = false;
  const allFiles: string[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    allFiles.push(entry.name);
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.css')) {
      cssFiles.push({ path: entry.name, content: await entry.async('string') });
    } else if (lower.endsWith('readme.md') && readmeContent === null) {
      readmeContent = await entry.async('string');
    } else if (lower.endsWith('.svg') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
      assetFiles.push(entry.name);
    } else if (lower.endsWith('.woff') || lower.endsWith('.woff2') || lower.endsWith('.otf') || lower.endsWith('.ttf')) {
      assetFiles.push(entry.name);
      hasFontFiles = true;
    }
  }

  if (cssFiles.length === 0) {
    return {
      success: false as const,
      error: 'No .css files found in the bundle. Expected a design-system handoff with at least one .css token file.',
    };
  }

  // Parse each CSS file separately and merge — the parser already
  // dedupes by value, so a token redeclared across files lands once.
  let merged: DesignSystemConfig | null = null;
  for (const f of cssFiles) {
    const parsed = parseDesignSystemCss(f.content);
    merged = mergeDesignSystemConfig(merged, parsed);
  }
  if (!merged) {
    return { success: false as const, error: 'Parsed 0 tokens from the bundle CSS files.' };
  }

  // Attach README-derived metadata so the preview can show a friendly
  // title + helper text without re-uploading.
  const { title, description } = extractReadmeMeta(readmeContent);
  merged.meta = {
    title,
    description,
    files: cssFiles.map((f) => f.path),
    assets: assetFiles,
    hasFontFiles,
  };

  await persist(repositoryId, merged);
  return summarize(merged, cssFiles.map((f) => f.path));
}

/** Pull a friendly title + first-paragraph blurb out of a bundle README
 *  for the Setup preview. Returns undefined fields when the README is
 *  missing or shaped unexpectedly. */
function extractReadmeMeta(md: string | null): { title?: string; description?: string } {
  if (!md) return {};
  // First H1 (skip Claude's "CODING AGENTS: READ THIS FIRST" handoff
  // header if it's the first H1 — that's bundle scaffolding, not the
  // user's title).
  const headings = Array.from(md.matchAll(/^#\s+(.+)$/gm)).map((m) => m[1].trim());
  const title = headings.find((h) => !/coding agents/i.test(h));

  // First non-empty paragraph after the chosen heading. We scan after the
  // matched heading for the first run of lines that don't start with `#`
  // and aren't blank.
  let description: string | undefined;
  if (title) {
    const idx = md.indexOf(`# ${title}`);
    const after = idx >= 0 ? md.slice(idx + (`# ${title}`).length) : md;
    const paragraphs = after.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const para = paragraphs.find((p) => !p.startsWith('#') && !p.startsWith('---'));
    if (para) {
      // Strip markdown emphasis and inline backticks, collapse whitespace,
      // cap at 280 chars so the description fits in the header card.
      description = para
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
    }
  }
  return { title, description };
}

async function persist(repositoryId: string, config: DesignSystemConfig) {
  // upsert: row may not exist yet for repos that have never opened the
  // Playwright Settings page; mirror the pattern in upsertPlaywrightSettings.
  const [existing] = await db
    .select()
    .from(playwrightSettings)
    .where(eq(playwrightSettings.repositoryId, repositoryId));
  if (existing) {
    await db
      .update(playwrightSettings)
      .set({ designSystem: config, updatedAt: new Date() })
      .where(eq(playwrightSettings.id, existing.id));
  } else {
    const { v4: uuid } = await import('uuid');
    await db.insert(playwrightSettings).values({
      id: uuid(),
      repositoryId,
      designSystem: config,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  revalidatePath('/tests');
}

function summarize(config: DesignSystemConfig, files: string[]) {
  const counts = Object.fromEntries(
    Object.entries(config.tokens ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { success: true as const, config, total, counts, files };
}

export async function clearRepoDesignSystem(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  await db
    .update(playwrightSettings)
    .set({ designSystem: null, updatedAt: new Date() })
    .where(eq(playwrightSettings.repositoryId, repositoryId));
  revalidatePath('/tests');
  return { success: true };
}
