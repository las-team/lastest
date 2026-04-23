import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getPublicShareContext,
  getShareDataBySlug,
} from '@/lib/db/queries/public-shares';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';

// Dynamic — share content is live and render is cheap (pure server HTML).
export const revalidate = 0;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) return { title: 'Not Found' };

  const ctx = await getPublicShareContext(slug);
  if (!ctx) return { title: 'Share removed' };

  const domain = ctx.share.targetDomain || ctx.test?.name || 'this site';
  const title = `${domain} · Lastest`;
  const description = ctx.build.changesDetected
    ? `${ctx.build.changesDetected} visual changes detected across ${ctx.build.totalTests} tests.`
    : `Visual regression check for ${domain} — recording, screenshots, and diff report.`;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: buildShareUrl(slug),
      type: 'article',
      siteName: 'Lastest',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const data = await getShareDataBySlug(slug);
  if (!data) notFound();

  const { share, test, results: scopedResults } = data;

  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const rel = p.replace(/^\/+/, '');
    return `/share/${slug}/${rel}`;
  };

  const videos = scopedResults
    .map((r) => (r.videoPath ? toUrl(r.videoPath) : null))
    .filter((v): v is string => !!v);

  const displayDomain = share.targetDomain || test?.name || 'this site';
  const claimLink = `/register?claim=${slug}`;
  const signInLink = `/login?claim=${slug}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="font-semibold">Lastest</a>
          <div className="flex items-center gap-4">
            <a href={signInLink} className="text-sm underline-offset-4 hover:underline">
              Sign in
            </a>
            <a
              href={claimLink}
              className="text-sm font-medium rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
            >
              Sign up free
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-10">
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">We visually tested</p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight break-words">
            {displayDomain}
          </h1>
        </section>

        {videos.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Test recording</h2>
            {videos.map((src, i) => (
              <video
                key={i}
                src={src}
                autoPlay={i === 0}
                loop
                muted
                playsInline
                controls
                className="w-full aspect-video rounded-md border bg-black"
              />
            ))}
          </section>
        )}

        <section className="rounded-xl border bg-muted/40 p-6 sm:p-8 space-y-4">
          <h2 className="text-xl sm:text-2xl font-semibold">Claim this test — free</h2>
          <p className="text-sm text-muted-foreground">
            We&apos;ll copy the test into your own Lastest workspace. You supply the environment,
            we supply the regression coverage.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={claimLink}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Sign up free
            </a>
            <a
              href={signInLink}
              className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Sign in
            </a>
          </div>
        </section>

        <footer className="pt-6 border-t text-xs text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 justify-between">
          <span>Run by Lastest</span>
          <div className="flex items-center gap-4">
            <a href="/terms" className="hover:text-foreground">Terms</a>
            <a href="/privacy" className="hover:text-foreground">Privacy</a>
            <a
              href={`mailto:abuse@lastest.cloud?subject=Takedown%20request:%20${slug}`}
              className="hover:text-foreground"
            >
              Report abuse
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
