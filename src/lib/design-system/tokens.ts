/**
 * Design-system token parsing + value normalization.
 *
 * The user supplies a CSS file (or a literal `:root { ... }` block) with
 * custom-property declarations on the Setup page. This module turns that
 * into a {@link DesignSystemConfig} the EB harvester can match computed
 * styles against.
 *
 * Categorization is heuristic-by-value rather than by name (designers
 * spell their custom-property names a thousand ways; CSS values are
 * predictable). A property whose value parses as a color goes into the
 * color bucket; one that parses as `<int>px` goes into either radii or
 * spacing depending on its custom-property name; etc.
 */

import type {
  DesignSystemConfig,
  DesignSystemGroups,
  DesignRoleToken,
  DesignToken,
  DesignTokenCategory,
} from '@/lib/db/schema';

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i;

/** Lowercase + collapse internal whitespace so 'rgba( 255, 0, 0 )' and
 *  'rgba(255,0,0)' compare equal in the EB-side harvester. */
function compact(v: string): string {
  return v.replace(/\s+/g, '').toLowerCase();
}

/** Normalize a CSS color literal to lowercase 6-digit hex (`#rrggbb`) or
 *  8-digit hex (`#rrggbbaa`). Returns null if the value isn't a color. */
export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'transparent') return '#00000000';
  // 3-, 4-, 6-, 8-digit hex
  const hex = v.match(HEX_RE);
  if (hex) {
    const body = hex[1];
    if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
    if (body.length === 4) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}${body[3]}${body[3]}`;
    if (body.length === 6) return `#${body}`;
    if (body.length === 8) return `#${body}`;
    return null;
  }
  const rgb = v.match(RGB_RE);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    const a = rgb[4] !== undefined ? Math.round(parseFloat(rgb[4]) * 255) : null;
    const hh = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return a === null ? `#${hh(r)}${hh(g)}${hh(b)}` : `#${hh(r)}${hh(g)}${hh(b)}${hh(a)}`;
  }
  return null;
}

/** Normalize a length-ish value to integer px. */
export function normalizePx(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === '0px') return '0px';
  const m = v.match(/^(-?\d+(?:\.\d+)?)(px|rem|em)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'px';
  // The EB samples computed styles which always come back as px. We treat
  // rem/em on the config side as relative to a 16px base — matches the
  // CSS default and the Lastest design-system spec.
  const px = unit === 'px' ? n : n * 16;
  return `${Math.round(px)}px`;
}

