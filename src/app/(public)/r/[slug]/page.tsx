import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckCircle, XCircle, AlertTriangle, FileCheck2 } from 'lucide-react';
import {
  getPublicShareContext,
  getShareDataBySlug,
  incrementPublicShareView,
  type ShareVisualDiff,
} from '@/lib/db/queries/public-shares';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';
import { ShareViewer } from './share-viewer-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

  // View counter runs once per ISR regeneration (revalidate = 60s). Rough
  // count rather than per-visit, but good enough for a share link — the
  // alternative (a dedicated POST endpoint hit via beacon) forced a separate
  // cold-compile under /api/share/[slug]/ that tripped the dev-server.
  await incrementPublicShareView(slug);

  const { share, build, test, testRun, diffs, results: scopedResults } = data;

  // Public share media piggybacks on the authenticated /api/media/[...path]
  // route via the existing /screenshots /videos /diffs /baselines rewrites
  // (next.config.ts). The `?share=<slug>` query authorizes access without
  // needing a session. This keeps every share request on a route the dev
  // server already has warm, so no dynamic [slug] route ever cold-compiles.
  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const normalized = p.startsWith('/') ? p : `/${p}`;
    return `${normalized}?share=${slug}`;
  };

  // Group diffs by test
  const byTest = new Map<string, { testId: string; testName: string; diffs: ShareVisualDiff[] }>();
  for (const d of diffs) {
    if (!byTest.has(d.testId)) {
      byTest.set(d.testId, {
        testId: d.testId,
        testName: d.testName || test?.name || 'Unnamed test',
        diffs: [],
      });
    }
    byTest.get(d.testId)!.diffs.push(d);
  }

  function diffTier(d: ShareVisualDiff): number {
    if (d.testResultStatus === 'failed' || d.status === 'rejected') return 0;
    if (d.classification === 'changed' || (d.pixelDifference ?? 0) > 0) return 1;
    return 2;
  }
  function hasChange(d: ShareVisualDiff): boolean {
    return diffTier(d) < 2;
  }

  const testGroups = Array.from(byTest.values())
    .map((g) => {
      const changed = g.diffs.filter(hasChange);
      return {
        ...g,
        diffs: changed.slice().sort((a, b) => {
          const t = diffTier(a) - diffTier(b);
          if (t !== 0) return t;
          return (b.pixelDifference ?? 0) - (a.pixelDifference ?? 0);
        }),
        severity: changed.length > 0 ? Math.min(...changed.map(diffTier)) : 2,
      };
    })
    .filter((g) => g.diffs.length > 0)
    .sort((a, b) => a.severity - b.severity || a.testName.localeCompare(b.testName));

  // Screenshot catalog (deduped)
  const catalog: Array<{ src: string; label: string; testName: string }> = [];
  const seen = new Set<string>();
  for (const r of scopedResults) {
    const thisTestName = test?.name ?? 'capture';
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

  // Videos
  const videos: Array<{ src: string; testName: string; durationMs: number | null }> = [];
  for (const r of scopedResults) {
    if (!r.videoPath) continue;
    videos.push({
      src: toUrl(r.videoPath)!,
      testName: test?.name || 'Recording',
      durationMs: r.durationMs ?? null,
    });
  }

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
  const passed = share.testId
    ? scopedResults.filter((r) => r.status === 'passed').length
    : build.passedCount ?? 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b sticky top-0 z-20 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <LastestMark />
            <span>Lastest</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={signInLink}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
            <Button asChild size="sm">
              <Link href={claimLink}>Sign up free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10 space-y-8 pb-32 sm:pb-10">
        {/* Hero */}
        <section className="flex flex-col sm:flex-row sm:items-start gap-4">
          <FaviconTile domain={share.targetDomain} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">We visually tested</p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight break-words">
              {displayDomain}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {testRun?.gitBranch && (
                <span className="font-mono">{testRun.gitBranch}</span>
              )}
              {testRun?.gitCommit && testRun.gitCommit !== 'unknown' && (
                <>
                  <span>·</span>
                  <span className="font-mono">{testRun.gitCommit.slice(0, 7)}</span>
                </>
              )}
              {build.completedAt && (
                <>
                  <span>·</span>
                  <span>{formatTimeAgo(build.completedAt)}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <SummaryBadge label="Tests" value={total} />
              {passed > 0 && (
                <SummaryBadge
                  label="Passed"
                  value={passed}
                  icon={<CheckCircle className="w-3 h-3" />}
                  tone="success"
                />
              )}
              {changed > 0 && (
                <SummaryBadge
                  label="Changed"
                  value={changed}
                  icon={<AlertTriangle className="w-3 h-3" />}
                  tone="warning"
                />
              )}
              {failed > 0 && (
                <SummaryBadge
                  label="Failed"
                  value={failed}
                  icon={<XCircle className="w-3 h-3" />}
                  tone="danger"
                />
              )}
              {flaky > 0 && <SummaryBadge label="Flaky" value={flaky} tone="warning" />}
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
          totals={{ total, passed, changed, failed }}
        />

        {/* Primary CTA card */}
        <section className="rounded-xl border bg-primary/5 border-primary/30 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <FileCheck2 className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-primary uppercase tracking-wide">
                Ready to own this test
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold">Sign up and claim it — free</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">
              We&apos;ll copy the test into your own Lastest workspace. You supply the environment,
              we supply the regression coverage.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button asChild size="lg">
              <Link href={claimLink}>Sign up free</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={signInLink}>Sign in</Link>
            </Button>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-6 border-t text-xs text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 justify-between">
          <span>Run by Lastest · Shared {formatTimeAgo(share.createdAt)}</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
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

function LastestMark() {
  return (
    <span className="relative inline-flex items-center justify-center w-7 h-7 rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-light.svg" alt="" width={28} height={28} className="block dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-dark.svg" alt="" width={28} height={28} className="hidden dark:block" />
    </span>
  );
}

function FaviconTile({ domain }: { domain: string | null }) {
  const letter = (domain ?? '?').charAt(0).toUpperCase();
  return (
    <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-xl border bg-card shadow-sm flex items-center justify-center overflow-hidden">
      <span className="text-2xl font-semibold text-muted-foreground">{letter}</span>
      {domain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
          alt=""
          width={64}
          height={64}
          className="absolute inset-0 w-full h-full object-contain p-2"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </div>
  );
}

function SummaryBadge({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}) {
  if (tone === 'default') {
    return (
      <Badge variant="secondary" className="gap-1.5">
        {icon}
        <span className="tabular-nums">{value}</span>
        <span className="text-muted-foreground font-normal">{label}</span>
      </Badge>
    );
  }
  const cls = {
    success: 'bg-green-50 text-green-700 border-green-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
  }[tone];
  return (
    <Badge variant="outline" className={`${cls} gap-1.5`}>
      {icon}
      <span className="tabular-nums">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </Badge>
  );
}
