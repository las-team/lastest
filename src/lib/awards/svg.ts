import type { AwardTier } from "@/lib/db/schema";

// ============================================================
// Lastest badge SVG renderer, matches the embeddable-badge design
// (split-shield: shields.io idiom, Lastest skin).
//
// All SVGs are self-contained: no external fonts, no images, no styles
// referencing the host page. Fonts are stack-only fallbacks because
// third-party sites won't have Inter / JetBrains Mono loaded.
//
// Character widths are approximated; shields.io does the same.
// ============================================================

export type Tone = "teal" | "red" | "amber" | "blue" | "ink" | "slate";
export type Size = "sm" | "md" | "lg";

export interface SplitShieldOptions {
  label: string;
  value: string;
  tone: Tone;
  size?: Size;
  dark?: boolean;
  /** include the Delta Mark glyph in the label cell */
  mark?: boolean;
  /** small white dot in the value cell, used for the "running" indicator */
  dot?: boolean;
}

const TONE_FILL: Record<Tone, string> = {
  teal: "#36A88E",
  red: "#E03E36",
  amber: "#E09836",
  blue: "#3674A8",
  ink: "#1F2A33",
  // Slate sits between ink and white: signals "starter" without competing
  // with the precious-metal tiers visually.
  slate: "#7A8691",
};

// Heights / paddings / font sizes from badges.jsx (the design source-of-truth).
const SIZES = {
  sm: { h: 20, padX: 8, gap: 6, labelFs: 9.5, valueFs: 11, markSize: 11 },
  md: { h: 26, padX: 10, gap: 7, labelFs: 10.5, valueFs: 12.5, markSize: 14 },
  lg: { h: 34, padX: 14, gap: 9, labelFs: 12.5, valueFs: 15, markSize: 18 },
} as const;

// Approximate character widths. Mono is uppercase-ish (label has 0.08em
// letter-spacing → wider), sans is mixed case. Tuned to look right at md.
function labelTextWidth(text: string, fs: number): number {
  // Mono uppercase + letter-spacing 0.08em: ~0.62×fs per char.
  return Math.ceil(text.length * fs * 0.62);
}

function valueTextWidth(text: string, fs: number): number {
  // Inter medium mixed case: ~0.56×fs per char.
  return Math.ceil(text.length * fs * 0.56);
}

function deltaMarkSvg(
  size: number,
  x: number,
  y: number,
  tone: "light" | "dark",
): string {
  // The design's DeltaMark, a 200x200 viewBox glyph. Scale by `size/200`.
  // "light" tone is used on dark backgrounds (the label cell).
  // We always render the brand-red inner square; the strokes flip with tone.
  const stroke = tone === "light" ? "#FFFFFF" : "#1F2A33";
  const inner = tone === "light" ? "#FFFFFF" : "#1F2A33";
  const s = size;
  // Use SVG nested via <g transform> for scaling.
  const scale = s / 200;
  return `<g transform="translate(${x},${y}) scale(${scale})" aria-hidden="true">
    <rect x="34" y="34" width="110" height="110" fill="none" stroke="${stroke}" stroke-width="6"/>
    <rect x="56" y="56" width="110" height="110" fill="#E03E36"/>
    <rect x="56" y="56" width="88" height="88" fill="${inner}"/>
    <path d="M 70 34 L 80 18 L 90 34 Z" fill="${stroke}"/>
    <path d="M 110 34 L 120 18 L 130 34 Z" fill="${stroke}"/>
  </g>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSplitShield(opts: SplitShieldOptions): string {
  const size = opts.size ?? "md";
  const dark = opts.dark ?? false;
  const mark = opts.mark ?? true;
  const dot = opts.dot ?? false;
  const cfg = SIZES[size];

  const labelText = opts.label.toUpperCase();
  const valueText = opts.value;

  const markBox = mark ? cfg.markSize + cfg.gap : 0;
  const dotBox = dot ? 7 + cfg.gap : 0;
  const labelInner = labelTextWidth(labelText, cfg.labelFs);
  const valueInner = valueTextWidth(valueText, cfg.valueFs);

  const labelW = cfg.padX * 2 + markBox + labelInner;
  const valueW = cfg.padX * 2 + dotBox + valueInner;
  const totalW = labelW + valueW;
  const h = cfg.h;

  const labelBg = dark ? "#0E1519" : "#1F2A33";
  const valueBg = TONE_FILL[opts.tone];
  const valueFg = opts.tone === "amber" ? "#1F2A33" : "#FFFFFF";

  // Subtle shadow (dark sites use an inner ring, light sites a drop shadow).
  const filterId = `lt-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const shadowDef = dark
    ? ""
    : `<filter id="${filterId}" x="0" y="0" width="${totalW}" height="${h + 2}">
        <feDropShadow dx="0" dy="1" stdDeviation="0" flood-color="#1F2A33" flood-opacity="0.10"/>
      </filter>`;
  const shadowAttr = dark ? "" : ` filter="url(#${filterId})"`;
  const darkRing = dark
    ? `<rect x="0.5" y="0.5" width="${totalW - 1}" height="${h - 1}" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1" rx="2.5"/>`
    : "";

  const labelTextX = cfg.padX + markBox;
  const labelTextY = h / 2 + cfg.labelFs * 0.35;
  const valueTextX = labelW + cfg.padX + dotBox;
  const valueTextY = h / 2 + cfg.valueFs * 0.35;

  // Use single quotes inside the font-family value so they survive being
  // embedded inside double-quoted SVG attributes.
  const monoFont = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
  const sansFont =
    "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  const markGlyph = mark
    ? deltaMarkSvg(cfg.markSize, cfg.padX, (h - cfg.markSize) / 2, "light")
    : "";
  const dotGlyph = dot
    ? `<circle cx="${labelW + cfg.padX + 3.5}" cy="${h / 2}" r="3.5" fill="#FFFFFF"/>
       <circle cx="${labelW + cfg.padX + 3.5}" cy="${h / 2}" r="6" fill="#FFFFFF" fill-opacity="0.35"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}" role="img" aria-label="${escapeXml(`${labelText}: ${valueText}`)}">
  <title>${escapeXml(`${labelText}: ${valueText}`)}</title>
  <defs>
    ${shadowDef}
    <clipPath id="${filterId}-clip">
      <rect width="${totalW}" height="${h}" rx="3"/>
    </clipPath>
  </defs>
  <g${shadowAttr} clip-path="url(#${filterId}-clip)">
    <rect width="${labelW}" height="${h}" fill="${labelBg}"/>
    <rect x="${labelW}" width="${valueW}" height="${h}" fill="${valueBg}"/>
    ${markGlyph}
    <text x="${labelTextX}" y="${labelTextY}" font-family="${monoFont}" font-size="${cfg.labelFs}" font-weight="600" letter-spacing="0.08em" fill="#FFFFFF">${escapeXml(labelText)}</text>
    ${dotGlyph}
    <text x="${valueTextX}" y="${valueTextY}" font-family="${sansFont}" font-size="${cfg.valueFs}" font-weight="500" fill="${valueFg}">${escapeXml(valueText)}</text>
    ${darkRing}
  </g>
</svg>`;
}

