import type { MetadataRoute } from "next";

function origin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://app.lastest.cloud"
  );
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Allow OG/Twitter card images under /api/og/ so social scrapers
        // (Twitterbot, etc.) can fetch share-link thumbnails. Longest-match
        // wins, so this overrides the broader /api/ disallow for that subpath.
        allow: ["/", "/api/og/"],
        // /api/ — never crawlable. /share/*/screenshots/ — deep per-run
        // screenshot media referenced only as <img> on /r/ pages. Test-scoped
        // shares auto-follow the latest run, so once a share re-runs the prior
        // run's image URLs drop out of the asset route's allow-list and 404;
        // Google had indexed them and kept reporting "Not found (404)". These
        // aren't pages and aren't wanted in Image Search, so stop the crawl at
        // the source. /share/*/videos/ stays crawlable for the video sitemap.
        disallow: ["/api/", "/share/*/screenshots/"],
      },
    ],
    sitemap: `${origin()}/sitemap.xml`,
  };
}
