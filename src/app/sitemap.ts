import type { MetadataRoute } from "next";
import { listIndexablePublicShares } from "@lastest/plugin-share";
import { getSitemapEnrichment } from "@/lib/core/share-host";

export const revalidate = 3600;

function origin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://app.lastest.cloud"
  );
}

// Next's sitemap serializer raw-interpolates every field into the XML with NO
// escaping (see node_modules/next/.../metadata/resolve-route-data.js), so a
// bare `&`, `<`, or `>` from a user-controlled test name or domain produces
// invalid XML (`xmlParseEntityRef: no name`). Escape values ourselves before
// handing them over — Next escapes nothing, so there's no double-encoding risk.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${base}/login`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/register`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];

  let shareEntries: MetadataRoute.Sitemap = [];
  try {
    // Sitemap input: one entry per indexable PER-TEST share (testId not
    // null), deduped to the most recent live share per test. Build-wide
    // shares (testId null) are EXCLUDED — they're noindex'd on the page to
    // avoid duplicate-content competition with their per-test share.
    const rawShares = await listIndexablePublicShares(5000);
    const enrichment = await getSitemapEnrichment(
      rawShares.map((s) => ({
        slug: s.slug,
        testId: s.testId,
        buildId: s.buildId,
      })),
    );

    // Two-level dedup, rows are createdAt-desc:
    //  - per slug: retried runs leave multiple results per (run, test) — keep
    //    the first row per slug so each sitemap entry carries at most one
    //    video.
    //  - per test: a test may carry multiple public share rows (legacy links
    //    minted before the 1-share-per-test reuse rule). Keep only the most
    //    recent share per test so each test contributes exactly one sitemap
    //    URL.
    const seenSlug = new Set<string>();
    const seenTest = new Set<string>();
    const shares: Array<{
      slug: string;
      updatedAt: Date | null;
      targetDomain: string | null;
      testName: string | null;
      changesDetected: number;
      videoPath: string | null;
      videoDurationMs: number | null;
    }> = [];
    for (const s of rawShares) {
      if (seenSlug.has(s.slug)) continue;
      seenSlug.add(s.slug);
      if (s.testId) {
        if (seenTest.has(s.testId)) continue;
        seenTest.add(s.testId);
      }
      const e = enrichment.get(s.slug);
      shares.push({
        slug: s.slug,
        updatedAt:
          e?.buildCompletedAt ?? e?.buildCreatedAt ?? s.createdAt ?? null,
        targetDomain: s.targetDomain,
        testName: e?.testName ?? null,
        changesDetected: e?.changesDetected ?? 0,
        videoPath: e?.videoPath ?? null,
        videoDurationMs: e?.videoDurationMs ?? null,
      });
    }

    shareEntries = shares.map((s) => {
      // <video:video> extension on test-share entries. Title, description,
      // and thumbnail must stay CONSISTENT with the VideoObject JSON-LD the
      // share page emits (Google merges metadata across sources and flags
      // mismatches), so the strings mirror buildVideoSchemas() in
      // plugins/share/src/ui/page.tsx.
      const displayName = s.testName ?? s.targetDomain ?? "this site";
      const domain = s.targetDomain ?? s.testName ?? "this site";
      const videos = s.videoPath
        ? [
            {
              title: xmlEscape(
                `${displayName} · Lastest visual regression run`,
              ),
              description: xmlEscape(
                s.changesDetected > 0
                  ? `Visual regression recording for ${domain} — ${s.changesDetected} change${s.changesDetected === 1 ? "" : "s"} detected.`
                  : `Visual regression recording for ${domain} — no changes detected against baseline.`,
              ),
              thumbnail_loc: xmlEscape(`${base}/api/og/share/${s.slug}`),
              // Same /share/<slug>/... public media route the page player uses.
              content_loc: xmlEscape(
                `${base}/share/${s.slug}/${encodeURI(s.videoPath.replace(/^\/+/, ""))}`,
              ),
              ...(s.videoDurationMs && s.videoDurationMs > 0
                ? {
                    duration: Math.min(
                      28800,
                      Math.max(1, Math.round(s.videoDurationMs / 1000)),
                    ),
                  }
                : {}),
              // Next emits Date values here via toString(), not W3C datetime —
              // pass the ISO string explicitly so Google can parse it.
              ...(s.updatedAt
                ? { publication_date: s.updatedAt.toISOString() }
                : {}),
            },
          ]
        : undefined;
      return {
        url: xmlEscape(`${base}/r/${s.slug}`),
        lastModified: s.updatedAt ?? now,
        changeFrequency: "monthly" as const,
        priority: 0.7,
        ...(videos ? { videos } : {}),
      };
    });
  } catch {
    // DB unavailable during a static build — still emit a usable sitemap.
  }

  return [...staticEntries, ...shareEntries];
}
