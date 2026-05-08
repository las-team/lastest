import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import {
  getPublicShareContext,
  getShareDataBySlug,
  getActiveBaselinesForTest,
  type PublicShareContext,
  type ShareVisualDiff,
  type ShareTestResult,
} from '@/lib/db/queries/public-shares';
import type { Baseline } from '@/lib/db/schema';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';
import { resolveTestVideoUrl } from '@/lib/share/video-fallback';
import { ShareVideoPlayer } from './share-video-player';

// Dynamic — share content is live and render is cheap (pure server HTML).
export const revalidate = 0;

type Build = PublicShareContext['build'];

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
    twitter: { card: 'summary', title, description },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const data = await getShareDataBySlug(slug);
  if (!data) notFound();

  const { share, build, test, testRun, diffs, results: scopedResults } = data;

  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const rel = p.replace(/^\/+/, '');
    return `/share/${slug}/${rel}`;
  };

  const displayDomain = share.targetDomain || test?.name || 'this site';
  const claimLink = `/register?claim=${slug}`;
  const signInLink = `/login?claim=${slug}`;

  const isTestShare = !!share.testId;

  // Executor sometimes omits video_path even when a .webm exists. Scan disk
  // under storage/videos/<repositoryId>/ for a file ending in `-<testId>.webm`.
  const fallbackVideoUrl = isTestShare
    ? await resolveTestVideoUrl(share.repositoryId, share.testId)
    : null;

  const shareUrl = buildShareUrl(slug);
  const primaryResult: ShareTestResult | null = isTestShare
    ? (scopedResults.find((r) => r.testId === share.testId) ?? scopedResults[0] ?? null)
    : null;

  const totalPixelsChanged = diffs.reduce((sum, d) => sum + (d.pixelDifference ?? 0), 0);

  // Passing tests produce zero visual_diffs rows. Fall back to the test's
  // active baselines so viewers still see a side-by-side comparison rather
  // than an empty "recording + steps" block.
  const baselineFallback: Baseline[] =
    isTestShare && share.testId && diffs.length === 0
      ? await getActiveBaselinesForTest(share.testId)
      : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShareHeader signInLink={signInLink} claimLink={claimLink} />

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-8">
        <OutcomeHeader
          variant={isTestShare ? 'test' : 'build'}
          domain={displayDomain}
          targetDomain={share.targetDomain}
          testName={isTestShare ? test?.name ?? null : null}
          build={build}
          testResult={primaryResult}
          pixelsChanged={totalPixelsChanged}
          branch={testRun?.gitBranch ?? null}
          commit={testRun?.gitCommit ?? null}
        />

        {isTestShare ? (
          <TestShareBody
            diffs={diffs}
            results={scopedResults}
            toUrl={toUrl}
            fallbackVideoUrl={fallbackVideoUrl}
            build={build}
            testResult={primaryResult}
            shareUrl={shareUrl}
            testName={test?.name ?? displayDomain}
            pixelsChanged={totalPixelsChanged}
            baselineFallback={baselineFallback}
          />
        ) : (
          <>
            <BuildSummary
              build={build}
              targetDomain={share.targetDomain}
              branch={testRun?.gitBranch ?? null}
            />
            <BuildDiffsGallery diffs={diffs} results={scopedResults} toUrl={toUrl} />
          </>
        )}

        <ClaimCTA claimLink={claimLink} signInLink={signInLink} />

        <ShareFooter slug={slug} />
      </main>

      {/* Server-emitted inline style + script: idle/active slider toggling and
          pointer-driven reveal for the diff sliders. Zero hydration cost. The
          video player is a separate React client island (see ShareVideoPlayer)
          which owns playback rate, scrubbing, and step-seek wiring. */}
      <style dangerouslySetInnerHTML={{ __html: SHARE_STYLE }} />
      <script
        dangerouslySetInnerHTML={{
          __html: SHARE_SCRIPT,
        }}
      />
    </div>
  );
}

