import type { MetadataRoute } from 'next';
import { listPublicSharesForSitemap } from '@/lib/db/queries';

export const revalidate = 3600;

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://app.lastest.cloud';
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
  ];

  let shareEntries: MetadataRoute.Sitemap = [];
  try {
    const shares = await listPublicSharesForSitemap(5000);
    shareEntries = shares.map((s) => {
      // <video:video> extension on test-share entries. Title, description,
      // and thumbnail must stay CONSISTENT with the VideoObject JSON-LD the
      // share page emits (Google merges metadata across sources and flags
      // mismatches), so the strings mirror buildVideoSchema() in
      // src/app/(public)/r/[slug]/page.tsx.
      const displayName = s.testName ?? s.targetDomain ?? 'this site';
      const domain = s.targetDomain ?? s.testName ?? 'this site';
      const videos = s.videoPath
        ? [
            {
              title: `${displayName} · Lastest visual regression run`,
              description:
                s.changesDetected > 0
                  ? `Visual regression recording for ${domain} — ${s.changesDetected} change${s.changesDetected === 1 ? '' : 's'} detected.`
                  : `Visual regression recording for ${domain} — no changes detected against baseline.`,
              thumbnail_loc: `${base}/api/og/share/${s.slug}`,
              // Same /share/<slug>/... public media route the page player uses.
              content_loc: `${base}/share/${s.slug}/${s.videoPath.replace(/^\/+/, '')}`,
              ...(s.videoDurationMs && s.videoDurationMs > 0
                ? { duration: Math.min(28800, Math.max(1, Math.round(s.videoDurationMs / 1000))) }
                : {}),
              // Next emits Date values here via toString(), not W3C datetime —
              // pass the ISO string explicitly so Google can parse it.
              ...(s.updatedAt ? { publication_date: s.updatedAt.toISOString() } : {}),
            },
          ]
        : undefined;
      return {
        url: `${base}/r/${s.slug}`,
        lastModified: s.updatedAt ?? now,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
        ...(videos ? { videos } : {}),
      };
    });
  } catch {
    // DB unavailable during a static build — still emit a usable sitemap.
  }

  return [...staticEntries, ...shareEntries];
}
