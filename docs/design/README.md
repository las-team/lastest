# Lastest Design System

Renewed visual system for **Lastest** — free, open-source visual regression testing platform for self-hosted teams. Anchored on the new "Delta Mark" logo and a five-stop split-complementary palette.

## Sources

- **`uploads/lasTest export kit-print.html`** — the authoritative export kit defining the Delta Mark, the 5-color palette, surfaces, type lockups, and clear-space rules.
- **`uploads/lasTest — logo Delta Mark kit.pdf`** — companion PDF.
- **GitHub: `las-team/lastest`** — the existing Next.js application code (Tailwind v4, Radix UI, lucide-react). Imported logo assets from `public/icon-{light,dark}.svg`. The current app uses a teal/cyan primary; this design system **renews** that to the Delta Mark brand: red is reserved for the mark + regression alerts, **teal/blue drive primary actions**, and the bright soft-neutral becomes the standard surface.

## Direction (from user)

1. **Logo unchanged** — Delta Mark stays exactly as designed.
2. **Bold display font reserved for the logo only** — Archivo Black is used for the wordmark; everything else uses **Inter** (thinner sans).
3. **Bright surfaces are standard** — `#F6F6F4` (was `lab(96.52 0 0)`) is the default app background, not red.
4. **Non-red colors drive actions** — Teal `#36A88E` (primary CTA), Steel Blue `#3674A8` (secondary/links). Red is reserved for the brand mark and destructive/regression states.

## Index

- `assets/` — Delta Mark SVGs (`delta-mark.svg`, `delta-mark-dark.svg`, `delta-mark-mono.svg`), original icon export from the repo
- `colors_and_type.css` — token definitions (CSS custom properties) for color, type, spacing, radii, motion. Import this in any HTML artifact.
- `preview/` — small HTML cards that render in the Design System tab (palette swatches, type specimens, components, etc.)
- `ui_kits/app/` — high-fidelity recreation of the Lastest web app, **renewed** with this design system
- `SKILL.md` — entry point for invoking this as a skill

## CONTENT FUNDAMENTALS

**Voice.** Direct, technical, slightly proud. Lastest writes like a senior engineer demoing their own tool — confident about specifics, dismissive of bloat. The README opens with a problem statement (visual regression testing is "**expensive**, **flaky**, or **painful to maintain**") and pivots to a clear solution. Marketing tagline: "Record it. Test it. Ship it. — $0 forever."

**Casing.**
- **Sentence case** for headings, body, and button labels: "Record a test", "Run all tests", "Approve baseline".
- **Lowercase** for nav items in the sidebar: "Dashboard", "Tests", "Compose", "Runs", "Compare".
- **UPPERCASE MONO** for eyebrows, labels above content, and badges in the print kit ("PRIMARY · LIGHT", "★ COLOR SYSTEM").
- **`LASTEST`** wordmark is always uppercase, with the **T** in `--c-red`.

**Pronouns.** "You" — second person. "Your data stays on your server. Your screenshots never leave your infra." Never "we".

**Tone hits.**
- Numbers as proof: "29 tools", "11-step pipeline", "3 diff engines", "$0 forever", "WCAG 2.2 AA · 0–100 score".
- Mode names get a confident verb: "Record. Test. Ship.", "Plan · Generate · Heal".
- Status copy is terse: `safe_to_merge`, `review_required`, `blocked`, `flaky`, `passed`.
- Self-aware tagline at the foot of the README: built for solo founders who ship fast and break things.

**Emoji.** Effectively no. The print kit uses a single retro `★` glyph (Press Start 2P) as a brand flourish on eyebrows; never anywhere else. The CLI uses `→` and `↳` as terminal cues, and `✦` as a regression marker. **Do not** add 🎉 / 🚀 / ✨ etc. — they break the tone.

**Examples to copy from.**
- "Did my last commit break the UI?" — questions are okay; they sound like a developer talking.
- "Build once, run forever — $0" — em-dash + price tag is on-brand.
- "You own the test code and can edit it by hand." — empowerment over magic.

## VISUAL FOUNDATIONS

**Palette anchor.** Five stops on a wheel — split-complementary around red. Red `#E03E36` is the brand. Amber `#E09836` is the analogous warm partner. Teal `#36A88E` and Steel Blue `#3674A8` are the cool split-complement and carry the actionable / informational weight. Ink `#1F2A33` is a cool-tinted near-black for type and dark surfaces.

**Surfaces.** Three neutrals: pure White (high-contrast UIs, code blocks), **Soft `#F6F6F4`** (the standard app background — what was `lab(96.52 0 0)` in the print kit), and Warm Paper `#F6F4EF` (marketing pages, print docs). On dark, surfaces flip to Ink with a slightly lifted card surface `#2A3640`.

**Recommended ratio.** ~60% neutrals, ~18% Ink (type/borders), ~12% Red (mark + regression flag), ~5% Amber, ~3% Teal, ~2% Blue. Action surfaces (primary CTAs) shift teal weight up — but **never** push red above the brand-flourish allotment.

