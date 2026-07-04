import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import {
  getPublicShareContext,
  getPublicShareStats,
  getShareDataBySlug,
  type PublicShareContext,
  type ShareVisualDiff,
  type ShareTestResult,
  type ShareStepComparison,
} from "@/lib/db/queries/public-shares";
import {
  getBuildDemoNotes,
  getLatestDemoNotesForRepo,
} from "@/lib/db/queries/demo-notes";
import { getRepoAward } from "@/lib/db/queries/awards";
import type {
  DemoNotes,
  DomDiffResult,
  RepoAward,
  WebVitalsSample,
} from "@/lib/db/schema";
import { isValidShareSlug, buildShareUrl } from "@/lib/share/slug";
import { resolveTestVideoUrl } from "@/lib/share/video-fallback";
import { ShareVideoPlayer } from "./share-video-player";
import { AwardBadgeRow } from "@/components/awards/award-badge-row";
import { MobileDiffGallery } from "@/components/diff/mobile-diff-gallery-client";
import { ChapterRail, type Chapter } from "@/components/share/chapter-rail";
import { DomOverlay } from "@/components/share/dom-overlay-client";
import {
  SocialShareKit,
  type ShareSlide,
} from "@/components/share/social-share-kit-client";
import { buildSocialCopy } from "@/lib/share/social-copy";

// Dynamic — share content is live and render is cheap (pure server HTML).
export const revalidate = 0;

type Build = PublicShareContext["build"];

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) return { title: "Not Found" };

  const ctx = await getPublicShareContext(slug);
  if (!ctx) return { title: "Share removed" };

  const isTestShare = !!ctx.share.testId;
  const domain = ctx.share.targetDomain || ctx.test?.name || "this site";
  const title = `${domain} · Lastest`;
  const description = buildShareDescription({
    domain,
    changesDetected: ctx.build.changesDetected ?? 0,
    totalTests: ctx.build.totalTests ?? 0,
    runAt: ctx.build.completedAt ?? ctx.build.createdAt ?? null,
  });

  // Resolve the canonical origin from the request first; fall back to the
  // build-time env var. Some Twitter/Slack scrapes ended up with a stale
  // localhost twitter:image when NEXT_PUBLIC_APP_URL wasn't pinned at build,
  // which is the "missing thumbnail" symptom callers reported.
  const origin = await resolveRequestOrigin();
  const ogImageUrl = `/api/og/share/${slug}`;
  const absoluteOgImage = `${origin}${ogImageUrl}`;
  const ogAlt = ctx.build.changesDetected
    ? `${ctx.build.changesDetected} visual changes on ${domain}`
    : `Visual regression report for ${domain}`;

  return {
    title,
    description,
    metadataBase: new URL(origin),
    // Build-wide shares (testId null) render near-identical content to their
    // per-test share, so they're noindex'd to avoid duplicate-content
    // competition. The per-test share is the canonical, indexable surface and
    // self-canonicalizes (relative path resolves against metadataBase, which is
    // the request-resolved origin — sidesteps buildShareUrl's stale-localhost
    // fallback). noindex + canonical is a contradictory signal, so build shares
    // get robots-noindex and NO canonical.
    robots: isTestShare
      ? { index: true, follow: true }
      : { index: false, follow: true },
    ...(isTestShare ? { alternates: { canonical: `/r/${slug}` } } : {}),
    openGraph: {
      title,
      description,
      url: buildShareUrl(slug),
      type: "article",
      siteName: "Lastest",
      images: [
        {
          url: absoluteOgImage,
          secureUrl: absoluteOgImage,
          width: 1200,
          height: 630,
          alt: ogAlt,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: absoluteOgImage, alt: ogAlt }],
    },
  };
}

