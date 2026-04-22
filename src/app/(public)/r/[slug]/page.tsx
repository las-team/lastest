import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import * as queries from '@/lib/db/queries';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';
import { ShareViewerClient } from './share-viewer-client';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

function formatTimeAgo(d: Date | null): string {
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) return { title: 'Not Found' };

  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) return { title: 'Share removed' };

  const domain = ctx.share.targetDomain || ctx.test?.name || 'this site';
  const title = `Visual test of ${domain} · Lastest`;
  const description = ctx.build.changesDetected
    ? `${ctx.build.changesDetected} visual changes detected across ${ctx.build.totalTests} tests.`
    : `We ran a visual regression check on ${domain}. See the screenshots and recording.`;

  const url = buildShareUrl(slug);

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      siteName: 'Lastest',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) notFound();

  const { share, build, test, testRun } = ctx;

  const [diffs, results] = await Promise.all([
    queries.getVisualDiffsByBuild(build.id),
    testRun ? queries.getTestResultsByRun(testRun.id) : Promise.resolve([]),
  ]);

  // Fire-and-forget increment. Not awaited to keep the page fast.
  queries.incrementPublicShareView(slug).catch(() => {});

  const mediaBase = `/api/share/${slug}/media`;
  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    return mediaBase + (p.startsWith('/') ? p : `/${p}`);
  };

  // Pick the hero diff: highest pixel difference among "changed" diffs.
  const changedDiffs = diffs.filter((d) => (d.pixelDifference ?? 0) > 0);
  const heroDiff = changedDiffs.sort(
    (a, b) => (b.pixelDifference ?? 0) - (a.pixelDifference ?? 0),
  )[0];

  // Collect all screenshots across all test results
  const galleryImages: Array<{ src: string; label: string }> = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.screenshotPath && !seen.has(r.screenshotPath)) {
      seen.add(r.screenshotPath);
      galleryImages.push({ src: toUrl(r.screenshotPath)!, label: 'Primary' });
    }
    const captured = (r.screenshots ?? []) as Array<{ path: string; label?: string }>;
    for (const s of captured) {
      if (!seen.has(s.path)) {
        seen.add(s.path);
        galleryImages.push({ src: toUrl(s.path)!, label: s.label || 'Step' });
      }
    }
  }

  // Primary video (first non-null)
  const videoResult = results.find((r) => r.videoPath);
  const videoUrl = videoResult ? toUrl(videoResult.videoPath) : null;

  const displayDomain = share.targetDomain || test?.name || 'this site';
  const faviconUrl = share.targetDomain
    ? `https://www.google.com/s2/favicons?domain=${share.targetDomain}&sz=64`
    : null;

  const changed = build.changesDetected ?? 0;
  const failed = build.failedCount ?? 0;
  const flaky = build.flakyCount ?? 0;
  const total = build.totalTests ?? 0;
  const passed = build.passedCount ?? 0;

  const claimLink = `/register?claim=${slug}`;
  const signInLink = `/login?claim=${slug}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      {/* Top bar */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block w-6 h-6 rounded-md bg-primary" aria-hidden />
            Lastest
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Shared visual test</span>
            <Link
              href={signInLink}
              className="text-primary font-medium hover:underline underline-offset-4"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12 space-y-10">
        {/* Hero */}
        <section className="space-y-4">
          <div className="flex items-start gap-3 sm:gap-4">
            {faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={faviconUrl}
                alt=""
                width={40}
                height={40}
                className="rounded-md border border-border bg-card shrink-0 mt-1"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                We visually tested
              </p>
              <h1 className="font-semibold text-2xl sm:text-4xl tracking-tight break-words">
                {displayDomain}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {testRun?.gitBranch && (
                  <span className="font-mono">{testRun.gitBranch}</span>
                )}
                {testRun?.gitCommit && testRun.gitCommit !== 'unknown' && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="font-mono">{testRun.gitCommit.slice(0, 7)}</span>
                  </>
                )}
                {build.completedAt && (
                  <>
                    {(testRun?.gitBranch || testRun?.gitCommit) && (
                      <span className="mx-1.5">·</span>
                    )}
                    <span>{formatTimeAgo(build.completedAt)}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="tests" value={total} tone="neutral" />
            <SummaryChip label="passed" value={passed} tone="success" />
            {changed > 0 && <SummaryChip label="changed" value={changed} tone="warning" />}
            {failed > 0 && <SummaryChip label="failed" value={failed} tone="danger" />}
            {flaky > 0 && <SummaryChip label="flaky" value={flaky} tone="warning" />}
          </div>
        </section>

        {/* Hero visual: diff slider or screenshot */}
        <ShareViewerClient
          heroBaseline={toUrl(heroDiff?.baselineImagePath)}
          heroCurrent={toUrl(heroDiff?.currentImagePath)}
          heroDiff={toUrl(heroDiff?.diffImagePath)}
          heroScreenshot={galleryImages[0]?.src ?? null}
          videoUrl={videoUrl}
          gallery={galleryImages}
          claimLink={claimLink}
        />

        {/* What is Lastest? trust strip */}
        <section className="rounded-xl border border-border/80 bg-card/70 p-6 sm:p-8">
          <h2 className="font-semibold text-lg mb-4">What is Lastest?</h2>
          <div className="grid sm:grid-cols-3 gap-4 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1">Pixel-perfect regression catch</p>
              Every deploy, we compare every screen against the last known-good baseline.
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">AI-triaged diffs</p>
              We tell you which changes matter and which are noise so you ship faster.
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Claim & own it</p>
              Sign up to import this test into your workspace and re-run it anytime.
            </div>
          </div>
        </section>

        {/* Primary CTA */}
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex-1">
            <h2 className="font-semibold text-xl mb-1">Claim this test — free</h2>
            <p className="text-sm text-muted-foreground">
              Your next run lives in your own Lastest workspace. We import the test
              code automatically; you set up environment variables the way you want.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Link
              href={claimLink}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium px-5 py-2.5 hover:bg-primary/90 transition-colors"
            >
              Claim this test
            </Link>
            <Link
              href={signInLink}
              className="inline-flex items-center justify-center rounded-md border border-border font-medium px-5 py-2.5 hover:bg-muted transition-colors"
            >
              Sign in
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/60 pt-6 pb-10 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          <span>Run by Lastest · Shared {formatTimeAgo(share.createdAt)}</span>
          <div className="flex items-center gap-3">
            <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
              Privacy
            </Link>
            <a
              href={`mailto:abuse@lastest.cloud?subject=Takedown%20request:%20${slug}`}
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              Report abuse
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClasses = {
    neutral: 'bg-muted text-muted-foreground border-border',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneClasses}`}
    >
      <span className="tabular-nums">{value}</span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}
