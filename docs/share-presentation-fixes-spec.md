# Spec: share presentation fixes — OG card, demo-noise suppression, evidence-gated grades

_Follow-up to `docs/share-conversion-playbook.md` and `docs/saas-demo-skill-refinements.md`, based on review of the five founder shares (Formbricks, Trigger.dev, Papermark, OpenPanel, Databuddy) from 2026-07-04. The skill's content (auth walkthroughs + demo notes) is outreach-ready; these three fixes address the presentation layer that currently undermines it._

Shared prerequisite for all three: a way to distinguish **demo shares** (QuickStart walkthrough published for outreach; diffs are run-to-run noise) from **regression shares** (real before/after findings).

## 0. Prerequisite: `publicShares.kind`

- Schema (`src/lib/db/schema.ts`, `public_shares` table): add `kind: text("kind").notNull().default("regression")` with values `"regression" | "demo"`.
- `publishBuildShare` / `publishLatestTestShare` (`src/server/actions/public-shares.ts`) accept an optional `kind` and persist it; `repointPublicShare` preserves it.
- QuickStart's `qs_publish_share` (`src/server/actions/quickstart-agent.ts`) publishes with `kind: "demo"`.
- Backfill: existing shares whose repo has `build_demo_notes` rows are demo shares — one-off script or manual UPDATE; default `"regression"` otherwise.
- Both the share page (`getShareDataBySlug`) and the OG route already load the share row, so `share.kind` is available everywhere below.

---

## 1. OG card rework — `src/app/api/og/share/[slug]/route.tsx`

### Problems observed
- Headline is derived from `build.changesDetected`, which is 0 after baseline approval — every demo card says "**No visual changes detected · across 1 test**" while the page hero says "67,252 pixels changed" and renders a "3 visual changes" section. The unfurl contradicts the page.
- `pickHeroPath` prefers the **diff** image: on a no-changes card this renders a washed-out white ghost (Formbricks) or red-smeared marketing page (Databuddy) under a red "REVIEW" badge — the product looks broken in the one image the founder sees on X.
- "across 1 test" undersells an 11–14-step authenticated walkthrough.

### Required behavior
1. **Card variant by `share.kind`:**
   - `demo`: headline `**We tested {domain} — live**` (or `{n}-step walkthrough of {domain}` when the step count is available); subhead `authenticated walkthrough · {steps} steps · {duration}` (drop "authenticated" when the run was public-only). Badge: teal `TESTED LIVE` (or `PASSED` when the run passed). Never render change counts, "REVIEW", or red accents on a demo card.
   - `regression` with changes: keep `**{n} visual changes detected**`, red accent — but derive `n` from the same source the page uses (count of diffs with `pixelDifference > 0` from `getShareDataBySlug`), NOT `build.changesDetected`. Consistency invariant: **the OG headline number must equal the page's "N visual changes" section count.**
   - `regression` clean: `**No regressions on {domain}**`, subhead `{tests} tests · all passing`, teal.
