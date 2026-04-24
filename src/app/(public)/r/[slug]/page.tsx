import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import {
  getPublicShareContext,
  getShareDataBySlug,
  type ShareVisualDiff,
  type ShareTestResult,
} from '@/lib/db/queries/public-shares';
import { isValidShareSlug, buildShareUrl } from '@/lib/share/slug';
import { resolveTestVideoUrl } from '@/lib/share/video-fallback';

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
    twitter: { card: 'summary', title, description },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const data = await getShareDataBySlug(slug);
  if (!data) notFound();

  const { share, test, testRun, diffs, results: scopedResults } = data;

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShareHeader signInLink={signInLink} claimLink={claimLink} />

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-10">
        <Hero
          domain={displayDomain}
          targetDomain={share.targetDomain}
          testName={isTestShare ? test?.name ?? null : null}
          branch={testRun?.gitBranch ?? null}
          commit={testRun?.gitCommit ?? null}
        />

        {isTestShare ? (
          <TestShareBody
            diffs={diffs}
            results={scopedResults}
            toUrl={toUrl}
            fallbackVideoUrl={fallbackVideoUrl}
          />
        ) : null}

        <ClaimCTA claimLink={claimLink} signInLink={signInLink} />

        <ShareFooter slug={slug} />
      </main>

      {/* Server-emitted inline script: slider wiring + video speed-up.
          Zero hydration cost, no React client boundary, no Turbopack
          client-chunk graph. */}
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