/** First font in a `font-family` stack, lowercased without quotes. */
export function normalizeFontFamily(raw: string): string | null {
  const first = raw.split(',')[0]?.trim();
  if (!first) return null;
  return compact(first.replace(/['"]/g, ''));
}

const SPACING_HINTS = ['space', 'spacing', 'gap', 'margin', 'padding', 'inset'];
const RADIUS_HINTS = ['radius', 'radii', 'r-xs', 'r-sm', 'r-md', 'r-lg', 'r-pill', '-r-'];
const FONT_SIZE_HINTS = ['font-size', 'fontsize', 'size-', 't-xs', 't-sm', 't-md', 't-lg', 't-xl', 't-2xl', 't-3xl', 't-4xl', 't-base'];

function classifyByName(name: string): DesignTokenCategory | null {
  const n = name.toLowerCase();
  if (RADIUS_HINTS.some((h) => n.includes(h))) return 'border-radius';
  if (FONT_SIZE_HINTS.some((h) => n.includes(h))) return 'font-size';
  if (SPACING_HINTS.some((h) => n.includes(h))) return 'spacing';
  return null;
}

/**
 * Parse the user-supplied CSS into a {@link DesignSystemConfig}.
 *
 * Accepts either a full CSS document or just the custom-property body. We
 * grep for `--ident: value;` declarations across the document (any
 * selector) — the Lastest design system ships ~50 of them in
 * `colors_and_type.css` and the simplest UX is for the user to paste the
 * whole file.
 */
export function parseDesignSystemCss(css: string): DesignSystemConfig {
  const tokens: Partial<Record<DesignTokenCategory, DesignToken[]>> = {};
  const seen: Partial<Record<DesignTokenCategory, Set<string>>> = {};

  const pushToken = (cat: DesignTokenCategory, name: string, value: string) => {
    if (!seen[cat]) seen[cat] = new Set();
    if (seen[cat]!.has(value)) return;
    seen[cat]!.add(value);
    if (!tokens[cat]) tokens[cat] = [];
    tokens[cat]!.push({ name, value });
  };

  // ---- Pass 1: collect every `--name: value;` declaration ---------------
  // A token name can carry MULTIPLE raw values across selectors —
  // typically `:root` (light) + `.dark` (dark mode override). The matcher
  // wants every variant in the allowed set (the EB walking a dark-themed
  // page should still see on-token values), so we accumulate per-name
  // lists instead of overwriting. Preview grouping then uses the first
  // (root) value per name so the swatches show light-mode tokens.
  const rawDecls = new Map<string, string[]>();
  const decl = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(css)) !== null) {
    const key = `--${m[1]}`;
    const val = m[2].trim();
    const existing = rawDecls.get(key);
    if (existing) existing.push(val); else rawDecls.set(key, [val]);
  }

  // ---- Pass 2: resolve `var()` references to literals -------------------
  // `--action: var(--c-teal);` chases `--c-teal: #36A88E;` (first
  // declaration, i.e. the `:root` value) and ends up as `#36A88E`.
  // Bounded recursion (10 hops) so a malicious cycle can't infinite-loop
  // the parser.
  const resolve = (raw: string, depth = 0): string | null => {
    if (depth > 10) return null;
    const trimmed = raw.trim();
    const varMatch = trimmed.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\s*\)$/);
    if (!varMatch) return trimmed;
    const referencedList = rawDecls.get(varMatch[1]);
    if (referencedList && referencedList.length > 0) return resolve(referencedList[0], depth + 1);
    if (varMatch[2]) return resolve(varMatch[2], depth + 1);
    return null;
  };

  // First resolved value per name — drives display grouping.
  const resolvedPrimary = new Map<string, string>();

  // ---- Pass 3: bucket literals into matcher categories ------------------
  for (const [name, rawValues] of rawDecls) {
    for (let i = 0; i < rawValues.length; i++) {
      const r = resolve(rawValues[i]);
      if (r === null) continue;
      if (i === 0) resolvedPrimary.set(name, r);

      const asColor = normalizeColor(r);
      if (asColor) {
        pushToken('color', name, asColor);
        continue;
      }
      const asPx = normalizePx(r);
      if (asPx) {
        const cat = classifyByName(name.replace(/^--/, ''));
        if (cat) pushToken(cat, name, asPx);
        continue;
      }
      if (r.includes(',') || /^['"]?[a-z]/i.test(r)) {
        const family = normalizeFontFamily(r);
        if (family) {
          const bare = name.replace(/^--/, '');
          if (bare.includes('font') || bare.includes('family')) {
            pushToken('font-family', name, family);
          }
        }
      }
    }
  }

  // ---- Pass 4: build display groups for the Setup-tab preview -----------
  const groups = buildGroups(resolvedPrimary);

  return { tokens, groups };
}

// ── Display grouping ─────────────────────────────────────────────────────
// We bucket tokens by name pattern into the seven display sections shown
// in the Claude Design "Your design system is ready" screen. The matcher
// never reads these; they exist purely so the Setup preview can render
// "Brand palette / Surfaces / Semantic / Type scale / …" instead of one
// flat list.