// ============================================================
// Convenience renderers tied to the awards model
// ============================================================

const TIER_LABEL: Record<AwardTier, { value: string; tone: Tone }> = {
  none: { value: "not yet", tone: "ink" },
  starter: { value: "starter", tone: "slate" },
  bronze: { value: "bronze", tone: "amber" },
  silver: { value: "silver", tone: "blue" },
  gold: { value: "gold", tone: "teal" },
};

export function renderTierBadge(
  tier: AwardTier,
  size: Size = "md",
  dark = false,
): string {
  const m = TIER_LABEL[tier];
  return renderSplitShield({
    label: "LASTEST",
    value: m.value,
    tone: m.tone,
    size,
    dark,
    mark: true,
  });
}

export function renderA11yBadge(
  passing: boolean,
  size: Size = "md",
  dark = false,
): string {
  return renderSplitShield({
    label: "a11y",
    value: passing ? "WCAG AA" : "review",
    tone: passing ? "teal" : "amber",
    size,
    dark,
    mark: false,
  });
}

export function renderAllPassingBadge(
  passing: boolean,
  total: number,
  size: Size = "md",
  dark = false,
): string {
  return renderSplitShield({
    label: "tests",
    value: passing ? `${total} / ${total}` : `${total} fail`,
    tone: passing ? "teal" : "red",
    size,
    dark,
    mark: false,
  });
}

export function renderZeroDriftBadge(
  clean: boolean,
  size: Size = "md",
  dark = false,
): string {
  return renderSplitShield({
    label: "regressions",
    value: clean ? "0" : "1+",
    tone: clean ? "ink" : "red",
    size,
    dark,
    mark: false,
  });
}

export function renderRegressionBadge(size: Size = "md", dark = false): string {
  return renderSplitShield({
    label: "LASTEST",
    value: "1 regression",
    tone: "red",
    size,
    dark,
    mark: true,
  });
}

export function renderReviewRequiredBadge(
  size: Size = "md",
  dark = false,
): string {
  return renderSplitShield({
    label: "LASTEST",
    value: "review required",
    tone: "amber",
    size,
    dark,
    mark: true,
  });
}

/**
 * Placeholder rendered when a slug has no associated repo award yet (or the
 * repo has zero builds). Gray ink, no tone color.
 */
export function renderPendingBadge(size: Size = "md", dark = false): string {
  return renderSplitShield({
    label: "LASTEST",
    value: "pending",
    tone: "ink",
    size,
    dark,
    mark: true,
  });
}
