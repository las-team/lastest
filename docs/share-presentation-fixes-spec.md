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
4. **"N visual changes" section:** on demo shares, do NOT render inter-run diffs as findings. Replace with ONE showcase block: the single largest-diff step rendered as the existing before/after slider, titled "**How Lastest compares runs**" with caption "Between two identical runs we flag every moved pixel — on your deploys this is how regressions get caught." (the slider itself is the product demo; the framing stops it reading as "your site is broken"). All captured screenshots continue rendering in the gallery.
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

## Rollout order

1. §0 `kind` column + publish plumbing (everything keys off it).
2. §1 OG card (biggest outreach impact, zero risk to regression shares).
3. §2 presentation rules (page-only, gated on `kind`).
4. §3.1–3.4 + 3.6 gates (page + facts plumbing).
5. §3.5 a11y calibration, then re-enable demo a11y grades.
6. §2.5 ignore-region auto-masking (phase 2, replaces the §2.4 special case over time).

Non-goals: no change to the executor's diffing for regression runs; no change to claim flow; the PR #71 restructure (hero CTA, code teaser, chips-not-links) composes with all of the above — §2.2 supersedes its "—"-chip tooltip copy on demo shares.