async function resolveRequestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || h.get("host");
    if (host) {
      const proto =
        forwardedProto || (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() unavailable during static analysis / preview builds — fall through.
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

const SHARE_DESC_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// UTC-formatted so the rendered <meta> is stable regardless of server timezone.
function formatRunDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return `${SHARE_DESC_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Trim to <= max chars at a word boundary, appending an ellipsis only when the
// string was actually cut. Keeps the rendered description inside the 160-char
// SEO limit even for very long customer domains.
function clampDescription(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s.,;:—-]+$/,
    "",
  );
  return `${base}…`;
}

// Composes a unique 110-160 char meta description for an /r/<slug> share from
// the run data (domain, change/test counts, run date). Replaces two prior
// templates that came in at 41-87 chars and tripped "meta description too
// short" audits. The lead sentence carries the data; the tail describes the
// page content and is what gets clamped away on overly long domains.
function buildShareDescription({
  domain,
  changesDetected,
  totalTests,
  runAt,
}: {
  domain: string;
  changesDetected: number;
  totalTests: number;
  runAt: Date | string | null;
}): string {
  const testWord = `${totalTests} test${totalTests === 1 ? "" : "s"}`;
  const dateStr = formatRunDate(runAt);
  const onDate = dateStr ? ` on ${dateStr}` : "";
  const lead =
    changesDetected > 0
      ? `Visual regression report for ${domain}: ${changesDetected} visual change${changesDetected === 1 ? "" : "s"} across ${testWord}${onDate}.`
      : `Visual regression report for ${domain}: no visual changes across ${testWord}${onDate}.`;
  const tail =
    " Watch the recording and review the full-page screenshots and diff in Lastest.";
  return clampDescription(`${lead}${tail}`, 158);
}

export default async function PublicSharePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const data = await getShareDataBySlug(slug);
  if (!data) notFound();

  // CSP nonce — required under strict-dynamic for the plain <script src> tag
  // below. See src/proxy.ts for the generation site.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const {
    share,
    build,
    test,
    testRun,
    diffs,
    results: scopedResults,
    stepComparisons: scopedStepComparisons,
  } = data;

  const toUrl = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const rel = p.replace(/^\/+/, "");
    return `/share/${slug}/${rel}`;
  };

  const displayDomain = share.targetDomain || test?.name || "this site";
  // Link out to the actual product/app that was reviewed. Prefer the test's own
  // target URL on test shares, fall back to the build's base URL, and finally
  // synthesize one from the displayed hostname. Sanitized to http(s) only.
  const productUrl = safeExternalUrl(
    (share.testId ? test?.targetUrl : null) ??
      build.baseUrl ??
      (share.targetDomain ? `https://${share.targetDomain}` : null),
  );
  const claimLink = `/register?claim=${slug}`;
  const signInLink = `/login?claim=${slug}`;

  const isTestShare = !!share.testId;

  const shareUrl = buildShareUrl(slug);
  const primaryResult: ShareTestResult | null = isTestShare
    ? (scopedResults.find((r) => r.testId === share.testId) ??
      scopedResults[0] ??
      null)
    : null;

  const totalPixelsChanged = diffs.reduce(
    (sum, d) => sum + (d.pixelDifference ?? 0),
    0,
  );

  // Absolute Core-Web-Vitals "Fast" grade for the share. Null when no vitals
  // were captured (renders "—"); see computePerfScore.
  const perfScore = computePerfScore(scopedResults);

  // Recording clips, hoisted to page level so the player renders as the FIRST
  // element in <main> — above the fold, at actual size, highest in the HTML.
  // Google only indexes videos on "watch pages" where the video is the main
  // content (GSC video indexing report: "Is on a watch page"), so prominence
  // here is what makes the VideoObject markup below actually eligible.
  //
  // `poster` is the result's first captured screenshot: because this hero clip
  // autoplays on load, the buffer window is the first thing viewers see — the
  // poster paints an instant frame there instead of black. It also doubles as
  // the `<video poster>` thumbnail Google's video guidelines recommend.
  type Clip = { src: string; durationMs: number | null; poster: string | null };
  const posterFor = (r: ShareTestResult): string | null => {
    const path = r.screenshots?.[0]?.path ?? r.screenshotPath ?? null;
    return path ? toUrl(path) : null;
  };
  const clips: Clip[] = isTestShare
    ? scopedResults
        .map((r): Clip | null => {
          const src = r.videoPath ? toUrl(r.videoPath) : null;
          return src
            ? { src, durationMs: r.durationMs ?? null, poster: posterFor(r) }
            : null;
        })
        .filter((c): c is Clip => !!c)
    : [];

  // Executor sometimes omits video_path even when a .webm exists. Only then do
  // we scan disk (readdir + stat under storage/videos/<repo>/ via
  // `resolveTestVideoUrl`) — keeping that scan off the common render path where
  // the result already carries a persisted path. The bare
  // `/videos/<repo>/<file>.webm` URL is funneled through `toUrl()` so share
  // viewers fetch via /share/{slug}/... (auth-checked against the slug) rather
  // than /api/media/... (which 401s without a session).
  let fallbackVideoUrl: string | null = null;
  if (isTestShare && (clips.length === 0 || !primaryResult?.videoPath)) {
    const fallbackRaw = await resolveTestVideoUrl(
      share.repositoryId,
      share.testId,
    );
    fallbackVideoUrl = fallbackRaw ? toUrl(fallbackRaw) : null;
  }
  // Disk-fallback clip when no result has a persisted video_path. Use the
  // primary result's recorded duration so the scrubber has a usable max even
  // though we can't trust the webm to embed it.
  if (clips.length === 0 && fallbackVideoUrl) {
    clips.push({
      src: fallbackVideoUrl,
      durationMs: primaryResult?.durationMs ?? null,
      poster: primaryResult ? posterFor(primaryResult) : null,
    });
  }

  // VideoObject structured data — surface the test recording to Google per
  // https://support.google.com/webmasters/answer/7552505 so /r/ pages get
  // video-rich previews instead of plain links. One VideoObject per clip, so
  // every <video> element rendered on the page is described (Google flags
  // rendered videos that lack structured data).
  const origin = await resolveRequestOrigin();
  // Stable "first published" timestamp. MUST match the sitemap's
  // publication_date — listPublicSharesForSitemap uses the same
  // completedAt → createdAt → share.createdAt chain, and Google merges
  // sitemap + JSON-LD and flags inconsistent uploadDates. Never fall back to
  // `new Date()`: with `revalidate = 0` that minted a different uploadDate on
  // every crawl.
  const videoUploadedAt =
    build.completedAt ?? build.createdAt ?? share.createdAt ?? null;
  const videoSchemas = buildVideoSchemas({
    origin,
    slug,
    clips,
    displayName: test?.name ?? displayDomain,
    domain: displayDomain,
    uploadedAt: videoUploadedAt,
    changesDetected: build.changesDetected ?? 0,
  });

  // Optional AI UI/UX summary captured at the end of a /gtm-lastest-saas-demo
  // run. Prefer the latest notes for the share's repo so re-runs flow into
  // existing shares without re-publishing; fall back to the build's own row
  // and finally to null when neither exists.
  const repoIdForNotes = testRun?.repositoryId ?? share.repositoryId ?? null;
  const demoNotes = repoIdForNotes
    ? ((await getLatestDemoNotesForRepo(repoIdForNotes)) ??
      (await getBuildDemoNotes(build.id)))
    : await getBuildDemoNotes(build.id);

  // Subtitle track for the recording. Captions are time-coded to THIS build's
  // recording, so they're read from the build's OWN notes — not the repo-latest
  // `demoNotes` (which feeds the prose panel and may belong to a sibling build
  // whose video has different step timing). Only emit a <track> when captions
  // exist; absent captions → no track → the player renders exactly as before.
  const buildCaptions = (await getBuildDemoNotes(build.id))?.captions ?? [];
  const captionTracks =
    buildCaptions.length > 0
      ? [
          {
            src: `/share/${slug}/captions.vtt`,
            srclang: "en",
            label: "English",
          },
        ]
      : undefined;

  // Lastest awards: render the earned-badges + embed block when the repo has
  // a tier. Resolved by repositoryId — works for both build and test shares.
  const award: RepoAward | null = repoIdForNotes
    ? ((await getRepoAward(repoIdForNotes)) ?? null)
    : null;
  const showAwardBadges = !!award && award.currentTier !== "none";

  // Platform-wide activity numbers for the social-proof strip near the claim
  // CTA. Rendering is threshold-gated inside SocialProofStrip so early-days
  // counts never read as embarrassing.
  const shareStats = await getPublicShareStats();

  // "In this video" chapters — one per captured step, seeking the recording to
  // its `atMs` offset. Falls back to even distribution across the recording
  // duration for legacy runs whose screenshots predate atMs capture.
  const chapters: Chapter[] = isTestShare
    ? collectChapters(
        primaryResult,
        scopedResults,
        toUrl,
        clips[0]?.durationMs ?? primaryResult?.durationMs ?? null,
      )
    : [];

  // Prepopulated copy + assets for the social share kit (X / YouTube / TikTok
  // dialogs). Copy is built server-side (pure string work) so the client
  // island only ships UI. Slides feed TikTok's photo-slideshow flow: step
  // captures on test shares, changed-page screenshots on build shares.
  const shareVerdictLabel = isTestShare
    ? testVerdict(primaryResult?.status ?? null).label
    : buildVerdict(build.overallStatus).label;
  const shareSlides: ShareSlide[] = isTestShare
    ? chapters.map((c) => ({ url: c.src, label: c.label }))
    : [
        ...buildSliderDiffs(diffs, toUrl).map((d) => ({
          url: d.current,
          label: d.stepLabel ?? "Visual change",
        })),
        ...buildGallery(diffs, scopedResults, toUrl, new Set<string>()).map(
          (g) => ({ url: g.src, label: g.label }),
        ),
      ];
  const socialCopy = buildSocialCopy({
    shareUrl,
    title: isTestShare ? (test?.name ?? displayDomain) : displayDomain,
    domain: displayDomain,
    variant: isTestShare ? "test" : "build",
    verdictLabel: shareVerdictLabel,
    pixelsChanged: totalPixelsChanged,
    changesDetected: build.changesDetected ?? 0,
    totalTests: build.totalTests ?? 0,
    durationMs: primaryResult?.durationMs ?? null,
    chapters: chapters.map((c) => ({ title: c.label, atSec: c.atSec })),
    uxSummary: demoNotes?.uxSummary ?? null,
    highlights: demoNotes?.highlights ?? [],
    outreachHook: demoNotes?.outreachHook ?? null,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShareHeader signInLink={signInLink} claimLink={claimLink} />

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-8">
        {clips.length > 0 && (
          <section className="space-y-3">
            {/* <figure>/<figcaption> binds descriptive text to the recording so
                the page reads as a video watch page (Google's "video is the
                main content" signal) and the player has an accessible label. */}
            <figure className="m-0 space-y-2">
              <ShareVideoPlayer clips={clips} tracks={captionTracks} />
              <figcaption className="text-sm text-muted-foreground">
                Recording of the visual regression run on {displayDomain}
                {test?.name ? ` · ${test.name}` : ""}.
              </figcaption>
            </figure>
            {chapters.length > 0 && <ChapterRail chapters={chapters} />}
          </section>
        )}

        <OutcomeHeader
          variant={isTestShare ? "test" : "build"}
          domain={displayDomain}
          targetDomain={share.targetDomain}
          productUrl={productUrl}
          testName={isTestShare ? (test?.name ?? null) : null}
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
            build={build}
            perfScore={perfScore}
            testResult={primaryResult}
            domain={displayDomain}
            testCode={test?.code ?? null}
            pixelsChanged={totalPixelsChanged}
            stepComparisons={scopedStepComparisons}
            demoNotes={demoNotes}
            claimLink={claimLink}
            signInLink={signInLink}
          />
        ) : (
          <>
            <LayerOutcomesGrid
              variant="build"
              testResult={primaryResult}
              results={scopedResults}
              diffs={diffs}
              stepComparisons={scopedStepComparisons}
              signInLink={signInLink}
            />
            {hasDemoContent(demoNotes) && <DemoNotesPanel notes={demoNotes} />}
            <BuildSummary
              build={build}
              targetDomain={share.targetDomain}
              branch={testRun?.gitBranch ?? null}
              perfScore={perfScore}
            />
            <BuildDiffsGallery
              diffs={diffs}
              results={scopedResults}
              toUrl={toUrl}
            />
          </>
        )}

        <SocialShareKit
          shareUrl={shareUrl}
          title={isTestShare ? (test?.name ?? displayDomain) : displayDomain}
          copy={socialCopy}
          videoUrl={clips[0]?.src ?? null}
          slides={shareSlides}
        />

        {showAwardBadges && award && <AwardBadgeRow award={award} />}

        <SocialProofStrip stats={shareStats} />

        <ClaimCTA
          claimLink={claimLink}
          signInLink={signInLink}
          domain={displayDomain}
          variant={isTestShare ? "test" : "build"}
        />

        <MoreDemosLink />

        <ShareFooter slug={slug} />
      </main>

      {/* External static assets in /public: idle/active slider toggling and
          pointer-driven reveal for the diff sliders. Same zero-hydration-cost
          shape as the previous inline emission, but cacheable and CSP-friendly
          (lets script-src drop 'unsafe-inline' for app code). The video player
          is a separate React client island (see ShareVideoPlayer) which owns
          playback rate, scrubbing, and step-seek wiring.
          eslint-disable-next-line is for @next/next/no-css-tags — we want a
          /public static asset, not a bundled module import. */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/share-slider.css" precedence="default" />
      {/* `async` (not `defer`): React only special-cases async external
          scripts — it hoists them to <head>, dedupes, and actually executes
          them on client renders. A `defer` script is treated as inert markup
          ("Scripts inside React components are never executed"). Load order
          doesn't matter here: share-slider.js uses document-level delegation.
          Browsers strip the `nonce` attribute from the DOM after CSP
          evaluation as a side-channel mitigation, so the client sees
          nonce="" during hydration. The script has already loaded
          correctly under the original nonce; suppress the cosmetic mismatch. */}
      <script
        src="/share-slider.js"
        async
        nonce={nonce}
        suppressHydrationWarning
      />
      {videoSchemas.map((schema, i) => (
        <script
          key={`video-schema-${i}`}
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </div>
  );
}

// Builds one VideoObject per rendered clip. The first clip is the canonical
// recording and keeps the branded OG card as its thumbnail (matches the
// sitemap's thumbnail_loc + the social card); additional clips use their own
// first-frame poster so each VideoObject carries a unique, representative
// thumbnail (Google wants unique text + thumbnail per video), falling back to
// the OG card when a clip has no captured frame.
function buildVideoSchemas({
  origin,
  slug,
  clips,
  displayName,
  domain,
  uploadedAt,
  changesDetected,
}: {
  origin: string;
  slug: string;
  clips: { src: string; durationMs: number | null; poster: string | null }[];
  displayName: string;
  domain: string;
  uploadedAt: Date | null;
  changesDetected: number;
}): Record<string, unknown>[] {
  const abs = (p: string): string =>
    p.startsWith("http") ? p : `${origin}${p}`;
  const ogThumbnail = `${origin}/api/og/share/${slug}`;
  // Single ISO 8601 instant shared by every clip; omitted entirely when no
  // stable timestamp exists rather than emitting a moving `new Date()`.
  const uploadDate = uploadedAt ? uploadedAt.toISOString() : null;
  const description =
    changesDetected > 0
      ? `Visual regression recording for ${domain} — ${changesDetected} change${changesDetected === 1 ? "" : "s"} detected.`
      : `Visual regression recording for ${domain} — no changes detected against baseline.`;

  return clips.map((clip, i) => {
    const thumbnailUrl =
      i === 0 ? ogThumbnail : clip.poster ? abs(clip.poster) : ogThumbnail;
    const name =
      i === 0
        ? `${displayName} · Lastest visual regression run`
        : `${displayName} · Lastest visual regression run (clip ${i + 1})`;
    const schema: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name,
      description,
      thumbnailUrl: [thumbnailUrl],
      // contentUrl ONLY — Google prefers it over embedUrl, and an embedUrl
      // pointing at the page itself makes GSC report "multiple video URLs"
      // (the page URL gets parsed as a second video). embedUrl is reserved
      // for a dedicated iframe player URL, which we don't have.
      contentUrl: abs(clip.src),
    };
    if (uploadDate) schema.uploadDate = uploadDate;
    if (clip.durationMs && clip.durationMs > 0) {
      schema.duration = msToIso8601Duration(clip.durationMs);
    }
    return schema;
  });
}

function msToIso8601Duration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let out = "PT";
  if (h > 0) out += `${h}H`;
  if (m > 0) out += `${m}M`;
  if (s > 0 || (h === 0 && m === 0)) out += `${s}S`;
  return out;
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
          <a
            href={signInLink}
            className="text-sm underline-offset-4 hover:underline"
          >
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
  tone: "ok" | "warn" | "danger" | "neutral";
};

function buildVerdict(status: string | null | undefined): Verdict {
  switch (status) {
    case "safe_to_merge":
      return { label: "Safe to merge", tone: "ok" };
    case "review_required":
      return { label: "Review required", tone: "warn" };
    case "blocked":
      return { label: "Blocked", tone: "danger" };
    default:
      return {
        label: status ? humanize(status) : "Run complete",
        tone: "neutral",
      };
  }
}

function testVerdict(status: string | null | undefined): Verdict {
  switch (status) {
    case "passed":
    case "approved":
      return { label: "Passed", tone: "ok" };
    case "failed":
    case "regression":
      return { label: "Failed", tone: "danger" };
    case "changed":
    case "pending_review":
      return { label: "Changed", tone: "warn" };
    case "skipped":
      return { label: "Skipped", tone: "neutral" };
    default:
      return {
        label: status ? humanize(status) : "Run complete",
        tone: "neutral",
      };
  }
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toneClasses(tone: Verdict["tone"]): {
  card: string;
  pill: string;
  title: string;
} {
  switch (tone) {
    case "ok":
      return {
        card: "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900",
        pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
        title: "text-emerald-900 dark:text-emerald-100",
      };
    case "warn":
      return {
        card: "border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900",
        pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
        title: "text-amber-900 dark:text-amber-100",
      };
    case "danger":
      return {
        card: "border-rose-200 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-900",
        pill: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
        title: "text-rose-900 dark:text-rose-100",
      };
    default:
      return {
        card: "border bg-muted/40",
        pill: "bg-muted text-foreground",
        title: "text-foreground",
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
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Only ever link out to http(s) targets — guards the "Visit site" button
// against javascript:/data: URLs slipping in from a test's target URL.
function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function OutcomeHeader({
  variant,
  domain,
  targetDomain,
  productUrl,
  testName,
  build,
  testResult,
  pixelsChanged,
  branch,
  commit,
}: {
  variant: "build" | "test";
  domain: string;
  targetDomain: string | null;
  productUrl: string | null;
  testName: string | null;
  build: Build;
  testResult: ShareTestResult | null;
  pixelsChanged: number;
  branch: string | null;
  commit: string | null;
}) {
  const verdict =
    variant === "test"
      ? testVerdict(testResult?.status ?? null)
      : buildVerdict(build.overallStatus);
  const tone = toneClasses(verdict.tone);

  const title = variant === "test" ? (testName ?? domain) : domain;

  const metaBits: string[] = [];
  if (variant === "build") {
    const total = build.totalTests ?? 0;
    if (total > 0) metaBits.push(`${total} test${total === 1 ? "" : "s"}`);
    if (branch) metaBits.push(branch);
    if (commit && commit !== "unknown") metaBits.push(commit.slice(0, 7));
    const dur = formatDuration(build.elapsedMs);
    if (dur) metaBits.push(dur);
  } else {
    const dur = testResult?.durationMs;
    if (dur != null) metaBits.push(`${dur.toLocaleString()} ms`);
    metaBits.push(
      pixelsChanged > 0
        ? `${pixelsChanged.toLocaleString()} pixels changed`
        : "0 pixels changed · matches baseline",
    );
  }

  const shortCommit =
    commit && commit !== "unknown" ? commit.slice(0, 7).toUpperCase() : null;

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
              {verdict.tone === "ok" ? " ✓" : ""}
            </span>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {variant === "test" ? "Test recording" : "Build summary"}
            </p>
          </div>
          <h1
            className={`text-2xl sm:text-3xl font-semibold tracking-tight break-words ${tone.title}`}
          >
            {title}
          </h1>
          {metaBits.length > 0 && (
            <p className="text-sm text-muted-foreground font-mono break-words">
              {metaBits.join(" · ")}
            </p>
          )}
          {/* "Built for you" framing, above the fold. The dedicated claim CTA
              sections below carry the conversion ask; the outbound product link
              stays a quiet text link. */}
          <p className="text-sm text-muted-foreground">
            {variant === "test"
              ? `We built this regression test for ${domain} — it's yours to keep, free.`
              : `We ran this regression suite against ${domain} — the tests are yours to keep, free.`}
          </p>
          {productUrl && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
              >
                Visit site
                <ExternalLinkIcon />
              </a>
            </div>
          )}
        </div>
        {shortCommit && (
          <div className="hidden sm:flex flex-col items-end shrink-0 text-right">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {variant === "test" ? "Run" : "Build"}
            </span>
            <span className="text-sm font-mono">{shortCommit}</span>
            {branch && (
              <span className="text-xs font-mono text-muted-foreground">
                {branch}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Layer outcomes grid ----------------------------------------------------
// Rolls per-step diff signals (visual, dom, network, console, a11y, perf, url,
// variables) up into one chip per category and shows whether each ran clean,
// drifted, or regressed. Pulls from step_comparisons.layers when available and
// from the raw visual_diffs / test_results otherwise. "Run" is the test
// result's own pass/fail; "Text" reflects screenshot-OCR coverage (captured
// alongside text-anchor steps) and reads as "—" when the run didn't exercise
// any text-bound assertions.

type LayerTone = "ok" | "warn" | "danger" | "neutral" | "muted";
type LayerOutcome = {
  key: string;
  label: string;
  value: string;
  tone: LayerTone;
  title?: string;
};

function computeLayerOutcomes({
  variant,
  testResult,
  results,
  diffs,
  stepComparisons,
}: {
  variant: "build" | "test";
  testResult: ShareTestResult | null;
  results: ShareTestResult[];
  diffs: ShareVisualDiff[];
  stepComparisons: ShareStepComparison[];
}): LayerOutcome[] {
  // Run — test pass/fail or build verdict roll-up.
  const run: LayerOutcome = (() => {
    if (variant === "test") {
      const status = testResult?.status ?? null;
      if (status === "passed" || status === "approved")
        return { key: "run", label: "Run", value: "✓", tone: "ok" };
      if (status === "failed" || status === "regression")
        return { key: "run", label: "Run", value: "✕", tone: "danger" };
      if (status === "changed" || status === "pending_review")
        return { key: "run", label: "Run", value: "~", tone: "warn" };
      if (status === "skipped")
        return { key: "run", label: "Run", value: "⊘", tone: "muted" };
      return { key: "run", label: "Run", value: "—", tone: "muted" };
    }
    const passed = results.filter(
      (r) => r.status === "passed" || r.status === "approved",
    ).length;
    const failed = results.filter(
      (r) => r.status === "failed" || r.status === "regression",
    ).length;
    if (failed > 0)
      return {
        key: "run",
        label: "Run",
        value: `${failed} failed`,
        tone: "danger",
        title: `${passed} passed, ${failed} failed`,
      };
    if (results.length > 0)
      return {
        key: "run",
        label: "Run",
        value: "✓",
        tone: "ok",
        title: `${passed} passed`,
      };
    return { key: "run", label: "Run", value: "—", tone: "muted" };
  })();

  // Visual — biggest % across diffs; ✓ if everything matched baseline.
  const visual: LayerOutcome = (() => {
    let maxPct = 0;
    let totalPx = 0;
    for (const d of diffs) {
      const pct = d.percentageDifference
        ? parseFloat(d.percentageDifference)
        : 0;
      if (Number.isFinite(pct) && pct > maxPct) maxPct = pct;
      totalPx += d.pixelDifference ?? 0;
    }
    if (totalPx <= 0)
      return { key: "visual", label: "Visual", value: "✓", tone: "ok" };
    const valueStr =
      maxPct >= 0.01
        ? `${maxPct.toFixed(2)}%`
        : `${totalPx.toLocaleString()}px`;
    return {
      key: "visual",
      label: "Visual",
      value: valueStr,
      tone: maxPct >= 1 ? "warn" : "neutral",
      title: `${totalPx.toLocaleString()} pixels changed across ${diffs.length} step${diffs.length === 1 ? "" : "s"}`,
    };
  })();

  // Text — OCR / text-anchored screenshot deltas aren't part of the regular
  // run pipeline, so this stays "—" unless we surface inspector-on-demand data.
  // Kept as a visible chip so users see what Lastest checks; the dash tells
  // them this run didn't exercise it.
  const text: LayerOutcome = {
    key: "text",
    label: "Text",
    value: "—",
    tone: "muted",
    title:
      "Text-diff is an on-demand inspector dimension; not captured by this run",
  };

  // DOM — verdict roll-up from step_comparisons.layers.dom. We don't have a
  // public-share-safe DomDiffResult shape, so fall back to "✓" if any step
  // comparison exists with no dom payload (means run captured the snapshot
  // and the scorer didn't flag drift).
  const dom: LayerOutcome = (() => {
    const domSteps = stepComparisons.filter((s) => s.layers?.dom);
    if (domSteps.length === 0) {
      return stepComparisons.length > 0
        ? { key: "dom", label: "DOM", value: "✓", tone: "ok" }
        : { key: "dom", label: "DOM", value: "—", tone: "muted" };
    }
    const reds = stepComparisons.filter(
      (s) => s.verdict === "red" && s.layers?.dom,
    ).length;
    if (reds > 0)
      return {
        key: "dom",
        label: "DOM",
        value: `${reds} changed`,
        tone: "warn",
      };
    return {
      key: "dom",
      label: "DOM",
      value: `${domSteps.length} changed`,
      tone: "neutral",
    };
  })();

  // Network — added/removed across all step comparisons.
  const network: LayerOutcome = (() => {
    let added = 0;
    let removed = 0;
    let newErrors = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const n = s.layers?.network;
      if (!n) continue;
      touched = true;
      added += n.added ?? 0;
      removed += n.removed ?? 0;
      newErrors += n.newErrorCount ?? 0;
    }
    if (!touched)
      return { key: "network", label: "Network", value: "—", tone: "muted" };
    if (added === 0 && removed === 0 && newErrors === 0)
      return { key: "network", label: "Network", value: "✓", tone: "ok" };
    return {
      key: "network",
      label: "Network",
      value: `+${added} −${removed}`,
      tone: newErrors > 0 ? "danger" : "neutral",
      title:
        newErrors > 0
          ? `${newErrors} new 4xx/5xx response${newErrors === 1 ? "" : "s"}`
          : undefined,
    };
  })();

  // Console — new error fingerprints across steps.
  const consoleLayer: LayerOutcome = (() => {
    let newCount = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const c = s.layers?.consoleDiff;
      if (!c) continue;
      touched = true;
      newCount += c.newFingerprints?.length ?? 0;
    }
    if (!touched)
      return { key: "console", label: "Console", value: "✓", tone: "ok" };
    if (newCount === 0)
      return { key: "console", label: "Console", value: "✓", tone: "ok" };
    return {
      key: "console",
      label: "Console",
      value: `${newCount} new`,
      tone: "danger",
    };
  })();

  // A11y — new violations by severity.
  const a11y: LayerOutcome = (() => {
    let critical = 0;
    let serious = 0;
    let moderate = 0;
    let minor = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const a = s.layers?.a11y;
      if (!a) continue;
      touched = true;
      critical += a.newBySeverity?.critical ?? 0;
      serious += a.newBySeverity?.serious ?? 0;
      moderate += a.newBySeverity?.moderate ?? 0;
      minor += a.newBySeverity?.minor ?? 0;
    }
    if (!touched)
      return { key: "a11y", label: "A11y", value: "—", tone: "muted" };
    const total = critical + serious + moderate + minor;
    if (total === 0)
      return { key: "a11y", label: "A11y", value: "✓", tone: "ok" };
    return {
      key: "a11y",
      label: "A11y",
      value: `${total} new`,
      tone: critical + serious > 0 ? "danger" : "warn",
      title: `crit ${critical} · serious ${serious} · mod ${moderate} · minor ${minor}`,
    };
  })();

  // Perf — Web Vitals budget breaches / drift.
  const perf: LayerOutcome = (() => {
    let breached = 0;
    let drifted = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const p = s.layers?.perf;
      if (!p) continue;
      touched = true;
      for (const d of p.deltas ?? []) {
        if (d.budgetBreached) breached++;
        else if (d.drifted) drifted++;
      }
    }
    if (!touched)
      return { key: "perf", label: "Perf", value: "—", tone: "muted" };
    if (breached === 0 && drifted === 0)
      return { key: "perf", label: "Perf", value: "✓", tone: "ok" };
    if (breached > 0)
      return {
        key: "perf",
        label: "Perf",
        value: `${breached} over`,
        tone: "danger",
      };
    return {
      key: "perf",
      label: "Perf",
      value: `${drifted} drift`,
      tone: "warn",
    };
  })();

  // URL — trajectory divergence count.
  const url: LayerOutcome = (() => {
    let diverged = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const u = s.layers?.url;
      if (!u) continue;
      touched = true;
      diverged += u.divergedSteps?.length ?? 0;
    }
    if (!touched) return { key: "url", label: "URL", value: "✓", tone: "ok" };
    if (diverged === 0)
      return { key: "url", label: "URL", value: "✓", tone: "ok" };
    return {
      key: "url",
      label: "URL",
      value: `${diverged} diverged`,
      tone: "danger",
    };
  })();

  // Variables — diff entries across steps (structural-break highest signal).
  const variables: LayerOutcome = (() => {
    let changes = 0;
    let breaks = 0;
    let touched = false;
    for (const s of stepComparisons) {
      const v = s.layers?.variable;
      if (!v) continue;
      touched = true;
      for (const c of v.changes ?? []) {
        changes++;
        if (c.tier === "structural-break" || c.tier === "type-change") breaks++;
      }
    }
    if (!touched)
      return {
        key: "variables",
        label: "Variables",
        value: "—",
        tone: "muted",
      };
    if (changes === 0)
      return { key: "variables", label: "Variables", value: "✓", tone: "ok" };
    return {
      key: "variables",
      label: "Variables",
      value: `${changes} changed`,
      tone: breaks > 0 ? "danger" : "warn",
    };
  })();

  return [
    run,
    visual,
    text,
    dom,
    network,
    consoleLayer,
    a11y,
    perf,
    url,
    variables,
  ];
}

function layerToneClasses(tone: LayerTone): { card: string; value: string } {
  switch (tone) {
    case "ok":
      return {
        card: "border-emerald-200 bg-white dark:bg-card dark:border-emerald-900",
        value: "text-emerald-700 dark:text-emerald-300",
      };
    case "warn":
      return {
        card: "border-amber-200 bg-white dark:bg-card dark:border-amber-900",
        value: "text-amber-800 dark:text-amber-200",
      };
    case "danger":
      return {
        card: "border-rose-200 bg-white dark:bg-card dark:border-rose-900",
        value: "text-rose-700 dark:text-rose-300",
      };
    case "neutral":
      return {
        card: "border bg-white dark:bg-card",
        value: "text-foreground",
      };
    default:
      return {
        card: "border bg-white dark:bg-card",
        value: "text-muted-foreground",
      };
  }
}

function LayerOutcomesGrid({
  variant,
  testResult,
  results,
  diffs,
  stepComparisons,
  signInLink,
}: {
  variant: "build" | "test";
  testResult: ShareTestResult | null;
  results: ShareTestResult[];
  diffs: ShareVisualDiff[];
  stepComparisons: ShareStepComparison[];
  signInLink?: string;
}) {
  const outcomes = computeLayerOutcomes({
    variant,
    testResult,
    results,
    diffs,
    stepComparisons,
  });
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Checks run
        </h2>
        {signInLink && (
          <a
            href={signInLink}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Log in for details
          </a>
        )}
      </div>
      {/* Chips are informational, not links. Routing a cold visitor who clicks
          "A11y: C" into a login form converts worse than telling them what the
          number means — the single header link above is the auth entry point. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {outcomes.map((o) => {
          const t = layerToneClasses(o.tone);
          const tip =
            o.title ??
            (o.value === "—"
              ? `${o.label} wasn't measured in this run — enable it when you claim the test`
              : undefined);
          return (
            <div
              key={o.key}
              title={tip}
              className={`block rounded-md px-3 py-2 text-center ${t.card}`}
            >
              <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                {o.label}
              </div>
              <div
                className={`text-sm font-semibold tabular-nums truncate ${t.value}`}
              >
                {o.value}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Renders the AI UI/UX summary written at the end of a demo run. Three
// founder-facing buckets stack vertically; testingStruggles is intentionally
// hidden from the share (it's automation gotchas, not product feedback).
// skippedRoutes renders as a small provenance footer when present.
function hasDemoContent(n: DemoNotes | null | undefined): n is DemoNotes {
  if (!n) return false;
  return Boolean(
    n.uxSummary ||
    (n.highlights && n.highlights.length > 0) ||
    (n.frictionPoints && n.frictionPoints.length > 0) ||
    (n.skippedRoutes && n.skippedRoutes.length > 0),
  );
}

function DemoNotesPanel({ notes }: { notes: DemoNotes }) {
  const hasHighlights = notes.highlights && notes.highlights.length > 0;
  const hasFriction = notes.frictionPoints && notes.frictionPoints.length > 0;
  const hasSkipped = notes.skippedRoutes && notes.skippedRoutes.length > 0;
  if (!notes.uxSummary && !hasHighlights && !hasFriction && !hasSkipped)
    return null;
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Notes from the demo run
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          AI-generated
        </span>
      </header>
      {notes.uxSummary && (
        <p className="text-base leading-relaxed">{notes.uxSummary}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {hasHighlights && (
          <DemoNoteList title="Highlights" items={notes.highlights} tone="ok" />
        )}
        {hasFriction && (
          <DemoNoteList
            title="Friction points"
            items={notes.frictionPoints}
            tone="warn"
          />
        )}
      </div>
      {hasSkipped && (
        <div className="pt-3 border-t text-xs text-muted-foreground space-y-1">
          <div className="uppercase tracking-wide font-medium">
            Couldn&apos;t reach
          </div>
          <ul className="space-y-0.5">
            {notes.skippedRoutes!.map((r) => (
              <li key={r.path} className="font-mono">
                <span className="text-foreground">{r.path}</span>
                <span className="mx-1">·</span>
                <span>{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DemoNoteList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { label: string; note: string }[];
  tone: "ok" | "warn";
}) {
  const accent =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-amber-800 dark:text-amber-200";
  return (
    <div className="space-y-2">
      <div
        className={`text-xs font-semibold uppercase tracking-wide ${accent}`}
      >
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="text-sm">
            <div className="font-medium">{it.label}</div>
            <div className="text-muted-foreground">{it.note}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomerFavicon({ domain }: { domain: string | null }) {
  const letter = (domain ?? "?").charAt(0).toUpperCase();
  return (
    <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 self-center rounded-lg border bg-card shadow-sm flex items-center justify-center overflow-hidden">
      <span className="text-xl font-semibold text-muted-foreground">
        {letter}
      </span>
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
  perfScore,
}: {
  build: Build;
  targetDomain: string | null;
  branch: string | null;
  perfScore: number | null;
}) {
  const total = build.totalTests ?? 0;
  const passed = build.passedCount ?? 0;
  const failed = build.failedCount ?? 0;
  const changed = build.changesDetected ?? 0;
  const pending = Math.max(0, total - passed - failed - changed);
  const a11y = build.a11yScore;
  const design = build.designSystemScore;
  // passed/failed/changed + Accessible, then any of Design / Fast that reported.
  const tileCount = 4 + (design != null ? 1 : 0) + (perfScore != null ? 1 : 0);

  const configBits: string[] = [];
  if (build.triggerType) configBits.push(humanize(build.triggerType));
  if (branch) configBits.push(branch);
  if (targetDomain) configBits.push(`→ ${targetDomain}`);
  if (total > 0) configBits.push(`${total} test${total === 1 ? "" : "s"}`);

  return (
    <section className="space-y-4">
      {configBits.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
          {configBits.join(" · ")}
        </div>
      )}

      <TickBar
        total={total}
        passed={passed}
        failed={failed}
        changed={changed}
      />

      <div className={`grid gap-3 ${gridColsClass(tileCount)}`}>
        <StatCard value={passed} label="Passed" tone="ok" />
        <StatCard value={failed} label="Failed" tone="danger" />
        <StatCard value={changed} label="Changed" tone="warn" />
        <GradeCard score={a11y} label="Accessible" sub="WCAG 2.2" />
        {design != null && (
          <GradeCard score={design} label="Design" sub="Design system" />
        )}
        {perfScore != null && (
          <GradeCard score={perfScore} label="Fast" sub="Web Vitals" />
        )}
      </div>

      {pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending} test{pending === 1 ? "" : "s"} did not report a status.
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
  const cells: Array<"ok" | "fail" | "chg" | "none"> = [
    ...Array(pOk).fill("ok" as const),
    ...Array(pChg).fill("chg" as const),
    ...Array(pFail).fill("fail" as const),
    ...Array(pNone).fill("none" as const),
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
            c === "ok"
              ? "bg-emerald-500/80"
              : c === "fail"
                ? "bg-rose-500/80"
                : c === "chg"
                  ? "bg-amber-500/80"
                  : ""
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
  tone: "ok" | "warn" | "danger" | "neutral";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "danger"
        ? "text-rose-700 dark:text-rose-300"
        : tone === "warn"
          ? "text-amber-700 dark:text-amber-300"
          : "text-foreground";
  return (
    <div className="rounded-md border bg-card p-3 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground mt-0.5">
        {label}
      </div>
      {sublabel && (
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {sublabel}
        </div>
      )}
    </div>
  );
}

// Map a 0–100 quality score to a presentable letter grade + tone. Bands mirror
// the internal compliance cards (90+ green, 70+ amber, else red).
function scoreGrade(score: number): {
  grade: string;
  tone: "ok" | "warn" | "danger";
} {
  if (score >= 90) return { grade: "A", tone: "ok" };
  if (score >= 80) return { grade: "B", tone: "ok" };
  if (score >= 70) return { grade: "C", tone: "warn" };
  if (score >= 60) return { grade: "D", tone: "warn" };
  return { grade: "F", tone: "danger" };
}

// Presentable quality tile: a letter grade headline (color-toned by band) with
// the raw score + standard label as sublabel. Renders a neutral "—" when the
// layer didn't report a score. Reuses StatCard so it inherits share styling.
function GradeCard({
  score,
  label,
  sub,
}: {
  score: number | null | undefined;
  label: string;
  sub: string;
}) {
  if (score == null) return <StatCard value="—" label={label} tone="neutral" />;
  const { grade, tone } = scoreGrade(score);
  return (
    <StatCard
      value={grade}
      label={label}
      sublabel={`${sub} · ${score}`}
      tone={tone}
    />
  );
}

// Absolute "Fast" score from captured Core Web Vitals. Each metric is scored
// against Google's standard good/needs-improvement/poor thresholds (good=100,
// NI=70, poor=40); we take the worst (most conservative) observed value per
// metric across all samples, then average the metrics we have. Returns null
// when no vitals were captured so the tile renders a neutral "—".
function computePerfScore(results: ShareTestResult[]): number | null {
  const samples: WebVitalsSample[] = results.flatMap((r) => r.webVitals ?? []);
  if (samples.length === 0) return null;
  const worst = (pick: (s: WebVitalsSample) => number | undefined) => {
    const vals = samples
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? Math.max(...vals) : undefined;
  };
  const band = (v: number | undefined, good: number, poor: number) =>
    v == null ? null : v <= good ? 100 : v <= poor ? 70 : 40;
  const scores = [
    band(
      worst((s) => s.lcp),
      2500,
      4000,
    ), // LCP ms
    band(
      worst((s) => s.inp),
      200,
      500,
    ), // INP ms
    band(
      worst((s) => s.cls),
      0.1,
      0.25,
    ), // CLS (unitless)
  ].filter((x): x is number => x != null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Static (Tailwind-scannable) column classes for the quality stat grid, sized
// to the number of tiles present (3–6).
function gridColsClass(n: number): string {
  if (n <= 3) return "grid-cols-2 sm:grid-cols-3";
  if (n === 4) return "grid-cols-2 sm:grid-cols-4";
  if (n === 5) return "grid-cols-2 sm:grid-cols-5";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
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
              ? "Visual change"
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
              stepNumber={d.stepNumber}
            />
          ))}
        </section>
      )}

      {gallery.length > 0 && <GallerySection items={gallery} />}
    </>
  );
}

// --- Test share: video + step strip + stats + pull quote + diffs ------------
// (Social share buttons render at page level via SocialShareKit — both
// build and test shares get them.)

function TestShareBody({
  diffs,
  results,
  toUrl,
  build,
  perfScore,
  testResult,
  domain,
  testCode,
  pixelsChanged,
  stepComparisons,
  demoNotes,
  claimLink,
  signInLink,
}: {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  toUrl: (p: string | null | undefined) => string | null;
  build: Build;
  perfScore: number | null;
  testResult: ShareTestResult | null;
  domain: string;
  testCode: string | null;
  pixelsChanged: number;
  stepComparisons: ShareStepComparison[];
  demoNotes: DemoNotes | null;
  claimLink: string;
  signInLink: string;
}) {
  const steps = collectSteps(testResult, results, toUrl);
  const stepPaths = new Set<string>(collectStepPaths(testResult, results));

  const durationMs = testResult?.durationMs ?? null;

  const sliderDiffs = buildSliderDiffs(diffs, toUrl);
  // DOM-change overlays (Verify > DOM tab, ported): annotated screenshots for
  // steps whose recorded DOM diff has added/removed/changed elements.
  const domOverlays = buildDomOverlays(stepComparisons, diffs, steps, toUrl);
  // Merge DOM overlays into the matching visual diff: when a step has BOTH a
  // pixel diff and DOM changes, the overlay renders directly under that step's
  // slider (same coordinate space — both use the diff's current screenshot)
  // instead of repeating the step in a separate "DOM changes" section. Only
  // overlays whose step has no slider diff render standalone below.
  const domByStepLabel = new Map<string, DomOverlayItem>();
  for (const o of domOverlays) {
    if (o.stepLabel && !domByStepLabel.has(o.stepLabel))
      domByStepLabel.set(o.stepLabel, o);
  }
  const sliderLabels = new Set(
    sliderDiffs.map((d) => d.stepLabel).filter((l): l is string => !!l),
  );
  const standaloneDomOverlays = domOverlays.filter(
    (o) => !o.stepLabel || !sliderLabels.has(o.stepLabel),
  );
  // No diffs → there's no comparison to show (the step strip, now clickable to
  // fullscreen, is the screenshot surface) so render the captured shots large
  // in the gallery instead of deduping them against the strip.
  const galleryDedupeSet =
    sliderDiffs.length === 0 ? new Set<string>() : stepPaths;
  const gallery = buildGallery(diffs, results, toUrl, galleryDedupeSet);

  const pullQuote =
    pixelsChanged > 0
      ? `${pixelsChanged.toLocaleString()} pixels changed — review before ship.`
      : durationMs
        ? `Recorded once. Ran in ${durationMs.toLocaleString()} ms. Zero regressions.`
        : "Recorded once. Runs on every build. Zero regressions.";

  return (
    <>
      {/* Recording player renders at page level (first element in <main>)
          so Google classifies /r/<slug> as a video watch page. */}
      <PostVideoCTA
        claimLink={claimLink}
        signInLink={signInLink}
        domain={domain}
        testCode={testCode}
      />

      <LayerOutcomesGrid
        variant="test"
        testResult={testResult}
        results={results}
        diffs={diffs}
        stepComparisons={stepComparisons}
        signInLink={signInLink}
      />

      {/* The captured-steps strip now lives at page level as the "In this video"
          chapter rail (ChapterRail, rendered under the player) with timecodes +
          click-to-seek. `steps` is still computed below for the DOM overlays. */}

      <div
        className={`grid gap-3 ${gridColsClass(
          3 +
            (build.designSystemScore != null ? 1 : 0) +
            (perfScore != null ? 1 : 0),
        )}`}
      >
        <StatCard
          value={pixelsChanged > 0 ? pixelsChanged.toLocaleString() : "0"}
          label="Diff px"
          tone={pixelsChanged > 0 ? "warn" : "ok"}
        />
        <StatCard
          value={
            durationMs != null
              ? (formatDuration(durationMs) ?? `${durationMs}`)
              : "—"
          }
          label="Duration"
          tone="neutral"
        />
        <GradeCard score={build.a11yScore} label="Accessible" sub="WCAG 2.2" />
        {build.designSystemScore != null && (
          <GradeCard
            score={build.designSystemScore}
            label="Design"
            sub="Design system"
          />
        )}
        {perfScore != null && (
          <GradeCard score={perfScore} label="Fast" sub="Web Vitals" />
        )}
      </div>

      {hasDemoContent(demoNotes) ? (
        <DemoNotesPanel notes={demoNotes} />
      ) : (
        <PullQuote text={pullQuote} />
      )}

      {sliderDiffs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {sliderDiffs.length === 1
              ? "Visual change"
              : `${sliderDiffs.length} visual changes`}
          </h2>
          {sliderDiffs.map((d) => {
            const dom = d.stepLabel
              ? domByStepLabel.get(d.stepLabel)
              : undefined;
            return (
              <div key={d.id} className="space-y-3">
                <DiffSlider
                  baseline={d.baseline}
                  current={d.current}
                  diff={d.diff}
                  stepLabel={d.stepLabel}
                  pixelDifference={d.pixelDifference}
                  stepNumber={d.stepNumber}
                />
                {dom && (
                  <DomOverlay
                    screenshotSrc={dom.src}
                    dom={dom.dom}
                    stepLabel="DOM"
                  />
                )}
              </div>
            );
          })}
        </section>
      )}

      {standaloneDomOverlays.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            {standaloneDomOverlays.length === 1
              ? "DOM change"
              : `${standaloneDomOverlays.length} DOM changes`}
          </h2>
          {standaloneDomOverlays.map((o) => (
            <DomOverlay
              key={o.key}
              screenshotSrc={o.src}
              dom={o.dom}
              stepLabel={o.stepLabel}
            />
          ))}
        </section>
      )}

      {gallery.length > 0 && <GallerySection items={gallery} />}
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
  // Capture uploads can persist out of execution order; the step index in each
  // label ("Step N") is authoritative, so order by it (see also collectChapters
  // and the host-side screenshot sort in executor.ts).
  const captured = [...(source.screenshots ?? [])].sort(byStepLabel);
  for (const s of captured) {
    if (!s.path || seen.has(s.path)) continue;
    seen.add(s.path);
    const url = toUrl(s.path);
    if (!url) continue;
    out.push({ src: url, label: s.label || `Step ${out.length + 1}` });
  }
  if (source.screenshotPath && !seen.has(source.screenshotPath)) {
    const url = toUrl(source.screenshotPath);
    if (url) out.push({ src: url, label: "Final" });
  }
  return out;
}

// Build the "In this video" chapters: one per captured step, carrying the
// recording offset (`atMs`) so the rail can seek the player. When a row lacks
// `atMs` (legacy runs captured before atMs existed), distribute the steps evenly
// across the known recording duration; if the duration is also unknown, the
// chapter renders without a seek target (lightbox-only).
function collectChapters(
  primary: ShareTestResult | null,
  all: ShareTestResult[],
  toUrl: (p: string | null | undefined) => string | null,
  durationMs: number | null,
): Chapter[] {
  const source = primary ?? all[0] ?? null;
  if (!source) return [];
  const ordered: {
    path: string;
    label?: string;
    atMs?: number;
    title?: string;
  }[] = [];
  const seen = new Set<string>();
  for (const s of source.screenshots ?? []) {
    if (!s.path || seen.has(s.path)) continue;
    seen.add(s.path);
    ordered.push(s);
  }
  if (source.screenshotPath && !seen.has(source.screenshotPath)) {
    ordered.push({ path: source.screenshotPath, label: "Final" });
  }
  // Render the rail in execution order even when the stored screenshots array
  // is scrambled (parallel-upload arrival order). "Final"/unparseable rows sort
  // last and keep their relative position.
  ordered.sort(byStepLabel);
  const n = ordered.length;
  const durSec = durationMs && durationMs > 0 ? durationMs / 1000 : null;
  const out: Chapter[] = [];
  ordered.forEach((s, i) => {
    const url = toUrl(s.path);
    if (!url) return;
    let atSec: number | null = null;
    if (typeof s.atMs === "number" && s.atMs >= 0) {
      atSec = s.atMs / 1000;
    } else if (durSec != null) {
      atSec = n > 1 ? (durSec * i) / n : 0;
    }
    // Never seek past the very end of the clip.
    if (atSec != null && durSec != null) {
      atSec = Math.min(atSec, Math.max(0, durSec - 0.1));
    }
    // Prefer the cosmetic `title` (from the screenshot-path slug) for the
    // chapter name; fall back to the structural `label` ("Step N").
    out.push({
      src: url,
      label: s.title || s.label || `Step ${i + 1}`,
      atSec,
    });
  });
  return out;
}

type DomOverlayItem = {
  key: string;
  stepLabel: string | null;
  src: string;
  dom: DomDiffResult;
};

// Pair each step's recorded DOM diff with a base screenshot so the share page
// can draw the same annotated overlay as Verify > DOM. Prefer the diff's
// current image (bounding boxes were captured in that coordinate space); fall
// back to the captured step screenshot of the same label. Steps with no DOM
// changes — or no resolvable screenshot — are skipped.
function buildDomOverlays(
  stepComparisons: ShareStepComparison[],
  diffs: ShareVisualDiff[],
  steps: Step[],
  toUrl: (p: string | null | undefined) => string | null,
): DomOverlayItem[] {
  const diffCurrentByLabel = new Map<string, string>();
  for (const d of diffs) {
    if (!d.stepLabel || !d.currentImagePath) continue;
    const url = toUrl(d.currentImagePath);
    if (url && !diffCurrentByLabel.has(d.stepLabel))
      diffCurrentByLabel.set(d.stepLabel, url);
  }
  const stepByLabel = new Map<string, string>();
  for (const s of steps) {
    if (!stepByLabel.has(s.label)) stepByLabel.set(s.label, s.src);
  }

  const hasChanges = (
    dom: DomDiffResult | null | undefined,
  ): dom is DomDiffResult =>
    !!dom &&
    (dom.added?.length ?? 0) +
      (dom.removed?.length ?? 0) +
      (dom.changed?.length ?? 0) >
      0;

  // DOM diff per step label, preferring the multi-layer step_comparisons
  // .layers.dom and falling back to the legacy visual_diff.metadata.domDiff
  // (mirrors Verify's `layers?.dom ?? domDiff`). Keyed by label so the two
  // sources dedupe to one overlay per step.
  const domByLabel = new Map<string, { key: string; dom: DomDiffResult }>();
  for (const sc of stepComparisons) {
    if (!sc.stepLabel || !hasChanges(sc.layers?.dom)) continue;
    domByLabel.set(sc.stepLabel, { key: sc.id, dom: sc.layers.dom });
  }
  for (const d of diffs) {
    if (!d.stepLabel || domByLabel.has(d.stepLabel) || !hasChanges(d.domDiff))
      continue;
    domByLabel.set(d.stepLabel, { key: d.id, dom: d.domDiff });
  }

  const out: DomOverlayItem[] = [];
  for (const [label, { key, dom }] of domByLabel) {
    const src = diffCurrentByLabel.get(label) ?? stepByLabel.get(label) ?? null;
    if (!src) continue;
    out.push({ key, stepLabel: label, dom, src });
  }
  // Stable capture order so "Step 1" renders before "Step 5".
  out.sort(
    (a, b) =>
      stepNumberFromLabel(a.stepLabel) - stepNumberFromLabel(b.stepLabel),
  );
  return out;
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

// --- diff + gallery helpers (shared between build and test modes) -----------

type SliderDiff = {
  id: string;
  baseline: string;
  current: string;
  diff: string | null;
  stepLabel: string | null;
  pixelDifference: number;
  // Parsed from stepLabel ("Step 5" → 5) so the gallery can be ordered by
  // capture order and the step-strip thumbnails can scroll to the matching
  // slider via [data-step-jump] / [data-step] (see SHARE_SCRIPT). Unparseable
  // labels (null, "Final", random text) sort last with +Infinity.
  stepNumber: number;
};

/** Extract the numeric step from a label like "Step 5". Falls back to +Infinity
 *  so unlabelled / "Final" rows sort last but stay visible. */
function stepNumberFromLabel(label: string | null | undefined): number {
  if (!label) return Number.POSITIVE_INFINITY;
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

/** Ascending sort comparator on the step index parsed from each item's label
 *  ("Step N"). Unparseable / "Final" rows sort last and keep relative order.
 *  The equality short-circuit guards the +Infinity − +Infinity → NaN case. */
function byStepLabel(
  a: { label?: string | null },
  b: { label?: string | null },
): number {
  const an = stepNumberFromLabel(a.label);
  const bn = stepNumberFromLabel(b.label);
  return an === bn ? 0 : an - bn;
}

// For passing tests — no visual_diffs rows exist, so synthesize sliders from
// active baselines paired with captured screenshots. Match by stepLabel
// (with 'final' falling back to the result's primary screenshotPath).
function buildSliderDiffs(
  diffs: ShareVisualDiff[],
  toUrl: (p: string | null | undefined) => string | null,
): SliderDiff[] {
  const out = diffs
    .map((d): SliderDiff | null => {
      // A row with zero pixel difference isn't a visual change — auto-approved
      // / unchanged steps still produce visual_diffs rows, but the "Visual
      // changes" section should only surface actual pixel diffs.
      if ((d.pixelDifference ?? 0) <= 0) return null;
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
        stepNumber: stepNumberFromLabel(d.stepLabel),
      };
    })
    .filter((d): d is SliderDiff => !!d);
  // visual_diffs rows can return in arbitrary order (insertion order, not
  // capture order). Reorder so "Step 1" renders before "Step 5".
  out.sort((a, b) => a.stepNumber - b.stepNumber);
  return out;
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
      if (url) gallery.push({ src: url, label: "Primary" });
    }
    const captured = r.screenshots ?? [];
    for (const s of captured) {
      if (!s.path || shownPaths.has(s.path) || seenGallery.has(s.path))
        continue;
      seenGallery.add(s.path);
      const url = toUrl(s.path);
      if (url) gallery.push({ src: url, label: s.label || "Step" });
    }
  }
  return gallery;
}

function GallerySection({ items }: { items: GalleryItem[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">
        {items.length === 1 ? "Screenshot" : `${items.length} screenshots`}
      </h2>
      {/* Stacked full-width frames mirror the DiffSlider stage so a passing /
          no-diff share shows screenshots at the same scale as a comparison
          view — natural aspect, top-aligned, no cropping. */}
      {items.map((g, i) => (
        <figure key={i} className="space-y-2">
          <header className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-foreground truncate">
              {g.label}
            </span>
          </header>
          <div className="relative rounded-md border bg-muted overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={g.src}
              alt={g.label}
              loading="lazy"
              decoding="async"
              className="block w-full h-auto select-none"
            />
          </div>
        </figure>
      ))}
    </section>
  );
}

function DiffSlider({
  baseline,
  current,
  diff,
  stepLabel,
  pixelDifference,
  stepNumber,
}: {
  baseline: string;
  current: string;
  diff: string | null;
  stepLabel: string | null;
  pixelDifference: number;
  stepNumber: number;
}) {
  // CSS custom property starts at 50 %. The inline <script> (emitted once at
  // page bottom) binds pointer move on .share-slider-stage to this variable
  // and flips data-active between 'false' (diff overlay visible) and 'true'
  // (baseline/current slider comparison revealed). Pure DOM, zero hydration.
  const style = { "--pct": "50%" } as CSSProperties;
  const hasDiff = !!diff;
  const isStepIndex = Number.isFinite(stepNumber);
  // Outer wrapper owns the step-jump scroll anchor (data-step / id /
  // scroll-mt-20) so <StepStrip> jumps land on an always-laid-out element —
  // the desktop figure is `display:none` on touch/narrow viewports, where a
  // hidden anchor would make scrollIntoView a no-op. The desktop hover-wipe
  // slider and the mobile mini-gallery are mutually-exclusive variants gated
  // on pointer type AND width: fine pointer + ≥md → wipe; anything else
  // (coarse pointer, or narrow viewport, or unknown) → gallery.
  return (
    <div
      className="scroll-mt-20"
      {...(isStepIndex
        ? { "data-step": String(stepNumber), id: `share-step-${stepNumber}` }
        : {})}
    >
      <figure
        className="share-slider space-y-2 hidden pointer-fine:md:block"
        style={style}
        data-active={hasDiff ? "false" : "true"}
        data-has-diff={hasDiff ? "true" : "false"}
      >
        <header className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground truncate">
            {stepLabel || "Visual diff"}
          </span>
          {pixelDifference > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {pixelDifference.toLocaleString()} px changed
            </span>
          )}
        </header>
        <div
          className="share-slider-stage relative grid grid-cols-1 grid-rows-1 rounded-md border bg-muted overflow-hidden touch-none select-none data-[active=true]:cursor-ew-resize"
          tabIndex={0}
          role="slider"
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={50}
        >
          {/* All three images occupy the same grid cell so the stage sizes
            itself to the tallest natural height. Previously the baseline
            set the frame and current/diff were `object-cover`-cropped to
            it — when the page grew taller between baseline and current
            (or the test step now points at a different page), the bottom
            of the current screenshot and its diff were silently hidden.
            Grid stacking lets each image render at natural aspect, top-
            aligned, with the shorter one leaving frame-bg below. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={baseline}
            alt="Before"
            draggable={false}
            className="col-start-1 row-start-1 block w-full h-auto self-start select-none pointer-events-none"
          />
          {/* Current revealed on the RIGHT side of the divider via clipPath
            — `inset(0 0 0 --pct)` clips the left --pct off, so baseline
            ("Before") shows on the left and current ("After") on the right,
            matching the build-page slider convention. The previous
            `inset(0 calc(100% - --pct) 0 0)` clipped the right side and
            revealed current on the LEFT, swapping it with the "Before"
            label and inverting baseline/current visually.
            Hidden while the stage is idle (data-active=false). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt="After"
            draggable={false}
            className="share-slider-current col-start-1 row-start-1 block w-full h-auto self-start select-none pointer-events-none transition-opacity duration-150"
            style={{ clipPath: "inset(0 0 0 var(--pct, 50%))" }}
          />
          {/* Diff heat-map overlay — the idle view. Hidden once the slider
            becomes active. */}
          {hasDiff && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={diff}
              alt="Diff"
              draggable={false}
              className="share-slider-diff col-start-1 row-start-1 block w-full h-auto self-start select-none pointer-events-none transition-opacity duration-150"
            />
          )}
          {/* Divider + drag handle — only visible while active. */}
          <div
            className="share-slider-divider absolute top-0 bottom-0 w-px bg-primary pointer-events-none transition-opacity duration-150"
            style={{ left: "var(--pct, 50%)" }}
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
      <MobileDiffGallery
        baseline={baseline}
        current={current}
        diff={diff}
        stepLabel={stepLabel}
        pixelDifference={pixelDifference}
        className="block pointer-fine:md:hidden"
      />
    </div>
  );
}

