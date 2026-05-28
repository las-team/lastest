import type { MetadataRoute } from 'next';

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://app.lastest.cloud';
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: ['/api/'],
        allow: '/',
      },
    ],
    sitemap: `${origin()}/sitemap.xml`,
  };
}