function Hero({
  domain,
  targetDomain,
  testName,
  branch,
  commit,
}: {
  domain: string;
  targetDomain: string | null;
  testName: string | null;
  branch: string | null;
  commit: string | null;
}) {
  return (
    <section className="flex flex-col sm:flex-row sm:items-center gap-4">
      <CustomerFavicon domain={targetDomain} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          We visually tested
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight break-words">
          {domain}
        </h1>
        {(testName || branch || (commit && commit !== 'unknown')) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground pt-1">
            {testName && <span className="truncate">{testName}</span>}
            {testName && branch && <span>·</span>}
            {branch && <span className="font-mono">{branch}</span>}
            {branch && commit && commit !== 'unknown' && <span>·</span>}
            {commit && commit !== 'unknown' && (
              <span className="font-mono">{commit.slice(0, 7)}</span>
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
    <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-xl border bg-card shadow-sm flex items-center justify-center overflow-hidden">
      <span className="text-2xl font-semibold text-muted-foreground">{letter}</span>
      {domain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
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

function TestShareBody({
  diffs,
  results,
  toUrl,
  fallbackVideoUrl,
}: {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  toUrl: (p: string | null | undefined) => string | null;
  fallbackVideoUrl: string | null;
}) {
  const videos = results
    .map((r) => (r.videoPath ? toUrl(r.videoPath) : null))
    .filter((v): v is string => !!v);

  if (videos.length === 0 && fallbackVideoUrl) {
    videos.push(fallbackVideoUrl);
  }

  const sliderDiffs = diffs
    .map((d) => {
      const baseline = toUrl(d.baselineImagePath);
      const current = toUrl(d.currentImagePath);
      if (!baseline || !current) return null;
      return {
        id: d.id,
        baseline,
        current,
        stepLabel: d.stepLabel,
        pixelDifference: d.pixelDifference ?? 0,
      };
    })
    .filter((d): d is NonNullable<typeof d> => !!d);

  // Gallery = screenshots NOT already shown as a slider.
  const shownPaths = new Set<string>();
  for (const d of diffs) {
    if (d.baselineImagePath) shownPaths.add(d.baselineImagePath);
    if (d.currentImagePath) shownPaths.add(d.currentImagePath);
  }
  const gallery: Array<{ src: string; label: string }> = [];
  const seenGallery = new Set<string>();
  for (const r of results) {
    if (r.screenshotPath && !shownPaths.has(r.screenshotPath) && !seenGallery.has(r.screenshotPath)) {
      seenGallery.add(r.screenshotPath);
      const url = toUrl(r.screenshotPath);
      if (url) gallery.push({ src: url, label: 'Primary' });
    }
    const captured = (r.screenshots ?? []) as Array<{ path: string; label?: string }>;
    for (const s of captured) {
      if (!s.path || shownPaths.has(s.path) || seenGallery.has(s.path)) continue;
      seenGallery.add(s.path);
      const url = toUrl(s.path);
      if (url) gallery.push({ src: url, label: s.label || 'Step' });
    }
  }

  return (
    <>
      {videos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Test recording</h2>
          {videos.map((src, i) => (
            <video
              key={i}
              src={src}
              autoPlay
              loop
              muted
              playsInline
              controls
              preload="metadata"
              className="share-video w-full aspect-video rounded-md border bg-black"
            />
          ))}
        </section>
      )}

      {sliderDiffs.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            {sliderDiffs.length === 1 ? 'Visual change' : `${sliderDiffs.length} visual changes`}
          </h2>
          {sliderDiffs.map((d) => (
            <DiffSlider
              key={d.id}
              baseline={d.baseline}
              current={d.current}
              stepLabel={d.stepLabel}
              pixelDifference={d.pixelDifference}
            />
          ))}
        </section>
      )}

      {gallery.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {gallery.length === 1 ? 'Screenshot' : `${gallery.length} screenshots`}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {gallery.map((g, i) => (
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
      )}
    </>
  );
}

function DiffSlider({
  baseline,
  current,
  stepLabel,
  pixelDifference,
}: {
  baseline: string;
  current: string;
  stepLabel: string | null;
  pixelDifference: number;
}) {
  // CSS custom property starts at 50 %. The inline <script> (emitted once at
  // page bottom) wires up every `.share-slider` by binding its <input> to
  // that variable. Pure DOM, no hydration, no client bundle.
  const style = { '--pct': '50%' } as CSSProperties;
  return (
    <figure className="share-slider space-y-2" style={style}>
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
      <div className="share-slider-stage relative rounded-md border bg-muted overflow-hidden">
        {/* Baseline fills the frame and sets height. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseline}
          alt="Before"
          draggable={false}
          className="block w-full h-auto select-none"
        />
        {/* Current overlays baseline, revealed from the left edge to --pct. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current}
          alt="After"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover object-top select-none"
          style={{ clipPath: 'inset(0 calc(100% - var(--pct, 50%)) 0 0)' }}
        />
        <div
          className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
          style={{ left: 'var(--pct, 50%)' }}
          aria-hidden
        />
        <span className="absolute top-2 left-2 rounded bg-background/85 px-2 py-0.5 text-[11px] font-medium border">
          Before
        </span>
        <span className="absolute top-2 right-2 rounded bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-medium">
          After
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        defaultValue={50}
        step={1}
        aria-label="Compare before and after"
        className="share-slider-input block w-full accent-primary"
      />
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

const SHARE_SCRIPT = `
(function(){
  var rows = document.querySelectorAll('.share-slider');
  for (var i = 0; i < rows.length; i++) {
    (function(row){
      var input = row.querySelector('.share-slider-input');
      if (!input) return;
      var apply = function(){ row.style.setProperty('--pct', input.value + '%'); };
      input.addEventListener('input', apply);
      apply();
    })(rows[i]);
  }
  var videos = document.querySelectorAll('video.share-video');
  for (var j = 0; j < videos.length; j++) {
    (function(v){
      var setRate = function(){ try { v.playbackRate = 2; } catch (e) {} };
      setRate();
      v.addEventListener('loadedmetadata', setRate);
      v.addEventListener('play', setRate);
      v.addEventListener('ratechange', function(){
        if (v.playbackRate !== 2 && !v.dataset.userRate) {
          // user may have changed it — respect their choice after first change.
          v.dataset.userRate = '1';
        }
      });
    })(videos[j]);
  }
})();
`;