const CODE_TEASER_LINES = 12;

type CodeTeaser = { lines: string[]; hiddenCount: number };

// First lines of the real Playwright test, safe to render publicly. Typed-in
// payloads (.fill/.type second string argument) are redacted so credentials or
// emails recorded during authoring never appear on a public page. The tail of
// the file stays behind the signup gate — the teaser's job is to prove the
// test is real code the visitor can walk away with.
function buildCodeTeaser(code: string | null | undefined): CodeTeaser | null {
  if (!code) return null;
  const redacted = code.replace(
    /(\.(?:fill|type)\(\s*(['"`])(?:\\.|(?!\2).)*\2\s*,\s*)(['"`])(?:\\.|(?!\3).)*\3/g,
    "$1$3•••$3",
  );
  const all = redacted.replace(/\r\n/g, "\n").split("\n");
  while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();
  if (all.length === 0) return null;
  const lines = all.slice(0, CODE_TEASER_LINES);
  return { lines, hiddenCount: Math.max(0, all.length - lines.length) };
}

function PostVideoCTA({
  claimLink,
  signInLink,
  domain,
  testCode,
}: {
  claimLink: string;
  signInLink: string;
  domain: string;
  testCode: string | null;
}) {
  const teaser = buildCodeTeaser(testCode);
  return (
    <section className="rounded-xl border bg-white dark:bg-card p-5 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <div className="flex-1 min-w-0 space-y-1">
          <h2 className="text-base sm:text-lg font-semibold tracking-tight">
            Take this test with you
          </h2>
          <p className="text-sm text-muted-foreground">
            This is a real Playwright test, recorded against {domain}. Claim it
            into your own workspace and re-run it on every deploy — free.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <a
            href={claimLink}
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Claim this test — free
          </a>
          <a
            href={signInLink}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Sign in to run it
          </a>
        </div>
      </div>
      {teaser && (
        <figure className="m-0">
          <div className="relative rounded-md border bg-muted/40 overflow-hidden">
            <pre className="overflow-x-auto p-4 text-xs leading-relaxed font-mono text-muted-foreground">
              {teaser.lines.join("\n")}
            </pre>
            {teaser.hiddenCount > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white dark:from-card to-transparent pointer-events-none" />
            )}
          </div>
          {teaser.hiddenCount > 0 && (
            <figcaption className="mt-1.5 text-xs text-muted-foreground">
              +{teaser.hiddenCount} more line
              {teaser.hiddenCount === 1 ? "" : "s"} —{" "}
              <a
                href={claimLink}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                claim the test to get the full code
              </a>
              .
            </figcaption>
          )}
        </figure>
      )}
    </section>
  );
}

// Threshold below which the strip stays hidden — small numbers read as "nobody
// uses this" and hurt more than no proof at all.
const SOCIAL_PROOF_MIN_RUNS = 100;
const SOCIAL_PROOF_MIN_PRODUCTS = 5;

function SocialProofStrip({
  stats,
}: {
  stats: { productsTested: number; testRunsCompleted: number };
}) {
  const showRuns = stats.testRunsCompleted >= SOCIAL_PROOF_MIN_RUNS;
  const showProducts = stats.productsTested >= SOCIAL_PROOF_MIN_PRODUCTS;
  if (!showRuns && !showProducts) return null;
  const bits: string[] = [];
  if (showRuns)
    bits.push(`${stats.testRunsCompleted.toLocaleString()} test runs recorded`);
  if (showProducts)
    bits.push(`${stats.productsTested.toLocaleString()} products tested`);
  return (
    <div className="text-center text-sm text-muted-foreground">
      {bits.join(" · ")} with Lastest
    </div>
  );
}

function ClaimCTA({
  claimLink,
  signInLink,
  domain,
  variant,
}: {
  claimLink: string;
  signInLink: string;
  domain: string;
  variant: "build" | "test";
}) {
  return (
    <section className="rounded-xl border bg-white dark:bg-card p-6 sm:p-8 space-y-4">
      <h2 className="text-xl sm:text-2xl font-semibold">
        {variant === "test"
          ? `This test was built for ${domain} — claim it free`
          : `These tests were built for ${domain} — claim them free`}
      </h2>
      <p className="text-sm text-muted-foreground">
        One click copies the test{variant === "test" ? "" : "s"} and baseline
        screenshots into your own Lastest workspace. Re-run on every deploy and
        catch regressions before your users do — free, no card required.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <a
          href={claimLink}
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          {variant === "test" ? "Claim this test" : "Claim these tests"}
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

// A prominent, crawlable dofollow link into the demos hub. Without it, each
// share page is a "dead end" for crawlers (its CTAs are <button>s, not links) —
// this gives every /r/<slug> an outgoing link into Lastest's content graph and
// lets crawlers hop between demos. Target is the apex marketing site, which
// serves a real /demos gallery (the app domain has no /demos route).
function MoreDemosLink() {
  return (
    <div className="pt-2 text-center text-sm text-muted-foreground">
      <a
        href="https://lastest.cloud/demos"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Browse more live Lastest demo reports →
      </a>
    </div>
  );
}

function ShareFooter({ slug }: { slug: string }) {
  return (
    <footer className="pt-6 border-t text-xs text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 justify-between">
      <span>
        Run by{" "}
        <a
          href="https://lastest.cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground hover:underline"
        >
          lastest.cloud
        </a>
      </span>
      <div className="flex items-center gap-4">
        <a
          href="https://lastest.cloud/demos"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
        >
          More demos
        </a>
        <a href="/terms" className="hover:text-foreground">
          Terms
        </a>
        <a href="/privacy" className="hover:text-foreground">
          Privacy
        </a>
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
