// Pure builders for the prepopulated copy behind the /r/<slug> social share
// buttons (X, YouTube, TikTok). No DOM/Node APIs — safe to run on the server
// (the share page precomputes the strings) and trivially unit-testable.
//
// Platform limits enforced here:
// - X: 280 weighted chars, any URL counts as 23 (t.co wrapping).
// - YouTube: title ≤ 100 chars, description ≤ 5000, tags ≤ 500 chars total.
// - TikTok: caption kept ≤ 2200 chars (safe under every tier's limit).

export interface ShareChapter {
  title: string;
  atSec: number | null;
}

export interface SocialCopyInput {
  shareUrl: string;
  /** Headline — test name for test shares, domain for build shares. */
  title: string;
  domain: string;
  variant: "test" | "build";
  /** Human verdict, e.g. "Passed", "Changed", "Safe to merge". */
  verdictLabel: string;
  pixelsChanged: number;
  changesDetected: number;
  totalTests: number;
  durationMs: number | null;
  /** Ordered step chapters — become YouTube description timestamps. */
  chapters: ShareChapter[];
  /** Optional AI demo-run summary + highlights, woven into long-form copy. */
  uxSummary: string | null;
  highlights: { label: string; note: string }[];
}

export interface SocialCopy {
  x: string;
  youtube: { title: string; description: string; tags: string };
  tiktok: string;
  linkedin: string;
}

const X_LIMIT = 280;
const X_URL_WEIGHT = 23;
const YT_TITLE_LIMIT = 100;
const YT_DESCRIPTION_LIMIT = 5000;
const YT_TAGS_LIMIT = 500;
const TIKTOK_LIMIT = 2200;
const LINKEDIN_LIMIT = 3000;

/** "1:23" / "12:05" / "1:02:03" — YouTube chapter timestamp format. */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = `${(s % 60).toString().padStart(2, "0")}`;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${rest}`
    : `${m}:${rest}`;
}

function clampAtWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:—-]+$/, "")}…`;
}

/** One-line result summary shared by every platform's copy. */
export function buildStatLine(input: SocialCopyInput): string {
  const {
    variant,
    pixelsChanged,
    changesDetected,
    totalTests,
    durationMs,
    verdictLabel,
  } = input;
  if (variant === "build") {
    const tests = `${totalTests} automated test${totalTests === 1 ? "" : "s"}`;
    return changesDetected > 0
      ? `${changesDetected} visual change${changesDetected === 1 ? "" : "s"} caught across ${tests}`
      : `0 regressions across ${tests}`;
  }
  const runTime =
    durationMs && durationMs > 0
      ? ` in ${(durationMs / 1000).toFixed(1)}s`
      : "";
  return pixelsChanged > 0
    ? `${pixelsChanged.toLocaleString("en-US")} pixels changed — ${verdictLabel.toLowerCase()}`
    : `0 pixels changed${runTime} — matches baseline`;
}

function verdictEmoji(input: SocialCopyInput): string {
  const v = input.verdictLabel.toLowerCase();
  if (v.includes("fail") || v.includes("block")) return "🔴";
  if (
    input.variant === "test"
      ? input.pixelsChanged > 0
      : input.changesDetected > 0
  )
    return "🟡";
  return "✅";
}

// --- X ----------------------------------------------------------------------

/** Weighted length the way X counts it: every URL costs 23 chars. */
export function xWeightedLength(text: string): number {
  let weighted = 0;
  let rest = text;
  const urlRe = /https?:\/\/\S+/;
  for (;;) {
    const m = rest.match(urlRe);
    if (!m || m.index == null) break;
    weighted += m.index + X_URL_WEIGHT;
    rest = rest.slice(m.index + m[0].length);
  }
  return weighted + rest.length;
}

export function buildXPost(input: SocialCopyInput): string {
  const stat = buildStatLine(input);
  const lead = `${verdictEmoji(input)} ${input.title} on ${input.domain}: ${stat}.`;
  const tail = `\n\nWatch the full run 👇\n${input.shareUrl}\n\n#VisualTesting #QA #WebDev`;
  const budget = X_LIMIT - xWeightedLength(tail);
  return `${clampAtWordBoundary(lead, budget)}${tail}`;
}

// --- YouTube ------------------------------------------------------------------