2. **Hero image priority flips to product-first:** `current > baseline > shot > diff`. Only use the diff image on a regression card with changes (where red overlay IS the story). Frame tag follows the pick (`CURRENT`/`CAPTURE`/`DIFF`).
3. **Data plumbing:** step count = captured screenshots of the primary result (`ShareTestResult.screenshots.length`); duration = `durationMs` formatted `1m 15s`; authed = presence of `authedScout`-derived routes is not available here — simplest proxy: demo-notes row exists AND uxSummary mentions nothing (don't overthink: pass `authed` from a new nullable `publicShares.meta` JSONB set at publish time by quickstart with `{ steps, authed }`, falling back to screenshot count).
4. Keep the existing 1.8MB screenshot cap and fallback card.

### Acceptance
- Formbricks-style demo share unfurls as: teal top bar, `TESTED LIVE` pill, "We tested app.formbricks.com — live", "authenticated walkthrough · 11 steps · 2m 00s", crisp CURRENT screenshot of their surveys dashboard.
- A real regression share still unfurls red with the change count, and that count matches the page.
- `npx tsx`-level smoke: fetch `/api/og/share/<slug>` for one demo + one regression share, eyeball both.

---

## 2. Demo-share noise suppression — `src/app/(public)/r/[slug]/page.tsx` (+ run config)

### Problems observed
- The pairing rerun (`qs_rerun_after_approval`) diffs run 2 against run 1 baselines; animated heroes, rotating testimonials, live charts and timestamps produce 36k–67k px "changes". The page presents these as findings: hero meta "67,252 pixels changed", chip "Visual 6.07%", sections titled "3 visual changes" with sliders whose diff overlays are red-smeared marketing pages.
- Same class of noise: "Network +198 −198" (symmetric request churn), "URL 11 diverged", "Perf 33/110/252 over" (budget breaches without a meaningful budget), "Console 10 new" with no explanation anywhere.
- Hero shows "Passed ✓" beside "3,907 pixels changed" — mixed message.

### Required behavior (presentation layer, `share.kind === "demo"`)
1. **Hero meta line:** replace `{px} pixels changed` with `{steps} steps · {duration} · authenticated` (omit "authenticated" when public-only). Keep the verdict pill.
2. **Checks-run grid:** render a chip ONLY when the layer has evidence a founder could verify:
   - `Run` — always (pass/fail).
   - `Console` — only when new-error fingerprints exist AND we can name at least one (tooltip lists top 3 fingerprint messages). Otherwise ✓/omit.
   - `A11y` / `Perf` — per §3 evidence gates.
   - `Visual`, `Network`, `URL`, `DOM`, `Text`, `Variables` — omit entirely on demo shares (inter-run noise by construction). The grid title becomes "Checks run" with fewer, all-defensible chips; add one muted trailing chip "+ 5 more layers on every deploy" linking the value story instead of dashes.
3. **Stat tiles:** drop the "Diff px" tile on demo shares; keep Duration, Accessible/Design/Fast per §3.
4. **"N visual changes" section:** on demo shares, do NOT render inter-run diffs as findings. Replace with the **showcase strip** (see §4/§5): the single largest-diff step rendered as the existing before/after slider, titled "**How Lastest compares runs**" with caption "Between two identical runs we flag every moved pixel — on your deploys this is how regressions get caught." (the slider itself is the product demo; the framing stops it reading as "your site is broken"), alongside the DOM X-ray and WCAG panel. All captured screenshots continue rendering in the gallery.
5. **Root-cause option (phase 2, run layer):** after `qs_approve_baselines`, compute cluster bounding boxes from each diff image where `pixelDifference > DEMO_NOISE_PX` (suggest 500) and persist them as baseline ignore regions (`src/lib/db/queries/visual-diffs.ts` ignore-region helpers exist), then the pairing rerun diffs clean. This makes chips/hero honest without presentation-layer special cases and benefits the claimed test too — the founder inherits a stable baseline. Presentation fixes above still ship first; this replaces rule 4's need over time.

### Acceptance
- Databuddy-style share: hero reads "Passed ✓ · 10 steps · 46s · authenticated"; no "1 visual change" section; one "How Lastest compares runs" slider; chips show only Run ✓, Console (with 3 named fingerprints in tooltip) and evidence-backed grades.
- A regression share (kind=regression) renders exactly as today.

---

## 3. Evidence-gated grades — page + scoring calibration

### Problems observed
- 4 of 5 founders got "**F Accessible**"; Trigger.dev scored **10/100** — for a highly polished product this reads as miscalibrated and poisons trust in the whole report.
- Self-contradiction: A11y **chip** shows "—" (no step-comparison a11y layer) on the same page where the A11y **tile** shows "F · 23" (from `build.a11yScore`). Two sources, no reconciliation.
- Perf tile ("F Fast · 55") and Perf chip ("110 over") similarly disagree in kind.
- The demo notes never mention accessibility — an F grade with zero named violations is an accusation, not a finding.

### Required behavior
1. **Single source per layer:** `computeLayerOutcomes` (`page.tsx`) must consume the same inputs as the tiles. If `build.a11yScore` exists, the A11y chip shows the letter grade (not "—"); if step-level a11y evidence exists, tooltip carries the severity breakdown. A layer never shows "—" in the grid while a tile grades it.
2. **Evidence gate:** render the Accessible tile/chip ONLY when the top violations are available to display. Plumb the top 3 axe violations (rule id + human name + count, e.g. "color-contrast (8)") from wherever `a11yScore` is computed (`src/lib/a11y/wcag-score.ts` inputs) into `ShareData`, and render them as a small "Top issues" line under the tile or in the notes panel. No named issues ⇒ no grade shown.
3. **Public-share grade floor:** on shares, render A/B/C as letter grades; render would-be D/F as "**Needs review**" (amber, score hidden). An F is for the founder's private dashboard after they claim, not for their public timeline. (`scoreGrade` gets a `publicShare` variant.)
4. **Perf:** on demo shares drop breach counts entirely; show only the absolute Web-Vitals grade tile (`computePerfScore` already implements Google-threshold banding — that one is defensible) with its sub showing the worst metric ("LCP 3.1s"). Budget-breach chips return only on regression shares where a baseline budget exists.
5. **Calibration task (blocking for a11y grades on outreach shares):** validate `wcag-score.ts` against 3 known-good sites (e.g. gov.uk, stripe.com) and the 5 demo targets; if polished products score <40, fix the weighting (likely: per-violation deductions unbounded, or score computed across all steps compounding the same violation). Until calibrated, `kind: "demo"` shares render no a11y grade at all — a missing grade costs nothing, a wrong F costs the deal.
6. **Console:** populate `runFacts.consoleErrors` (refinement #1, `quickstart-agent.ts:1219`) so the notes can cite them; the chip's "N new" tooltip lists the top fingerprints. Unexplained counts don't render.

### Acceptance
- Trigger.dev share shows no a11y grade (until calibration passes) or "Needs review" with 3 named rule violations — never a bare "F · 10".
- Databuddy (85/B) shows "B Accessible" with "Top issues: …" line, chip and tile agreeing.
- No page renders a graded tile alongside a "—" chip for the same layer.

---

## 4. Eye-candy: DOM X-ray showcase — visible on first scroll-through

### Problems observed
- The annotated DOM overlay (`src/components/share/dom-overlay-client.tsx`, ported from Verify > DOM) is the most visually distinctive artifact Lastest produces — toned bounding boxes drawn over the founder's real screenshot — and it appeared on **zero** of the five demo shares. It only renders when a step has DOM *diff* changes (`buildDomOverlays` in `page.tsx` requires `layers.dom` / `metadata.domDiff` with added/removed/changed > 0); demo runs diff clean, so the section never mounts. When it does render (regression shares), it sits below the diff sliders, far down the page.
- The current overlay is **mouse-only**: element popovers open on `onMouseEnter` — invisible on touch, unreachable by keyboard, and nothing is annotated until the visitor hovers. A founder scrolling on a phone sees a plain screenshot.

### Required behavior
1. **New "DOM X-ray" mode for `DomOverlay`.** Keep the existing diff mode untouched for regression shares. Add an `xray` variant that annotates a step's *captured element inventory* rather than a diff: the page `<h1>`, nav/landmark regions, the primary CTA, and form fields — the elements Lastest tracks per step.
2. **Data:** demo runs must persist a per-step element inventory. The executor's DOM layer already builds `DomSnapshotElement`s (tag, selectors, textContent, boundingBox) for comparison; add a capped `showcaseElements: DomSnapshotElement[]` (max ~8: first h1, landmarks, up to 3 interactive elements, the business-interaction input/CTA when present) to the step comparison's stored layers (or a sibling JSONB) during quickstart runs. Fallback when absent: reuse any inter-run DOM diff elements re-framed as "live regions we track" — never render an empty x-ray.
3. **Visible without interaction (the "first scroll-through" requirement):** in the default state, render 2–3 boxes *pre-labeled* — persistent chip labels (e.g. `〈h1〉 "See what changed"`, `button "Get started"`) pinned to their boxes with a hairline connector, not hidden behind hover. Remaining boxes render as outlines. Optional slow highlight cycle through the boxes, disabled under `prefers-reduced-motion`.
4. **Accessible interaction model** (replaces hover-only, applies to BOTH modes):
   - Each box becomes a `<button>` — focusable in DOM order, visible focus ring (`ring-2` + offset), `aria-expanded` state.
   - Popover opens on focus AND on click/tap (toggle); Escape and outside-tap close it; popover gets `role="tooltip"` and is referenced via `aria-describedby`.
   - Box `aria-label`: `"{tone} <{tag}> {selector}"` so screen readers announce what sighted users see in the popover.
   - Color is never the only signal: the +/−/~ sign (already in `TONE_STYLE`) renders inside the chip label.
5. **Placement:** demo shares render the showcase strip **directly after `PostVideoCTA`** — i.e. within the first two viewport-heights: video → hero (claim CTA) → take-this-test card → **showcase strip**. Desktop: 2-column grid (DOM X-ray left, WCAG panel §5 right, comparison slider full-width beneath). Mobile: stacked in that order. Section heading: "**What we see when we test {domain}**" — one strip that shows off pixels, DOM, and accessibility together.

### Acceptance
- A demo share on a phone shows, without any interaction, the founder's screenshot with 2–3 labeled element callouts inside the first two screens of scrolling.
- Keyboard-only: Tab reaches every box, Enter opens the detail popover, Escape closes; VoiceOver announces tag + selector.
- Regression shares keep today's diff overlays (now with the accessible interaction model) — no data changes required for them.

---

## 5. Eye-candy: WCAG analysis panel — port the internal a11y UI to the share

### Problems observed
- The internal build page renders a genuinely attractive a11y surface — `A11yComplianceCard` (colored score ring, "N/M rules passed", severity breakdown, trend sparkline) and `A11yViolationsCard` (per-rule rows with impact/WCAG badges, occurrence counts, sample selector + failureSummary, deque-university "Learn more" links) — while the share reduces all of it to a bare "F · 23" tile. The share shows the *accusation* and hides the *analysis*.

### Required behavior
1. **New `ShareWcagPanel`** (server-rendered, share-safe — no app-internal CSS vars, mirrors the `DomOverlay` porting approach):
   - **Header row:** the score ring from `A11yComplianceCard` (same 90/70 color bands) + "WCAG 2.2 AA · {passed}/{checked} rules passed" + severity chips (`critical / serious / moderate / minor` counts). Under the §3.3 grade floor, a would-be D/F ring renders amber with the label "Needs review" — but the panel still shows, because here the number arrives WITH its evidence.
   - **Top rules list:** up to 3 rules, sorted severity → occurrence (same ordering as `A11yViolationsCard`), each row: impact badge, human rule description, occurrence count, ONE sample (selector, truncated failureSummary), and the deque `helpUrl` "Learn more" link (`rel="noopener noreferrer nofollow"`).
   - **Footer line:** "{n} more rules checked — claim the test for the full report" → claim link. The panel is the payoff-preview pattern from PR #71's code teaser, applied to a11y.
   - **Trend sparkline:** only when ≥2 builds have scores (demo repos usually have 1–2 runs; render nothing rather than a 1-bar chart).
2. **Data:** reuse `getBuildA11yViolations` (`src/lib/db/queries/builds.ts`, `BuildA11yViolationRow`) server-side in the share page. Add a slim share projection (rule id, description, impact, count, helpUrl, one sample selector/failureSummary) — do NOT ship the full `a11yViolations` JSONB (`schema.ts:896`) to the client; it's excluded from `ShareVisualDiff` for payload reasons and must stay that way.
3. **Composition with §3:** this panel IS the §3.2 evidence gate — the Accessible tile/chip renders iff the panel has rows to show, and the tile anchors-links down to the panel. The §3.5 calibration task still gates *demo-share* grades; until it passes, the panel may render with the neutral header "Accessibility checks — {n} rules evaluated" and rules list, score ring hidden.
4. **Self-demonstrating accessibility (non-negotiable):** the panel itself must pass what it measures — semantic `<ul>`/`<li>` structure, severity conveyed by badge text not color alone, AA-contrast checked in both themes, focus-visible styles on links. A WCAG panel that fails axe on our own share is a credibility own-goal.
5. **Placement:** demo shares — right column of the §4.5 showcase strip. Regression shares — below the visual-changes section, above the gallery.
6. **Notes tie-in:** when the panel renders, the demo-notes facts block (`quickstart-notes.ts` `buildFactsBlock`) receives the top 3 rules so the AI notes can reference them ("the F traces to 8 color-contrast pairs in the sidebar") — findings in prose and in UI must tell the same story.

### Acceptance
- Databuddy's share (85/B) shows a green-band ring, "B · {passed}/{checked} rules passed", severity chips, and up to 3 concrete rules with deque links — in the first two viewport-heights, next to the DOM X-ray.
- Trigger.dev's share (score 10, pre-calibration) shows the neutral rules-list variant — real violations named, no unexplained F anywhere on the page.
- Running axe against a rendered share page reports zero critical/serious violations for the panel and the DOM X-ray themselves.

---

## Rollout order

1. §0 `kind` column + publish plumbing (everything keys off it).
2. §1 OG card (biggest outreach impact, zero risk to regression shares).
3. §2 presentation rules (page-only, gated on `kind`).
4. §4.4 accessible interaction model for `DomOverlay` (standalone, benefits regression shares immediately).
5. §5 WCAG panel (data already exists via `getBuildA11yViolations`; doubles as the §3.2 evidence gate).
6. §3.1–3.4 + 3.6 gates (page + facts plumbing).
7. §4.1–4.3 + 4.5 DOM X-ray showcase strip (needs the quickstart element-inventory capture).
8. §3.5 a11y calibration, then re-enable demo a11y score rings.
9. §2.5 ignore-region auto-masking (phase 2, replaces the §2.4 special case over time).

Non-goals: no change to the executor's diffing for regression runs; no change to claim flow; the PR #71 restructure (hero CTA, code teaser, chips-not-links) composes with all of the above — §2.2 supersedes its "—"-chip tooltip copy on demo shares.
