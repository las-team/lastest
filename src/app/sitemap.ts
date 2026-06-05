import type { MetadataRoute } from "next";
import { listPublicSharesForSitemap } from "@/lib/db/queries";

export const revalidate = 3600;

function origin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://app.lastest.cloud"
  );
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
    const shares = await listPublicSharesForSitemap(5000);
    shareEntries = shares.map((s) => ({
      url: `${base}/r/${s.slug}`,
      lastModified: s.updatedAt ?? now,
      changeFrequency: "monthly",
      priority: 0.7,
    }));
  } catch {
    // DB unavailable during a static build — still emit a usable sitemap.
  }

  return [...staticEntries, ...shareEntries];
}