**Type.** Archivo Black is locked to the wordmark. Inter does the heavy lifting (300/400/500/600). JetBrains Mono is for code, eyebrow labels, terminal output, and tabular numbers. Tracking is tight on display sizes (`-0.02em` → `-0.04em`); generous (`+0.08em`, uppercase) on mono labels.

**Backgrounds.** Mostly flat. Soft `#F6F6F4` fills the canvas; cards sit on white. **No gradients** — the print kit explicitly rules them out for the mark, and the app follows suit. No hand-drawn illustrations, no repeating textures. The one allowed flourish is a 1px dashed Ink line for clear-space / annotation diagrams. Imagery is rare; when present (screenshots, diff thumbnails), it stays cool/neutral and is framed by a hairline border.

**Animation.** Restrained. Default duration `180ms` with `cubic-bezier(.2, .7, .2, 1)` (snappy ease-out). Sidebar nav items, buttons, and link underlines fade. Status icons spin (`Loader2`) only when something is actively running. Progress bars use a 1.5s shimmer. **No bounces, no parallax.**

**Hover states.** Buttons darken ~10% (`color-mix` or `/0.9`). Sidebar/nav items drop a `bg-muted` hint. Links grow a 1px solid underline (no color shift). Cards lift via `--shadow-md` on hover when they're clickable.

**Press states.** No shrink. Press flips to a slightly darker fill (`/0.85`) and the focus-visible ring (3px amber-tinted) appears.

**Borders.** Hairline `rgba(31,42,51,0.08)` is everywhere — cards, inputs, list rows, table cells. `rgba(31,42,51,0.16)` is the "strong" variant for emphasis (selected states). Borders almost never colored — color is reserved for fills.

**Shadows.** Four-tier subtle system. `--shadow-xs` for inputs at rest; `--shadow-sm` for resting cards; `--shadow-md` for hovered/elevated; `--shadow-lg` for popovers and dialogs. All shadows use Ink at 5–12% opacity — never colored.

**Protection.** No protection gradients. Use solid surface fills under the mark (white / soft / paper / ink), with `1× ear-height` clear space on every side per the print kit's clear-space rule.

**Layout rules.** App shell is fixed: 256px sidebar, content area fluid. Cards have 24px (`--space-5`) inner padding. Sections separate by 24–32px vertical rhythm. The 8-pt grid is enforced (`--space-1..8` map to 4/8/12/16/24/32/48/64 px).

**Transparency / blur.** Blur is rare. Used on dialog backdrops (`backdrop-filter: blur(4px)` over Ink at 40%) and nowhere else. Translucent fills appear in tags/badges (color at 12% opacity) and skeleton states.

**Imagery vibe.** When real product screenshots appear, they are **cool, sharp, neutral** — no warm filters, no grain, no decorative crops. Diff thumbnails are pixel-grid framed in hairline borders.

**Corner radii.** Industrial. `--r-md: 8px` is the default for cards, inputs, buttons. Badges use `--r-pill`. The Delta Mark itself is **always 0 radius** — sharp corners are core to the identity.

**Cards.** White surface, hairline border, `--shadow-sm` at rest, `--shadow-md` on hover, 8px radius, 24px padding. No colored left-border accents (avoided per AI-slop guidance and not present in the source code).

## ICONOGRAPHY

The Lastest codebase uses **`lucide-react@^0.562`** as its icon system — `LayoutDashboard`, `FileCode`, `Play`, `GitCompare`, `Settings`, `Layers`, `Building2`, `TrendingDown`, `Trophy`, `CheckCircle`, `XCircle`, `Clock`, `AlertTriangle`, `Loader2`, `Shield`, `Activity`, `Zap`, `Folder` are the in-use set as of the imported sidebar/dashboard. Default size `h-4 w-4` (16px) inline; `h-5 w-5` (20px) for stat-card titles.

**For HTML/static artifacts in this design system:** load Lucide from CDN — `https://unpkg.com/lucide@latest/dist/umd/lucide.js` — and use the same icon names. This matches the codebase exactly (no substitution needed).

**Stroke style.** Lucide's default — 2px stroke, 24px viewBox, rounded line caps and joins, mostly outline. **Never** mix outline + filled icon styles in the same view.

**SVG assets.** The Delta Mark itself ships as a hand-authored SVG (`assets/delta-mark*.svg`) — 5 rectangles + 2 triangle "ears" — never recreated as PNG except for favicons. The legacy `assets/logo.png` (cat-mascot icon) is preserved as historical reference but **not used** in the renewed system.

**Emoji.** Not used. (See CONTENT FUNDAMENTALS.)

**Unicode glyphs.** A small allowed set borrowed from the print kit: `★` (brand flourish on rare eyebrows), `→` `↳` (CLI output), `✦` (regression marker in CLI), `·` (key/value separators in mono labels). That's the entire allowed set.

---

Built for solo founders who ship fast and break things — then catch the regression before users notice.