// YouTube only renders chapters when there are ≥ 3 timestamps, the first is
// 0:00, and they strictly increase. Normalize toward that; return "" when the
// run can't produce a valid chapter list rather than emitting a broken one.
export function buildYouTubeChapters(chapters: ShareChapter[]): string {
  const stamped = chapters.filter(
    (c): c is { title: string; atSec: number } =>
      typeof c.atSec === "number" && c.atSec >= 0 && !!c.title,
  );
  const lines: string[] = [];
  let last = -1;
  for (const c of stamped) {
    // Chapters must strictly increase in whole seconds.
    const sec = Math.max(Math.floor(c.atSec), last + 1);
    lines.push(`${formatTimestamp(sec)} ${c.title}`);
    last = sec;
  }
  if (lines.length < 3) return "";
  if (!lines[0].startsWith("0:00 ")) {
    lines[0] = `0:00 ${stamped[0].title}`;
  }
  return lines.join("\n");
}

export function buildYouTubeMeta(input: SocialCopyInput): {
  title: string;
  description: string;
  tags: string;
} {
  const stat = buildStatLine(input);
  const title = clampAtWordBoundary(
    `${input.title} — automated visual regression test on ${input.domain}`,
    YT_TITLE_LIMIT,
  );

  const parts: string[] = [];
  parts.push(
    `Automated visual regression run on ${input.domain}: ${stat}. Recorded end-to-end with Lastest — every step captured, screenshotted, and diffed against the baseline.`,
  );
  if (input.uxSummary) parts.push(input.uxSummary);

  const chapterBlock = buildYouTubeChapters(input.chapters);
  if (chapterBlock) parts.push(`Chapters:\n${chapterBlock}`);

  if (input.highlights.length > 0) {
    const bullets = input.highlights
      .slice(0, 5)
      .map((h) => `• ${h.label} — ${h.note}`)
      .join("\n");
    parts.push(`Highlights:\n${bullets}`);
  }

  parts.push(
    `Full interactive report (diff sliders, per-step screenshots, a11y + perf checks):\n${input.shareUrl}`,
  );
  parts.push(
    `Built with Lastest — open-source visual regression testing.\nhttps://lastest.cloud`,
  );
  parts.push(`#VisualTesting #QA #WebDev #Automation`);

  const description = clampAtWordBoundary(
    parts.join("\n\n"),
    YT_DESCRIPTION_LIMIT,
  );

  const tagList = [
    "visual regression testing",
    "automated testing",
    "qa automation",
    "ui testing",
    "playwright",
    "web development",
    "lastest",
    input.domain,
  ];
  let tags = "";
  for (const t of tagList) {
    const next = tags ? `${tags}, ${t}` : t;
    if (next.length > YT_TAGS_LIMIT) break;
    tags = next;
  }

  return { title, description, tags };
}

// --- TikTok -------------------------------------------------------------------

export function buildTikTokCaption(input: SocialCopyInput): string {
  const stat = buildStatLine(input);
  const hook =
    input.variant === "test" && input.pixelsChanged > 0
      ? `This test just caught a UI change before users did 👀`
      : input.variant === "build" && input.changesDetected > 0
        ? `${input.changesDetected} UI change${input.changesDetected === 1 ? "" : "s"} caught before shipping 👀`
        : `Watch a robot regression-test ${input.domain} in seconds 🤖`;
  const summary = input.uxSummary ? `\n${input.uxSummary}` : "";
  const hashtags =
    "#visualtesting #qa #webdev #devtools #softwaretesting #automation #tech #programming";
  const caption = `${hook}\n\n${input.title} on ${input.domain} — ${stat}.${summary}\n\nFull interactive report 👉 ${input.shareUrl}\n\n${hashtags}`;
  return clampAtWordBoundary(caption, TIKTOK_LIMIT);
}

// --- LinkedIn -----------------------------------------------------------------

// Longer-form professional post. Fed to LinkedIn's still-working prefill URL
// (/feed/?shareActive=true&text=...), which opens the composer with this text
// filled in; LinkedIn unfurls the trailing share URL into the OG card.
export function buildLinkedInPost(input: SocialCopyInput): string {
  const stat = buildStatLine(input);
  const parts: string[] = [
    `${verdictEmoji(input)} ${input.title} on ${input.domain} — ${stat}.`,
    input.variant === "build"
      ? `Every release gets recorded, screenshotted, and diffed against baseline automatically — this is one build's report.`
      : `This flow is recorded once, then re-run and pixel-diffed against baseline on every build.`,
  ];
  if (input.uxSummary) parts.push(input.uxSummary);
  parts.push(
    `Full interactive report (recording, diff sliders, a11y + perf checks): ${input.shareUrl}`,
  );
  parts.push(`#VisualTesting #QA #WebDev #Automation`);
  return clampAtWordBoundary(parts.join("\n\n"), LINKEDIN_LIMIT);
}

export function buildSocialCopy(input: SocialCopyInput): SocialCopy {
  return {
    x: buildXPost(input),
    youtube: buildYouTubeMeta(input),
    tiktok: buildTikTokCaption(input),
    linkedin: buildLinkedInPost(input),
  };
}
