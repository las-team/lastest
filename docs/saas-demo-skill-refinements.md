# saas-demo skill refinements — making QuickStart shares convert

_Companion to `docs/share-conversion-playbook.md`. Targets the `/gtm-lastest-saas-demo` / QuickStart pipeline: `src/server/actions/quickstart-agent.ts` (orchestrator), `src/lib/playwright/quickstart-scout.ts` (public/authed scouts), `src/lib/playwright/quickstart-templates.ts` (walkthrough codegen), `src/lib/quickstart/quickstart-notes.ts` (demo-notes prompt)._

The skill currently optimizes for a **clean** share ("Approve baselines so the share looks clean" — `qs_approve_baselines`). For outreach, clean is table stakes; **specific findings and a visible "your product doing its job" moment** are what convert. The proposals below are ordered by expected conversion impact.

---

## P0 — Fix the facts pipeline feeding the notes

1. **`consoleErrors` is hardcoded empty.** `runFacts.consoleErrors: []` (`quickstart-agent.ts:1219`) means the notes model can never cite a real console error even when the run captured them. Populate it from the build's test results / step comparisons (the executor already collects console errors; the visual_diffs `consoleErrors` JSONB and step-comparison `consoleDiff` layer both exist). One of the cheapest sources of specific, credible findings.

2. **Resolve the frictionPoints contradiction.** The prompt says friction points are "Product-facing — never shown in outreach" (`quickstart-notes.ts:54`), but `DemoNotesPanel` renders them on the public share. Decide the intent and align both sides. Recommendation: keep them public — findings build credibility — and rewrite the rule to: *"frictionPoints ARE public and read by the founder: max 2, each with a one-line fix, written in a 'fixable, not embarrassing' tone. Nothing security-sensitive, nothing that reads as a public shaming."* Also align the caps: prompt says 0–3, code slices 4 (`quickstart-notes.ts:229`).

3. **Enable the layers the share advertises.** The share's "Checks run" grid shows 10 chips, but a QuickStart run typically reports "—" for A11y, Perf, Text, Variables. Preflight already flips console/network to "warn" (`quickstart-agent.ts:456-461`); extend it to enable the a11y and perf layers (log mode) so the share's `Accessible` and `Fast` grade tiles populate. A "C on WCAG 2.2" is a *hook*; a "—" is dead weight. (Grades also feed the a11y/perf scores the OG card and stat tiles want.)

## P1 — Make the walkthrough produce the shareable moment

4. **Screenshot the business-interaction RESULT, not just the submission.** `renderWalkthroughCode` types `demoInputValue` and clicks the CTA, but the money frame is the product's *output* (the generated brief, the search results, the validation report). After the CTA click, wait for a meaningful DOM change (main content mutation / new route) and capture a dedicated step labeled with the product's own verb (e.g. "Validating a startup idea"), since step labels become the video chapter rail and the share's most-watched seconds.

5. **Prioritize high-signal public routes.** The nav-link walk takes the first 6 hrefs and screenshots up to 3 (`quickstart-templates.ts:504-525`). Founders care most about `/pricing`, `/features`, `/docs`, `/changelog` — sort candidate routes by that preference before slicing so the share (and notes) discuss pages the founder actually sweats over.

6. **Add a mobile pass.** One or two key screenshots at a 390px viewport (home + post-auth or business-interaction result). Mobile regressions are a founder anxiety, the diff slider already handles arbitrary sizes, and "we checked your mobile hero too" is a differentiated outreach line. Cheap: a `page.setViewportSize` block at the end of the walkthrough template.

7. **Product-archetype hints instead of one canvas special-case.** The canvas-draw block (`quickstart-templates.ts:477-502`) is a hardcoded archetype. Let the public scout classify the archetype (`canvas | search | form | upload | dashboard | ecommerce`) in its JSON, and have `renderWalkthroughCode` pick the matching interaction snippet (upload a small sample file, run a search, add-to-cart-and-abandon). Keeps codegen deterministic while widening "your product doing its job" coverage.

## P1 — Sharpen the notes prompt for outreach

8. **Add an `outreachHook` output field.** One tweet-length sentence (≤200 chars) leading with the most striking *specific* observation — the intended first line of the X reply/DM and a candidate prefill for the share page's "Post to X" button. Rules: must reference a concrete route/label/number from the facts; no marketing adjectives. This removes the per-share copywriting step from the outreach loop.

9. **Write to the founder, not about the site.** Add a voice rule: second person, "your" ("your pricing page", "your onboarding") and "we" for Lastest ("we recorded", "we noticed"). The panel currently reads like third-party QA minutes; direct address is the "built for you" framing the share page now leads with.

10. **Route testingStruggles to the operator, not the void.** They're hidden from the share (correctly), but they're excellent DM material ("your signup has an hCaptcha — we worked around it, here's the report"). Include them in the `qs_publish_share` completion payload and the Discord ping (`LASTEST_SHARE_DISCORD_WEBHOOK_URL`) so the person doing outreach sees them next to the share URL.

## P2 — Reliability & reach

11. **Share-readiness gate before publish.** New check inside `qs_publish_share`: video exists for the primary result, ≥4 screenshots, demo notes persisted AND non-fallback (`uxSummary` not the `productName: N tests passed…` fallback from `quickstart-notes.ts:224`), OG image endpoint renders. On failure, complete the step with a `shareQuality: "degraded"` flag (and say why) instead of silently publishing a weak share — a video-less, notes-less share is the boilerplate experience the playbook flags as the #1 content gap.

12. **Standalone notes generation for non-QuickStart builds.** `generateDemoNotes` needs scout outputs, so ordinary published shares fall back to the generic pull-quote. Add a reduced-facts mode (build results + routes visited from step labels + console errors only — no scout) invocable as a server action on any build, so *every* outreach share gets at least a uxSummary + highlights. This is the single biggest content-quality unlock outside the skill itself.

13. **Credentials-in / magic-link support.** The classification table already recognizes `login_email_password` (signup not automatable, login is). Two extensions, in order of effort: (a) first-class founder-supplied credentials at session start (partially exists via `credsProvided`) documented as the outreach path for OAuth-gated products; (b) magic-link automation via a disposable-inbox provider for `magic_link_only` products — a large slice of modern SaaS currently downgrades to public-only walkthroughs, which produce the weakest shares.

14. **Retry-aware scouts.** `extractJson` already tolerates prose-wrapped JSON; add one bounded retry with the parse error appended when the scout returns unusable JSON, and record `scoutRetryCount` in step detail for visibility into flaky models.
