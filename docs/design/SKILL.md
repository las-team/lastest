---
name: Lastest design system
description: Visual + content rules for Lastest, the free open-source visual regression testing platform. Anchored on the Delta Mark logo + 5-stop split-complementary palette.
---

# Lastest design system

When designing for **Lastest**, follow the rules in `README.md`. Highlights:

## Hard rules

1. **The Delta Mark logo never changes.** Use `assets/delta-mark.svg` (light surfaces), `assets/delta-mark-dark.svg` (Ink/dark surfaces), or `assets/delta-mark-mono.svg` (single-color contexts). Never recreate it from scratch.
2. **Display font is logo-only.** `Archivo Black 900` is locked to the wordmark `LAS<span class="t">T</span>EST`. Everything else uses **Inter**.
3. **Soft `#F6F6F4` is the standard app background.** Not red, not white. Pure white is for cards on top of soft.
4. **Non-red drives action.** Teal `#36A88E` = primary CTA. Steel Blue `#3674A8` = secondary/links. Red `#E03E36` is **only** for the brand mark and destructive/regression states.
5. **No gradients, no emoji, no colored borders.** Hairline `rgba(31,42,51,0.08)` borders. Solid fills. Subtle Ink-tinted shadows.

## Setup

```html
<link rel="stylesheet" href="colors_and_type.css">
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<!-- ... -->
<script>lucide.createIcons();</script>
```

Use Lucide icons (matches the codebase). Default size `h-4 w-4` (16px) inline.

## Tokens

All design tokens live as CSS custom properties in `colors_and_type.css`. Use them directly — don't redeclare hex codes. Key tokens:

- `--bg`, `--bg-elevated`, `--bg-inverted` — surfaces
- `--action`, `--action-secondary`, `--accent`, `--brand`, `--danger` — semantic colors
- `--fg-1` … `--fg-4` — text scale
- `--border`, `--border-strong`, `--ring` — lines & focus
- `--font-display`, `--font-sans`, `--font-mono` — type families
- `--t-xs` … `--t-4xl` — type scale
- `--space-1` … `--space-8` — 8pt spacing scale (4/8/12/16/24/32/48/64)
- `--r-xs` … `--r-pill` — radii (industrial, 8px default; 0 for the mark)
- `--shadow-xs` … `--shadow-lg` — Ink-tinted at 5–12%
- `--ease-out`, `--dur-base` — motion (180ms default)

## Reference

- `ui_kits/app/Lastest Dashboard.html` — full app shell at hi-fi. Match this for any in-product surface (sidebar layout, header, build hero, metrics row, area cards, activity feed).
- `preview/` — small specimen cards for swatches, type, components.

## Voice

Direct, technical, slightly proud. **Sentence case** for headings/buttons; **lowercase** for sidebar nav; **UPPERCASE MONO** for eyebrow labels and badges. Use "you", never "we". Numbers as proof. No emoji except the rare `★` brand flourish.