const BRAND_HUES = ['red', 'amber', 'orange', 'teal', 'green', 'blue', 'cyan', 'indigo', 'purple', 'violet', 'pink', 'rose', 'yellow', 'ink', 'black', 'white'] as const;
const ROLE_BY_HUE: Record<string, string> = {
  red: 'BRAND', brand: 'BRAND',
  amber: 'ACCENT', orange: 'ACCENT', yellow: 'ACCENT', accent: 'ACCENT', warning: 'ACCENT',
  teal: 'ACTION', green: 'ACTION', action: 'ACTION', success: 'ACTION',
  blue: 'INFO', cyan: 'INFO', indigo: 'INFO', info: 'INFO',
  ink: 'TYPE', text: 'TYPE',
};

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameSuffix(fullName: string): string {
  // `--c-red` → `red`, `--brand-primary` → `brand primary`
  return fullName.replace(/^--/, '').replace(/^c-/, '').replace(/^font-/, '').replace(/^t-/, 'type ').replace(/^r-/, 'r ').replace(/^space-/, 'space ');
}

function buildGroups(resolved: Map<string, string>): DesignSystemGroups {
  const brandPalette: DesignRoleToken[] = [];
  const surfaces: DesignRoleToken[] = [];
  const inkScale: DesignRoleToken[] = [];
  const semantic: DesignRoleToken[] = [];
  const radii: DesignRoleToken[] = [];
  const spacing: DesignRoleToken[] = [];
  const typeScale: DesignRoleToken[] = [];
  const fonts: DesignRoleToken[] = [];

  for (const [name, value] of resolved) {
    const bare = name.replace(/^--/, '').toLowerCase();
    const asColor = normalizeColor(value);
    const asPx = normalizePx(value);

    // ── Colors ──
    if (asColor) {
      const tok: DesignRoleToken = { name, value: asColor, label: titleCase(nameSuffix(name)) };

      // Surfaces — neutrals that aren't part of the brand wheel.
      if (/^(c-)?(white|paper|surface|neutral|light|dark|soft(-\d+)?)$/.test(bare) || bare.includes('-surface') || bare.includes('-paper')) {
        surfaces.push(tok);
        continue;
      }
      // Ink scale (text color tokens).
      if (/^(fg|text|ink-\d+|fg-\d+)/.test(bare)) {
        // `--fg-1`, `--fg-on-dark-1`, etc — ink scale.
        if (bare !== 'ink' && !bare.startsWith('c-ink')) {
          inkScale.push(tok);
          continue;
        }
      }
      // Semantic aliases: --action, --danger, --success, --warning, --info,
      // --accent, --brand, --bg, --border, --ring. These were typically
      // declared as `var(--c-X)` and resolved in Pass 2.
      if (/^(action|action-hover|action-secondary|action-secondary-hover|accent|brand|danger|warning|success|info|bg|bg-elevated|bg-inverted|border|border-strong|ring)/.test(bare)) {
        tok.role = bare.split('-')[0].toUpperCase();
        semantic.push(tok);
        continue;
      }
      // Brand palette — five-stop core colors (`--c-red` / `--c-teal` / …).
      const hue = BRAND_HUES.find((h) => bare === `c-${h}` || bare === h || bare === `brand-${h}`);
      if (hue) {
        tok.role = ROLE_BY_HUE[hue] ?? hue.toUpperCase();
        tok.label = titleCase(hue);
        brandPalette.push(tok);
        continue;
      }
      // Unclassified color — drop into semantic as a safe default.
      semantic.push(tok);
      continue;
    }

    // ── Px-valued tokens: radii / spacing / type-scale ──
    if (asPx) {
      const cat = classifyByName(bare);
      const tok: DesignRoleToken = { name, value: asPx, label: titleCase(nameSuffix(name)) };
      if (cat === 'border-radius') radii.push(tok);
      else if (cat === 'spacing') spacing.push(tok);
      else if (cat === 'font-size') typeScale.push(tok);
      continue;
    }

    // ── Fonts ──
    if ((value.includes(',') || /^['"]?[a-z]/i.test(value)) && (bare.includes('font') || bare.includes('family'))) {
      const family = normalizeFontFamily(value);
      if (family) {
        fonts.push({ name, value: family, label: titleCase(nameSuffix(name)) });
      }
    }
  }

  // Sort px-valued groups by ascending value so the preview reads xs → lg.
  const byPx = (a: DesignRoleToken, b: DesignRoleToken) => parseFloat(a.value) - parseFloat(b.value);
  radii.sort(byPx);
  spacing.sort(byPx);
  typeScale.sort(byPx);

  return {
    brandPalette: brandPalette.length ? brandPalette : undefined,
    surfaces: surfaces.length ? surfaces : undefined,
    inkScale: inkScale.length ? inkScale : undefined,
    semantic: semantic.length ? semantic : undefined,
    radii: radii.length ? radii : undefined,
    spacing: spacing.length ? spacing : undefined,
    typeScale: typeScale.length ? typeScale : undefined,
    fonts: fonts.length ? fonts : undefined,
  };
}

// System font keywords that DON'T need to be uploaded — anything else in
// a font-family value is a custom face the bundle should ship.
const SYSTEM_FONT_KEYWORDS = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto',
  'helvetica', 'arial', 'sans-serif', 'serif', 'monospace', 'menlo', 'monaco',
  'consolas', 'courier new', 'courier', 'ui-monospace', 'ui-sans-serif',
  'ui-serif', 'ui-rounded', 'sf mono', 'liberation mono', 'apple color emoji',
  'noto color emoji', 'segoe ui emoji', 'segoe ui symbol', 'inherit', 'initial',
  'unset',
]);

