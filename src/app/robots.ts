import type { MetadataRoute } from 'next';

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://app.lastest.cloud';
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Allow OG/Twitter card images under /api/og/ so social scrapers
        // (Twitterbot, etc.) can fetch share-link thumbnails. Longest-match
        // wins, so this overrides the broader /api/ disallow for that subpath.
        allow: ['/', '/api/og/'],
        disallow: ['/api/'],
      },
    ],
    sitemap: `${origin()}/sitemap.xml`,
  };
}