// --- sub-components ---------------------------------------------------------

function ShareHeader({
  signInLink,
  claimLink,
}: {
  signInLink: string;
  claimLink: string;
}) {
  return (
    <header className="border-b">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="flex items-center gap-2 font-semibold">
          <LastestLogo />
          <span>Lastest</span>
        </a>
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
  );
}

function LastestLogo() {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-light.svg"
        alt=""
        width={28}
        height={28}
        className="block dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-dark.svg"
        alt=""
        width={28}
        height={28}
        className="hidden dark:block"
      />
    </span>
  );
}

type Verdict = {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
};

function buildVerdict(status: string | null | undefined): Verdict {
  switch (status) {
    case 'safe_to_merge':
      return { label: 'Safe to merge', tone: 'ok' };
    case 'review_required':
      return { label: 'Review required', tone: 'warn' };
    case 'blocked':
      return { label: 'Blocked', tone: 'danger' };
    default:
      return { label: status ? humanize(status) : 'Run complete', tone: 'neutral' };
  }
}

function testVerdict(status: string | null | undefined): Verdict {
  switch (status) {
    case 'passed':
    case 'approved':
      return { label: 'Passed', tone: 'ok' };
    case 'failed':
    case 'regression':
      return { label: 'Failed', tone: 'danger' };
    case 'changed':
    case 'pending_review':
      return { label: 'Changed', tone: 'warn' };
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral' };
    default:
      return { label: status ? humanize(status) : 'Run complete', tone: 'neutral' };
  }
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function toneClasses(tone: Verdict['tone']): {
  card: string;
  pill: string;
  title: string;
} {
  switch (tone) {
    case 'ok':
      return {
        card: 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900',
        pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
        title: 'text-emerald-900 dark:text-emerald-100',
      };
    case 'warn':
      return {
        card: 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900',
        pill: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
        title: 'text-amber-900 dark:text-amber-100',
      };
    case 'danger':
      return {
        card: 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-900',
        pill: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
        title: 'text-rose-900 dark:text-rose-100',
      };
    default:
      return {
        card: 'border bg-muted/40',
        pill: 'bg-muted text-foreground',
        title: 'text-foreground',
      };
  }
}

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function OutcomeHeader({
  variant,
  domain,
  targetDomain,
  testName,
  build,
  testResult,
  pixelsChanged,
  branch,
  commit,
}: {
  variant: 'build' | 'test';
  domain: string;
  targetDomain: string | null;
  testName: string | null;
  build: Build;
  testResult: ShareTestResult | null;
  pixelsChanged: number;
  branch: string | null;
  commit: string | null;
}) {
  const verdict =
    variant === 'test'
      ? testVerdict(testResult?.status ?? null)
      : buildVerdict(build.overallStatus);
  const tone = toneClasses(verdict.tone);

  const title = variant === 'test' ? (testName ?? domain) : domain;

  const metaBits: string[] = [];
  if (variant === 'build') {
    const total = build.totalTests ?? 0;
    if (total > 0) metaBits.push(`${total} test${total === 1 ? '' : 's'}`);
    if (branch) metaBits.push(branch);
    if (commit && commit !== 'unknown') metaBits.push(commit.slice(0, 7));
    const dur = formatDuration(build.elapsedMs);
    if (dur) metaBits.push(dur);
  } else {
    const dur = testResult?.durationMs;
    if (dur != null) metaBits.push(`${dur.toLocaleString()} ms`);
    metaBits.push(
      pixelsChanged > 0
        ? `${pixelsChanged.toLocaleString()} pixels changed`
        : '0 pixels changed · matches baseline',
    );
  }

  const shortCommit =
    commit && commit !== 'unknown' ? commit.slice(0, 7).toUpperCase() : null;

  return (
    <section className={`rounded-xl border p-5 sm:p-6 ${tone.card}`}>
      <div className="flex items-start gap-4">
        <CustomerFavicon domain={targetDomain} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone.pill}`}
            >
              {verdict.label}
              {verdict.tone === 'ok' ? ' ✓' : ''}
            </span>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {variant === 'test' ? 'Test recording' : 'Build summary'}
            </p>
          </div>
          <h1
            className={`text-2xl sm:text-3xl font-semibold tracking-tight break-words ${tone.title}`}
          >
            {title}
          </h1>
          {metaBits.length > 0 && (
            <p className="text-sm text-muted-foreground font-mono break-words">
              {metaBits.join(' · ')}
            </p>
          )}
        </div>
        {shortCommit && (
          <div className="hidden sm:flex flex-col items-end shrink-0 text-right">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {variant === 'test' ? 'Run' : 'Build'}
            </span>
            <span className="text-sm font-mono">{shortCommit}</span>
            {branch && (
              <span className="text-xs font-mono text-muted-foreground">{branch}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CustomerFavicon({ domain }: { domain: string | null }) {
  const letter = (domain ?? '?').charAt(0).toUpperCase();
  return (
    <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-lg border bg-card shadow-sm flex items-center justify-center overflow-hidden">
      <span className="text-xl font-semibold text-muted-foreground">{letter}</span>
      {domain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          width={56}
          height={56}
          className="absolute inset-0 w-full h-full object-contain p-1.5"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </div>
  );
}

// --- Build share: tick bar + stat grid + diffs ------------------------------

function BuildSummary({
  build,
  targetDomain,
  branch,
}: {
  build: Build;
  targetDomain: string | null;
  branch: string | null;
}) {
  const total = build.totalTests ?? 0;
  const passed = build.passedCount ?? 0;
  const failed = build.failedCount ?? 0;
  const changed = build.changesDetected ?? 0;
  const pending = Math.max(0, total - passed - failed - changed);
  const a11y = build.a11yScore;

  const configBits: string[] = [];
  if (build.triggerType) configBits.push(humanize(build.triggerType));
  if (branch) configBits.push(branch);
  if (targetDomain) configBits.push(`→ ${targetDomain}`);
  if (total > 0) configBits.push(`${total} test${total === 1 ? '' : 's'}`);

  return (
    <section className="space-y-4">
      {configBits.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
          {configBits.join(' · ')}
        </div>
      )}

      <TickBar total={total} passed={passed} failed={failed} changed={changed} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard value={passed} label="Passed" tone="ok" />
        <StatCard value={failed} label="Failed" tone="danger" />
        <StatCard value={changed} label="Changed" tone="warn" />
        <StatCard
          value={a11y == null ? '—' : a11y}
          label="A11y"
          sublabel={a11y == null ? undefined : 'WCAG 2.2'}
          tone="neutral"
        />
      </div>

      {pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending} test{pending === 1 ? '' : 's'} did not report a status.
        </p>
      )}
    </section>
  );
}

function TickBar({
  total,
  passed,
  failed,
  changed,
}: {
  total: number;
  passed: number;
  failed: number;
  changed: number;
}) {
  if (total <= 0) return null;
  // Cap visible ticks so very large builds still read.
  const visible = Math.min(total, 120);
  const scale = visible / total;
  const pOk = Math.round(passed * scale);
  const pFail = Math.round(failed * scale);
  const pChg = Math.round(changed * scale);
  const pNone = Math.max(0, visible - pOk - pFail - pChg);
  const cells: Array<'ok' | 'fail' | 'chg' | 'none'> = [
    ...Array(pOk).fill('ok' as const),
    ...Array(pChg).fill('chg' as const),
    ...Array(pFail).fill('fail' as const),
    ...Array(pNone).fill('none' as const),
  ];
  return (
    <div
      className="flex h-4 w-full overflow-hidden rounded border bg-muted"
      role="img"
      aria-label={`${passed} passed, ${changed} changed, ${failed} failed, of ${total}`}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          className={`flex-1 border-r border-background last:border-r-0 ${
            c === 'ok'
              ? 'bg-emerald-500/80'
              : c === 'fail'
                ? 'bg-rose-500/80'
                : c === 'chg'
                  ? 'bg-amber-500/80'
                  : ''
          }`}
        />
      ))}
    </div>
  );
}

function StatCard({
  value,
  label,
  sublabel,
  tone,
}: {
  value: number | string;
  label: string;
  sublabel?: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  const color =
    tone === 'ok'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'danger'
        ? 'text-rose-700 dark:text-rose-300'
        : tone === 'warn'
          ? 'text-amber-700 dark:text-amber-300'
          : 'text-foreground';
  return (
    <div className="rounded-md border bg-card p-3 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground mt-0.5">
        {label}
      </div>
      {sublabel && (
        <div className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}

// Diffs + gallery for build-scoped shares (no video, no step strip).
function BuildDiffsGallery({
  diffs,
  results,
  toUrl,
}: {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  toUrl: (p: string | null | undefined) => string | null;
}) {
  const sliderDiffs = buildSliderDiffs(diffs, toUrl);
  const gallery = buildGallery(diffs, results, toUrl, new Set<string>());

  if (sliderDiffs.length === 0 && gallery.length === 0) return null;

  return (
    <>
      {sliderDiffs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {sliderDiffs.length === 1
              ? 'Visual change'
              : `${sliderDiffs.length} visual changes`}
          </h2>
          {sliderDiffs.map((d) => (
            <DiffSlider
              key={d.id}
              baseline={d.baseline}
              current={d.current}
              diff={d.diff}
              stepLabel={d.stepLabel}
              pixelDifference={d.pixelDifference}
            />
          ))}
        </section>
      )}

      {gallery.length > 0 && (
        <GallerySection items={gallery} />
      )}
    </>
  );
}

// --- Test share: video + step strip + stats + pull quote + diffs + socials --

function TestShareBody({
  diffs,
  results,
  toUrl,
  fallbackVideoUrl,
  build,
  testResult,
  shareUrl,
  testName,
  pixelsChanged,
  baselineFallback,
}: {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  toUrl: (p: string | null | undefined) => string | null;
  fallbackVideoUrl: string | null;
  build: Build;
  testResult: ShareTestResult | null;
  shareUrl: string;
  testName: string;
  pixelsChanged: number;
  baselineFallback: Baseline[];
}) {
  const videos = results
    .map((r) => (r.videoPath ? toUrl(r.videoPath) : null))
    .filter((v): v is string => !!v);

  if (videos.length === 0 && fallbackVideoUrl) {
    videos.push(fallbackVideoUrl);
  }

  const steps = collectSteps(testResult, results, toUrl);
  const stepPaths = new Set<string>(
    collectStepPaths(testResult, results),
  );

  const durationMs = testResult?.durationMs ?? null;
  const approxSecPerStep =
    steps.length > 0 && durationMs && durationMs > 0
      ? durationMs / 1000 / steps.length
      : null;

  const sliderDiffs = buildSliderDiffs(diffs, toUrl);
  const passedSliders =
    sliderDiffs.length === 0
      ? buildBaselineSliders(baselineFallback, testResult, toUrl)
      : [];
  const gallery = buildGallery(diffs, results, toUrl, stepPaths);

  const pullQuote =
    pixelsChanged > 0
      ? `${pixelsChanged.toLocaleString()} pixels changed — review before ship.`
      : durationMs
        ? `Recorded once. Ran in ${durationMs.toLocaleString()} ms. Zero regressions.`
        : 'Recorded once. Runs on every build. Zero regressions.';

  return (
    <>
      {videos.length > 0 && (
        <section className="space-y-3">
          <ShareVideoPlayer sources={videos} />
        </section>
      )}

      {steps.length > 0 && (
        <StepStrip steps={steps} secPerStep={approxSecPerStep} />
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard
          value={pixelsChanged > 0 ? pixelsChanged.toLocaleString() : '0'}
          label="Diff px"
          tone={pixelsChanged > 0 ? 'warn' : 'ok'}
        />
        <StatCard
          value={durationMs != null ? formatDuration(durationMs) ?? `${durationMs}` : '—'}
          label="Duration"
          tone="neutral"
        />
        <StatCard
          value={build.a11yScore == null ? '—' : build.a11yScore}
          label="A11y"
          sublabel={build.a11yScore == null ? undefined : 'WCAG 2.2'}
          tone="neutral"
        />
      </div>

      <PullQuote text={pullQuote} />

      {sliderDiffs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {sliderDiffs.length === 1
              ? 'Visual change'
              : `${sliderDiffs.length} visual changes`}
          </h2>
          {sliderDiffs.map((d) => (
            <DiffSlider
              key={d.id}
              baseline={d.baseline}
              current={d.current}
              diff={d.diff}
              stepLabel={d.stepLabel}
              pixelDifference={d.pixelDifference}
            />
          ))}
        </section>
      )}

      {sliderDiffs.length === 0 && passedSliders.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {passedSliders.length === 1
              ? 'Tested view'
              : `${passedSliders.length} tested views`}
            <span className="ml-2 text-xs font-normal text-emerald-700 dark:text-emerald-300">
              matches baseline
            </span>
          </h2>
          {passedSliders.map((d) => (
            <DiffSlider
              key={d.id}
              baseline={d.baseline}
              current={d.current}
              diff={d.diff}
              stepLabel={d.stepLabel}
              pixelDifference={d.pixelDifference}
            />
          ))}
        </section>
      )}

      {gallery.length > 0 && <GallerySection items={gallery} />}

      <SocialShareRow shareUrl={shareUrl} testName={testName} />
    </>
  );
}

type Step = { src: string; label: string };

function collectStepPaths(
  primary: ShareTestResult | null,
  all: ShareTestResult[],
): string[] {
  const seen: string[] = [];
  const source = primary ?? all[0] ?? null;
  if (!source) return seen;
  if (source.screenshotPath) seen.push(source.screenshotPath);
  for (const s of source.screenshots ?? []) {
    if (s.path) seen.push(s.path);
  }
  return seen;
}

function collectSteps(
  primary: ShareTestResult | null,
  all: ShareTestResult[],
  toUrl: (p: string | null | undefined) => string | null,
): Step[] {
  const source = primary ?? all[0] ?? null;
  if (!source) return [];
  const out: Step[] = [];
  const seen = new Set<string>();
  const captured = source.screenshots ?? [];
  for (const s of captured) {
    if (!s.path || seen.has(s.path)) continue;
    seen.add(s.path);
    const url = toUrl(s.path);
    if (!url) continue;
    out.push({ src: url, label: s.label || `Step ${out.length + 1}` });
  }
  if (source.screenshotPath && !seen.has(source.screenshotPath)) {
    const url = toUrl(source.screenshotPath);
    if (url) out.push({ src: url, label: 'Final' });
  }
  return out;
}

function StepStrip({
  steps,
  secPerStep,
}: {
  steps: Step[];
  secPerStep: number | null;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        {steps.length} step{steps.length === 1 ? '' : 's'} captured
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {steps.map((s, i) => {
          const seek =
            secPerStep != null ? (i * secPerStep).toFixed(2) : undefined;
          return (
            <button
              type="button"
              key={s.src + i}
              data-seek={seek}
              className="group relative shrink-0 w-28 rounded-md border bg-card p-1 text-left hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label={`Jump to step ${i + 1}: ${s.label}`}
            >
              <div className="relative aspect-[4/3] rounded-sm bg-muted overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover object-top"
                />
                <span className="absolute top-1 left-1 rounded bg-background/85 px-1 text-[10px] font-mono border">
                  {i + 1}
                </span>
              </div>
              <div
                className="mt-1 text-[11px] truncate text-muted-foreground group-hover:text-foreground"
                title={s.label}
              >
                {s.label}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PullQuote({ text }: { text: string }) {
  return (
    <section className="rounded-xl border bg-muted/40 px-6 py-5 text-center">
      <p className="text-lg sm:text-xl font-medium tracking-tight italic">
        &ldquo;{text}&rdquo;
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Built with Lastest — open-source visual regression testing.
      </p>
    </section>
  );
}

function SocialShareRow({
  shareUrl,
  testName,
}: {
  shareUrl: string;
  testName: string;
}) {
  const text = `Visual regression test for ${testName} — ran on Lastest.`;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    text,
  )}&url=${encodeURIComponent(shareUrl)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    shareUrl,
  )}`;
  return (
    <section className="flex flex-wrap items-center gap-2 pt-2 border-t">
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
        Share
      </span>
      <a
        href={tweet}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Post to X
      </a>
      <a
        href={linkedin}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Share on LinkedIn
      </a>
      <a
        href={shareUrl}
        className="inline-flex items-center rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Copy link
      </a>
    </section>
  );
}

// --- diff + gallery helpers (shared between build and test modes) -----------

type SliderDiff = {
  id: string;
  baseline: string;
  current: string;
  diff: string | null;
  stepLabel: string | null;
  pixelDifference: number;
};

// For passing tests — no visual_diffs rows exist, so synthesize sliders from
// active baselines paired with captured screenshots. Match by stepLabel
// (with 'final' falling back to the result's primary screenshotPath).
function buildBaselineSliders(
  baselines: Baseline[],
  result: ShareTestResult | null,
  toUrl: (p: string | null | undefined) => string | null,
): SliderDiff[] {
  if (!result) return [];
  const steps = result.screenshots ?? [];
  const out: SliderDiff[] = [];
  const seen = new Set<string>();
  for (const bl of baselines) {
    const baselineUrl = toUrl(bl.imagePath);
    if (!baselineUrl) continue;
    const label = (bl.stepLabel ?? '').trim();
    const isFinal = !label || label.toLowerCase() === 'final';
    let currentPath: string | null = null;
    if (isFinal) {
      currentPath = result.screenshotPath;
    } else {
      const match = steps.find(
        (s) => (s.label ?? '').trim() === label,
      );
      currentPath = match?.path ?? null;
    }
    if (!currentPath) continue;
    const key = `${bl.imagePath}|${currentPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const currentUrl = toUrl(currentPath);
    if (!currentUrl) continue;
    out.push({
      id: bl.id,
      baseline: baselineUrl,
      current: currentUrl,
      diff: null,
      stepLabel: bl.stepLabel ?? (isFinal ? 'Final' : null),
      pixelDifference: 0,
    });
  }
  return out;
}

function buildSliderDiffs(
  diffs: ShareVisualDiff[],
  toUrl: (p: string | null | undefined) => string | null,
): SliderDiff[] {
  return diffs
    .map((d) => {
      const baseline = toUrl(d.baselineImagePath);
      const current = toUrl(d.currentImagePath);
      if (!baseline || !current) return null;
      return {
        id: d.id,
        baseline,
        current,
        diff: toUrl(d.diffImagePath),
        stepLabel: d.stepLabel,
        pixelDifference: d.pixelDifference ?? 0,
      };
    })
    .filter((d): d is SliderDiff => !!d);
}

type GalleryItem = { src: string; label: string };

function buildGallery(
  diffs: ShareVisualDiff[],
  results: ShareTestResult[],
  toUrl: (p: string | null | undefined) => string | null,
  alreadyShown: Set<string>,
): GalleryItem[] {
  const shownPaths = new Set<string>(alreadyShown);
  for (const d of diffs) {
    if (d.baselineImagePath) shownPaths.add(d.baselineImagePath);
    if (d.currentImagePath) shownPaths.add(d.currentImagePath);
  }
  const gallery: GalleryItem[] = [];
  const seenGallery = new Set<string>();
  for (const r of results) {
    if (
      r.screenshotPath &&
      !shownPaths.has(r.screenshotPath) &&
      !seenGallery.has(r.screenshotPath)
    ) {
      seenGallery.add(r.screenshotPath);
      const url = toUrl(r.screenshotPath);
      if (url) gallery.push({ src: url, label: 'Primary' });
    }
    const captured = r.screenshots ?? [];
    for (const s of captured) {
      if (!s.path || shownPaths.has(s.path) || seenGallery.has(s.path)) continue;
      seenGallery.add(s.path);
      const url = toUrl(s.path);
      if (url) gallery.push({ src: url, label: s.label || 'Step' });
    }
  }
  return gallery;
}

function GallerySection({ items }: { items: GalleryItem[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        {items.length === 1 ? 'Screenshot' : `${items.length} screenshots`}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((g, i) => (
          <figure key={i} className="space-y-1.5">
            <div className="relative aspect-[4/3] rounded-md border bg-muted overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.src}
                alt={g.label}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover object-top"
              />
            </div>
            <figcaption className="text-xs text-muted-foreground truncate">
              {g.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function DiffSlider({
  baseline,
  current,
  diff,
  stepLabel,
  pixelDifference,
}: {
  baseline: string;
  current: string;
  diff: string | null;
  stepLabel: string | null;
  pixelDifference: number;
}) {
  // CSS custom property starts at 50 %. The inline <script> (emitted once at
  // page bottom) binds pointer move on .share-slider-stage to this variable
  // and flips data-active between 'false' (diff overlay visible) and 'true'
  // (baseline/current slider comparison revealed). Pure DOM, zero hydration.
  const style = { '--pct': '50%' } as CSSProperties;
  const hasDiff = !!diff;
  return (
    <figure
      className="share-slider space-y-2"
      style={style}
      data-active={hasDiff ? 'false' : 'true'}
      data-has-diff={hasDiff ? 'true' : 'false'}
    >
      <header className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground truncate">
          {stepLabel || 'Visual diff'}
        </span>
        {pixelDifference > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {pixelDifference.toLocaleString()} px changed
          </span>
        )}
      </header>
      <div
        className="share-slider-stage relative rounded-md border bg-muted overflow-hidden touch-none select-none data-[active=true]:cursor-ew-resize"
        tabIndex={0}
        role="slider"
        aria-label="Compare before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={50}
      >
        {/* Baseline fills the frame and sets height. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseline}
          alt="Before"
          draggable={false}
          className="block w-full h-auto select-none pointer-events-none"
        />
        {/* Current overlays baseline, revealed from the left edge to --pct.
            Hidden while the stage is idle (data-active=false). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current}
          alt="After"
          draggable={false}
          className="share-slider-current absolute inset-0 w-full h-full object-cover object-top select-none pointer-events-none transition-opacity duration-150"
          style={{ clipPath: 'inset(0 calc(100% - var(--pct, 50%)) 0 0)' }}
        />
        {/* Diff heat-map overlay — the idle view. Hidden once the slider
            becomes active. */}
        {hasDiff && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={diff}
            alt="Diff"
            draggable={false}
            className="share-slider-diff absolute inset-0 w-full h-full object-cover object-top select-none pointer-events-none transition-opacity duration-150"
          />
        )}
        {/* Divider + drag handle — only visible while active. */}
        <div
          className="share-slider-divider absolute top-0 bottom-0 w-px bg-primary pointer-events-none transition-opacity duration-150"
          style={{ left: 'var(--pct, 50%)' }}
          aria-hidden
        >
          <div className="share-slider-handle absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-primary bg-background shadow flex items-center justify-center text-primary text-xs font-bold">
            ⇔
          </div>
        </div>
        <span className="share-slider-label-before absolute top-2 left-2 rounded bg-background/85 px-2 py-0.5 text-[11px] font-medium border transition-opacity duration-150">
          Before
        </span>
        <span className="share-slider-label-after absolute top-2 right-2 rounded bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-medium transition-opacity duration-150">
          After
        </span>
        {hasDiff && (
          <span className="share-slider-label-diff absolute top-2 right-2 rounded bg-rose-500 text-white px-2 py-0.5 text-[11px] font-medium transition-opacity duration-150">
            Changes
          </span>
        )}
        {hasDiff && (
          <span className="share-slider-hint absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-background/85 px-2 py-0.5 text-[11px] font-medium border pointer-events-none transition-opacity duration-150">
            Hover to compare
          </span>
        )}
      </div>
    </figure>
  );
}

function ClaimCTA({
  claimLink,
  signInLink,
}: {
  claimLink: string;
  signInLink: string;
}) {
  return (
    <section className="rounded-xl border bg-muted/40 p-6 sm:p-8 space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">Claim this test — free</h2>
      <p className="text-sm text-muted-foreground">
        We&apos;ll copy the test into your own Lastest workspace. You supply the ideas,
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
  );
}

function ShareFooter({ slug }: { slug: string }) {
  return (
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
  );
}

const SHARE_STYLE = `
.share-slider .share-slider-current,
.share-slider .share-slider-divider,
.share-slider .share-slider-label-before,
.share-slider .share-slider-label-after,
.share-slider .share-slider-diff,
.share-slider .share-slider-label-diff,
.share-slider .share-slider-hint {
  opacity: 1;
}
.share-slider[data-active="false"] .share-slider-current,
.share-slider[data-active="false"] .share-slider-divider,
.share-slider[data-active="false"] .share-slider-label-before,
.share-slider[data-active="false"] .share-slider-label-after {
  opacity: 0;
}
.share-slider[data-active="true"] .share-slider-diff,
.share-slider[data-active="true"] .share-slider-label-diff,
.share-slider[data-active="true"] .share-slider-hint {
  opacity: 0;
}
.share-slider-stage:focus-visible {
  outline: 2px solid var(--primary, #000);
  outline-offset: 2px;
}
`;

const SHARE_SCRIPT = `
(function(){
  var figs = document.querySelectorAll('.share-slider');
  for (var i = 0; i < figs.length; i++) {
    (function(fig){
      var stage = fig.querySelector('.share-slider-stage');
      if (!stage) return;
      var hasDiff = fig.getAttribute('data-has-diff') === 'true';
      // Track whether pointer is inside the stage so touchmove/leave behave.
      function setPct(clientX) {
        var rect = stage.getBoundingClientRect();
        if (!rect.width) return;
        var x = clientX - rect.left;
        var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        fig.style.setProperty('--pct', pct.toFixed(2) + '%');
        stage.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      function activate() { fig.setAttribute('data-active', 'true'); }
      function deactivate() { if (hasDiff) fig.setAttribute('data-active', 'false'); }
      stage.addEventListener('pointerenter', function(e){
        if (e.pointerType === 'touch') return;
        activate();
        setPct(e.clientX);
      });
      stage.addEventListener('pointerleave', function(e){
        if (e.pointerType === 'touch') return;
        deactivate();
      });
      stage.addEventListener('pointermove', function(e){
        if (fig.getAttribute('data-active') !== 'true') return;
        setPct(e.clientX);
      });
      stage.addEventListener('pointerdown', function(e){
        activate();
        setPct(e.clientX);
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      });
      stage.addEventListener('pointerup', function(e){
        try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
      });
      stage.addEventListener('keydown', function(e){
        var curStr = fig.style.getPropertyValue('--pct') || '50%';
        var cur = parseFloat(curStr) || 50;
        var step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft') {
          activate();
          var n = Math.max(0, cur - step);
          fig.style.setProperty('--pct', n + '%');
          stage.setAttribute('aria-valuenow', String(Math.round(n)));
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          activate();
          var m = Math.min(100, cur + step);
          fig.style.setProperty('--pct', m + '%');
          stage.setAttribute('aria-valuenow', String(Math.round(m)));
          e.preventDefault();
        } else if (e.key === 'Escape') {
          deactivate();
        }
      });
    })(figs[i]);
  }
})();
`;
