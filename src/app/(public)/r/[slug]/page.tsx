import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import * as queries from '@/lib/db/queries';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';
import { ShareViewer } from './share-viewer-client';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

function formatTimestamp(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) return { title: 'Not Found' };

  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) return { title: 'Share removed' };

  const domain = ctx.share.targetDomain || ctx.test?.name || 'this site';
  const title = `${domain} — specimen · Lastest`;
  const description = ctx.build.changesDetected
    ? `${ctx.build.changesDetected} visual changes logged across ${ctx.build.totalTests} tests.`
    : `A Lastest dossier on ${domain}: recording, screenshots, and visual diff report.`;

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

  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) notFound();

  const { share, build, test, testRun } = ctx;

  const [diffsRaw, results] = await Promise.all([
    queries.getVisualDiffsWithTestStatus(build.id),
    testRun ? queries.getTestResultsByRun(testRun.id) : Promise.resolve([]),
  ]);

  // Test-level share: filter diffs + results to just that test.
  const diffs: VisualDiffWithTestStatus[] = share.testId
    ? diffsRaw.filter((d) => d.testId === share.testId)
    : diffsRaw;
  const scopedResults = share.testId
    ? results.filter((r) => r.testId === share.testId)
    : results;

  // Fire-and-forget view bump
  queries.incrementPublicShareView(slug).catch(() => {});

  const mediaBase = `/api/share/${slug}/media`;
  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    return mediaBase + (p.startsWith('/') ? p : `/${p}`);
  };

  // Group diffs by test; sort tests by severity then name.
  const byTest = new Map<string, { testId: string; testName: string; diffs: VisualDiffWithTestStatus[] }>();
  for (const d of diffs) {
    const key = d.testId;
    if (!byTest.has(key)) {
      byTest.set(key, {
        testId: d.testId,
        testName: d.testName || test?.name || 'Unnamed test',
        diffs: [],
      });
    }
    byTest.get(key)!.diffs.push(d);
  }

  function diffTier(d: VisualDiffWithTestStatus): number {
    if (d.testResultStatus === 'failed' || d.status === 'rejected') return 0;
    if ((d.classification === 'changed') || ((d.pixelDifference ?? 0) > 0)) return 1;
    return 2;
  }

  const testGroups = Array.from(byTest.values())
    .map((g) => ({
      ...g,
      diffs: g.diffs.slice().sort((a, b) => {
        const t = diffTier(a) - diffTier(b);
        if (t !== 0) return t;
        return (b.pixelDifference ?? 0) - (a.pixelDifference ?? 0);
      }),
      severity: Math.min(...g.diffs.map(diffTier)),
    }))
    .sort((a, b) => a.severity - b.severity || a.testName.localeCompare(b.testName));

  // Screenshots catalog (deduped across all results in scope)
  const catalog: Array<{ src: string; label: string; testName: string }> = [];
  const seen = new Set<string>();
  for (const r of scopedResults) {
    const thisTestName =
      testGroups.find((g) => g.testId === r.testId)?.testName || test?.name || 'capture';
    if (r.screenshotPath && !seen.has(r.screenshotPath)) {
      seen.add(r.screenshotPath);
      catalog.push({ src: toUrl(r.screenshotPath)!, label: 'Primary', testName: thisTestName });
    }
    const captured = (r.screenshots ?? []) as Array<{ path: string; label?: string }>;
    for (const s of captured) {
      if (!seen.has(s.path)) {
        seen.add(s.path);
        catalog.push({ src: toUrl(s.path)!, label: s.label || 'Step', testName: thisTestName });
      }
    }
  }

  // Videos: collect one per test result that has one
  const videos: Array<{ src: string; testName: string; durationMs: number | null }> = [];
  for (const r of scopedResults) {
    if (!r.videoPath) continue;
    const thisTestName =
      testGroups.find((g) => g.testId === r.testId)?.testName || test?.name || 'Recording';
    videos.push({
      src: toUrl(r.videoPath)!,
      testName: thisTestName,
      durationMs: r.durationMs ?? null,
    });
  }

  // Serialize diffs (plain JSON) for client
  const clientTestGroups = testGroups.map((g) => ({
    testId: g.testId,
    testName: g.testName,
    diffs: g.diffs.map((d) => ({
      id: d.id,
      stepLabel: d.stepLabel,
      baseline: toUrl(d.baselineImagePath),
      current: toUrl(d.currentImagePath),
      diff: toUrl(d.diffImagePath),
      pixelDifference: d.pixelDifference ?? 0,
      percentageDifference: d.percentageDifference,
      classification: d.classification,
      status: d.status,
      testResultStatus: d.testResultStatus,
    })),
  }));

  const displayDomain = share.targetDomain || test?.name || 'this site';
  const claimLink = `/register?claim=${slug}`;
  const signInLink = `/login?claim=${slug}`;

  const changed = build.changesDetected ?? 0;
  const failed = build.failedCount ?? 0;
  const flaky = build.flakyCount ?? 0;
  const total = share.testId ? scopedResults.length : build.totalTests ?? 0;
  const passed = share.testId ? scopedResults.filter((r) => r.status === 'passed').length : build.passedCount ?? 0;

  const scopeLabel = share.testId ? 'Test specimen' : 'Build specimen';

  return (
    <div className="min-h-screen bg-[oklch(0.985_0.003_230)] text-foreground selection:bg-primary/20">
      {/* Paper grain */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
        aria-hidden
      />

      {/* Top bar */}
      <header className="relative z-10 border-b border-foreground/10 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-5 sm:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <LastestMark />
            <span className="font-mono text-[11px] tracking-[0.25em] uppercase font-medium">
              Lastest
            </span>
          </Link>
          <div className="flex items-center gap-5 text-[11px] font-mono tracking-[0.15em] uppercase text-muted-foreground">
            <span className="hidden sm:inline">{scopeLabel} · Ref {slug.slice(0, 6).toUpperCase()}</span>
            <Link
              href={signInLink}
              className="text-foreground hover:text-primary transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 sm:px-8 pb-32">
        {/* Hero */}
        <section className="pt-10 sm:pt-14">
          <div className="flex flex-col gap-6">
            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-muted-foreground">
              File · {formatTimestamp(build.completedAt ?? build.createdAt)}
              {testRun?.gitBranch && (
                <>
                  <span className="mx-2">——</span>
                  branch <span className="text-foreground/80">{testRun.gitBranch}</span>
                </>
              )}
              {testRun?.gitCommit && testRun.gitCommit !== 'unknown' && (
                <>
                  <span className="mx-2">——</span>
                  commit <span className="text-foreground/80">{testRun.gitCommit.slice(0, 7)}</span>
                </>
              )}
            </p>

            <div className="flex items-start gap-5">
              <FaviconOrInitialServer domain={share.targetDomain} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1">
                  Subject of inspection
                </p>
                <h1
                  className="font-[family-name:var(--font-display)] text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] tracking-tight break-words"
                >
                  {displayDomain}
                </h1>
              </div>
            </div>

            {/* Summary rail */}
            <div className="mt-2 border-y border-foreground/15 py-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <Stat label="Tests" value={total} />
              <Stat label="Passed" value={passed} tone="neutral" />
              {changed > 0 && <Stat label="Changed" value={changed} tone="changed" />}
              {failed > 0 && <Stat label="Failed" value={failed} tone="failed" />}
              {flaky > 0 && <Stat label="Flaky" value={flaky} tone="flaky" />}
              <div className="ml-auto font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
                Dossier {slug.slice(0, 8).toUpperCase()}
              </div>
            </div>
          </div>
        </section>

        <ShareViewer
          videos={videos}
          testGroups={clientTestGroups}
          catalog={catalog}
          claimLink={claimLink}
          signInLink={signInLink}
          domain={displayDomain}
        />

        {/* Primary CTA */}
        <section className="mt-14 sm:mt-20 relative overflow-hidden border border-foreground bg-foreground text-background">
          <CornerReticles />
          <div className="relative px-6 sm:px-12 py-10 sm:py-14 grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-5 max-w-lg">
              <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-primary">
                Chain of custody
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-4xl sm:text-5xl leading-[1.02] tracking-tight">
                Take ownership of this specimen.
              </h2>
              <p className="text-background/70 text-[15px] leading-relaxed">
                Sign up free. We&apos;ll clone the test code into your own Lastest workspace —
                you supply the environment, we supply the regression coverage.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <Link
                href={claimLink}
                className="group inline-flex items-center justify-between gap-8 bg-primary text-primary-foreground px-6 py-4 font-mono text-xs tracking-[0.2em] uppercase hover:bg-primary/90 transition-colors"
              >
                <span>Sign up free</span>
                <ArrowIcon />
              </Link>
              <Link
                href={signInLink}
                className="inline-flex items-center justify-center gap-2 border border-background/25 text-background/90 px-6 py-3 font-mono text-[11px] tracking-[0.2em] uppercase hover:bg-background/10 transition-colors"
              >
                Already have an account
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-foreground/10 flex flex-wrap items-center gap-x-5 gap-y-2 justify-between font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          <span>Dossier generated by Lastest</span>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <a
              href={`mailto:abuse@lastest.cloud?subject=Takedown%20request:%20${slug}`}
              className="hover:text-foreground transition-colors"
            >
              Report abuse
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function LastestMark() {
  // Real Lastest logo from /public. Use light svg with a dark-mode override via <picture>.
  return (
    <span className="relative inline-flex items-center justify-center w-6 h-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-light.svg"
        alt=""
        width={24}
        height={24}
        className="block dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-dark.svg"
        alt=""
        width={24}
        height={24}
        className="hidden dark:block"
      />
    </span>
  );
}

// Server-rendered version of the favicon tile. The client version in the
// viewer handles onError fallbacks — at this point we can't know which, so we
// default to the favicon and let a client fallback upgrade it gracefully.
function FaviconOrInitialServer({ domain }: { domain: string | null }) {
  const letter = (domain ?? '?').charAt(0).toUpperCase();
  return (
    <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 border border-foreground/15 bg-card flex items-center justify-center overflow-hidden">
      {/* Letter tile is always rendered; favicon covers it when it loads. */}
      <span className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl text-foreground/80">
        {letter}
      </span>
      {domain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
          alt=""
          width={80}
          height={80}
          className="absolute inset-0 w-full h-full object-contain p-2.5"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'neutral' | 'changed' | 'failed' | 'flaky';
}) {
  const toneClass = {
    default: 'text-foreground',
    neutral: 'text-foreground',
    changed: 'text-amber-600',
    failed: 'text-red-600',
    flaky: 'text-amber-700',
  }[tone];
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-mono tabular-nums text-2xl ${toneClass}`}>
        {String(value).padStart(2, '0')}
      </span>
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function CornerReticles() {
  const cls =
    'absolute w-3 h-3 pointer-events-none border-primary';
  return (
    <>
      <span className={`${cls} top-2 left-2 border-t border-l`} aria-hidden />
      <span className={`${cls} top-2 right-2 border-t border-r`} aria-hidden />
      <span className={`${cls} bottom-2 left-2 border-b border-l`} aria-hidden />
      <span className={`${cls} bottom-2 right-2 border-b border-r`} aria-hidden />
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" fill="none" className="transition-transform group-hover:translate-x-0.5">
      <path d="M0 5H17M17 5L13 1M17 5L13 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