/** Detect when a parsed bundle references custom font families but the
 *  archive didn't ship the font files. The Setup preview renders a
 *  "Missing brand fonts" warning when this returns true. */
export function detectMissingFonts(config: DesignSystemConfig | null): string[] {
  if (!config?.groups?.fonts) return [];
  if (config.meta?.hasFontFiles) return [];
  const missing = new Set<string>();
  for (const tok of config.groups.fonts) {
    const name = tok.value.toLowerCase().trim();
    if (!name) continue;
    if (SYSTEM_FONT_KEYWORDS.has(name)) continue;
    missing.add(tok.value);
  }
  return Array.from(missing);
}

/**
 * Merge a per-test override on top of a repo-level config. Per-category
 * tokens replace the parent's tokens (so a test can scope down) when the
 * override provides any tokens in that category — otherwise the parent
 * stays. `enabled` and `ignoredCategories` honor override semantics.
 */
export function mergeDesignSystemConfig(
  base: DesignSystemConfig | null | undefined,
  override: Partial<DesignSystemConfig> | null | undefined,
): DesignSystemConfig | null {
  if (!base && !override) return null;
  const merged: DesignSystemConfig = {
    enabled: override?.enabled ?? base?.enabled,
    tokens: { ...(base?.tokens ?? {}) },
    ignoredCategories: override?.ignoredCategories ?? base?.ignoredCategories,
    maxViolationsPerScreenshot:
      override?.maxViolationsPerScreenshot ?? base?.maxViolationsPerScreenshot,
    // Groups/meta come from the parser at ingest time; per-test overrides
    // typically don't ship a fresh group set, so prefer the override only
    // when it explicitly provides one.
    groups: override?.groups ?? base?.groups,
    meta: override?.meta ?? base?.meta,
  };
  if (override?.tokens) {
    for (const [cat, list] of Object.entries(override.tokens) as Array<[
      DesignTokenCategory,
      DesignToken[] | undefined,
    ]>) {
      if (Array.isArray(list) && list.length > 0) {
        merged.tokens[cat] = list;
      }
    }
  }
  return merged;
}

/** True if a config carries at least one allowed value for any category.
 *  The EB short-circuits the harvester when this returns false. */
export function isConfigUsable(c: DesignSystemConfig | null): boolean {
  if (!c) return false;
  const entries = Object.entries(c.tokens ?? {});
  return entries.some(([, list]) => Array.isArray(list) && list.length > 0);
}
