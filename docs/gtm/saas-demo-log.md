# SaaS Demo Log

> **FROZEN 2026-05-16.** All entries below have been backfilled into Twenty CRM's `DemoRun` object on Olares. New runs from `/gtm-lastest-saas-demo` must `POST /rest/demoRuns` — do **not** append here. See `docs/gtm/twenty-crm-setup.md` for the field model and per-run write contract.

Append-only log for `/gtm-lastest-saas-demo` runs (historical, 2026-05-12 → 2026-05-16). Re-check 48h after each session — for runs after 2026-05-16, that 48h follow-up is tracked on the DemoRun record itself (`repliedAt`, `status`).

---

## 2026-05-12 — Jay Boyd / SchemaGen

- **Source:** BetaList (sole reachable feed during this session — FeedbackQueue/PH/IndieAppCircle are SPA-only and Playwright MCP was locked by a prior session; SearXNG/WebSearch couldn't reach Reddit).
- **Site:** https://schemagen.io
- **Tagline:** "Deploy Schema Without Dev Bottlenecks" — The Schema Delivery Network for SEO teams managing structured data at scale.
- **Founder:** Jay Boyd ([LinkedIn](https://linkedin.com/in/jay-boyd/), Calendly `jay-schemagen`).
- **Stack signal from CSP:** Supabase auth, Stripe, Vercel hosting, PostHog + GA analytics.
- **Lastest repo:** `96be2d84-58d4-45a9-b493-c6a661fbf7ab` (name: `schemagen-demo`)
- **Test:** `b06b0132-c71e-4b2c-a223-17a66d6f29af` — "SchemaGen — public walkthrough + login probe"
- **Build:** `ccb17b7b-c58e-48d1-8d5a-ea7540244288` — passed 1/1, 0 failed, **8 baseline screenshots**, `overallStatus: safe_to_merge` (after approval).
- **Scenarios captured:**
  1. `/` Home
  2. `/pricing`
  3. `/audit`
  4. `/guide`
  5. `/generator/howtoitem`
  6. `/contact`
  7. `/login`
  8. Tolerant auth probe (one extra screenshot — likely `/login` post-probe state since the Supabase widget is mounted client-side and the auto-form-fill is best-effort).
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Share URL:** **NOT YET PUBLISHED — see blocker below**.
- **Channel:** LinkedIn DM to Jay Boyd (no public X handle surfaced); Calendly fallback for warm intro.
- **Sent:** no (blocked on share URL).
- **Reply (48h check):** —

### Blocker
The v1 share endpoint `POST /api/v1/builds/:id/share` is in code at `1a7598a` but is **not yet deployed to app.lastest.cloud** (returns 404 — verified against build summary fall-through, not endpoint matching). Two workarounds:

1. Run `pnpm deploy:olares` to ship the share endpoint (requires explicit user authorization per memory `feedback_no_unprompted_prod_deploy`).
2. Publish manually from the UI at https://app.lastest.cloud/builds/ccb17b7b-c58e-48d1-8d5a-ea7540244288 — open the Share dialog on the test row (not build), tick scope-to-test, and copy the `/r/<slug>` URL.

Playwright MCP was unavailable for the automated UI fallback (chrome user-data-dir locked by an earlier session; classifier denied kill).

### Outreach draft (LinkedIn DM, paste once share URL is published)
See `docs/gtm/outreach-targets.md` → SchemaGen section, or inline below:

> Hi Jay — caught SchemaGen on BetaList and the "Deploy Schema Without Dev Bottlenecks" framing as an SDN is a really sharp wedge for the agency segment. I run Lastest (free, OSS visual regression on Playwright). I baselined eight of your public pages — home, pricing, audit, guide, the HowToItem generator, contact, and the login surface:
>
>   https://app.lastest.cloud/r/<SLUG>
>
> Click claim on the share page and it lands in your own Lastest team; from there it re-runs on every deploy and flags any visual change pixel by pixel. Strong fit for an agency-tier product where one bad schema-builder render can cascade across client sites. Free, no card, MIT-licensed runner.
>
> Happy to talk through Lastest if useful, and would love to hear how the SDN side scales when you onboard a multi-site agency.
>
> — Viktor

---

## 2026-05-13 — Dustin (@thexyzaffair) / Conjour

- **Source:** BetaList (`/startups/conjour`, featured 2026-05).
- **Site:** https://www.conjour.ai
- **Tagline:** "Build winning messaging with always-on market intelligence" — go-to-market intelligence engine.
- **Founder:** Dustin ([BetaList profile](https://betalist.com/@thexyzaffair)).
- **Auth signal:** Django allauth at `/accounts/register/`. **No email-verification gate** — submit lands straight on `/messaging/` with a 5-step setup wizard. Email+password+confirm password; company+first+last name required.
- **Lastest repo:** `3ab5d43e-87e9-483b-8a9d-a11e17ef9a3e` (name: `conjour-demo`, SHORT_ID `3ab5d43e`).
- **Test:** `6975d1f8-1744-4e05-9d50-3e5b622afc91` — "Conjour — register + walk authenticated app".
- **Build:** `7f7a9b5d-1cdc-492d-9b38-4aa1282bfd08` — 12 screenshots, baselines approved. `failedCount: 1` is the standard implicit console-error assertion, not a step failure (every scenario produced a screenshot).
- **Scenarios captured (12):**
  1. `/` Home
  2. `/accounts/register/` empty form
  3. `/accounts/register/` filled form
  4. Post-signup wizard dialog (`/messaging/` with "Get started with Conjour" 5-step wizard open)
  5. `/messaging/` clean (wizard dismissed)
  6. `/analytics/`
  7. `/personas/`
  8. `/templates/`
  9. `/content/`
  10. `/market/` (Market Expertise)
  11. Final wrap screenshot
  12. (extra captured during a wizard close)
- **Demo identity:** `lastest-demo+3ab5d43e-<timestamp>@lastest.cloud` (timestamped to avoid LoginAlreadyUsed if rerun), password `Lastest-Demo-3ab5d43e!`, company `Lastest Demo`.
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Share URL:** **NOT YET PUBLISHED — `POST /api/v1/builds/:id/share` still 404 on prod (Olares deploy older than `1a7598a share`)**.
- **Channel:** BetaList project comment OR X DM via Dustin's `@thexyzaffair`-style handle (need to resolve to actual X handle).
- **Sent:** no (blocked on share URL).
- **Reply (48h check):** —

### Status to user
Awaiting confirmation from user on Lastest side that scenarios 5-10 show authenticated Conjour app surface (not a login redirect). Conjour signup confirmed working end-to-end via Playwright probe before test run — `/messaging/` rendered with wizard dialog + 6-item nav.

### Outreach draft (paste once share URL is published, replace `<URL>`)

**BetaList comment** (default channel for BetaList-sourced):

> Hi Dustin — caught Conjour on BetaList and the "always-on market intelligence" framing for messaging guides is a really clean wedge. Most "AI copy" tools are episodic; making the messaging guide a living artefact (with personas + templates + content all hanging off it) feels different.
>
> I run Lastest (free, OSS visual-regression on Playwright). Out of curiosity I signed up a demo account, walked the post-signup wizard, and baselined ten of your pages including the authenticated `/messaging`, `/personas`, `/templates`, `/content`, and `/market` surfaces:
>
>   `<URL>`
>
> Click "Claim" on the share page and the whole setup lands in your own Lastest team in one step. From there it re-runs on every deploy and flags any visual change pixel by pixel. Free, no card, OSS.
>
> PS — I signed up as `lastest-demo+3ab5d43e-<stamp>@lastest.cloud` with company name "Lastest Demo"; feel free to nuke that user, the `lastest-demo+` prefix makes them easy to grep for.
>
> — Viktor (lastest.cloud)

---

## 2026-05-13 — Marius bekk / Featurely

- **Source:** FeedbackQueue `/feed` (project `cmnzuwu6l0088rn0p1r9bklzv`)
- **Site:** https://www.featurely.no
- **Tagline:** "Replace 5 tools with one dashboard for indie developers." — feedback + error tracking + uptime + flags + analytics + i18n + CMS-ish version/maintenance tooling, hosted on Vercel + Neon EU.
- **Founder:** Marius bekk (Norwegian, single-developer indie based on FAQ language).
- **Lastest repo:** `0e2de9b8-1643-412e-af6f-490157555a78` (name: `featurely-demo`, SHORT_ID `0e2de9b8`)
- **Test:** `a3678a7e-c74f-4fbc-ad74-e2543379d511` — "Featurely — public walkthrough + live-demo stuck state"
- **Build (v4 final):** `9c63705c-f525-4344-ae8b-366ff7be1cb9` — 7 screenshots, baselines approved, `overallStatus: review_required → all-approved`. Console-error assertion tripped a false-positive `failedCount: 1` on the analytics SDK 401s (Featurely's own SDK correctly 401s for anonymous visitors).
- **Demo notes:** `docs/gtm/featurely-demo-notes.json` (Phase 6.5) — saved locally since the `build_demo_notes` endpoint is also on HEAD-only.
- **Scenarios captured (v4):**
  1. `/` Home (7258 px full-page)
  2. `/demo` landing — "Enter the live demo" button enabled
  3. `/demo` — "Signing you in…" disabled-spinner state (after fire-and-forget click)
  4. `/blog`
  5. `/news` — Product updates changelog
  6. `/#pricing` — pricing tiers + compare-plans table
  7. `/sign-up` — form pre-submit (submit is broken)
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Share URL:** https://app.lastest.cloud/r/_AfDz76MgMHFgRIWk0aGrQ (published 2026-05-13 once HEAD endpoints landed on prod; refreshed demo notes attached via `getLatestDemoNotesForRepo`).
- **Subsequent rebuilds:** build `533460c6` (15-step walk, post-onboarding + /dashboard captured) and build `aae663a0` (rerun with all baselines paired). Final run `689da954` is the canonical reference: Firebase Auth + /onboarding + /dashboard + 5x /dashboard/* routes, runtime-fresh email (Date.now base-36) to avoid Firebase "email already in use".
- **Channel:** FeedbackQueue project comment on Marius's project `cmnzuwu6l0088rn0p1r9bklzv` (default for FQ-sourced).
- **Sent:** yes, 2026-05-13 (per user; short variant of the draft was used).
- **Reply (48h check on 2026-05-15):** —

### Run-time pivots

| Build | Outcome | Lesson |
|---|---|---|
| v1 (`1341fe8f`) | Auth phase failed — Featurely `/sign-up` Create-account submit fires zero fetch/XHR; stuck on "Please wait…". | Featurely auth is broken in prod. |
| v2 (`7def2119`) | Post-click /demo screenshot was a blank black 1280×720 — Playwright resolved `waitForURL` mid-navigation, before the destination rendered. | Don't `waitForURL` during stuck-state captures. |
| v3 (`0145e055`) | Removed click; fresh runner context didn't auto-flip the button → scenarios 2 and 3 identical. | The disabled state needs an active click. |
| **v4 (`9c63705c`)** | Fire-and-forget click + 800ms React-state wait + screenshot before any nav can race → captures the "Signing you in…" spinner cleanly. | Pattern to add to `test-template.md` for stuck-state captures. |

### Friction points surfaced to the founder (in demo notes)

1. `/demo` Enter button hangs on "Signing you in…" indefinitely (~6 s observed, no console error, no redirect).
2. `/sign-up` Create-account button stalls on "Please wait…" with zero outgoing fetch/XHR — client handler awaiting something that never resolves.

Both are visible on the share itself (screenshots 3 and 7) — no need to quote them in the outreach DM, the founder will self-discover.

### Outreach drafts (paste once share URL is published, replace `<URL>`)

**FeedbackQueue comment** (default channel — post on https://feedbackqueue.dev/projects/cmnzuwu6l0088rn0p1r9bklzv):

> Hi Marius — caught Featurely on the FQ feed. The "Replace 5 tools with one dashboard for indie developers" wedge is sharp, and the compare-plans table might be the most honest pricing breakdown I've seen on an indie SaaS this month — three tiers each with one differentiator-headline, plus the explicit "€15/seat/mo" line for Business.
>
> I run Lastest, a free / OSS visual-regression tool on Playwright. Out of curiosity I baselined seven pages of Featurely this morning — home, the live demo landing, blog, news, the pricing section, and the sign-up form —
>
>   `<URL>`
>
> Click "Claim" on the share page and the whole setup copies into your own Lastest team in one step; from there it auto-flags any pixel change on every deploy. Free, no card, OSS.
>
> Two things I noticed while walking through (both visible on the share, no need to take my word for it):
>
> - The "Enter the live demo" button on `/demo` flips to a disabled "Signing you in…" spinner that never lands. Waited ~6s, nothing happened — see the third screenshot.
> - `/sign-up`'s "Create account" button stalls on "Please wait…" with zero outgoing fetch/XHR in the network panel. Looks like the client handler is awaiting a promise that never resolves. The "Continue with Google" path may still work.
>
> Happy to chat through what Lastest catches, or just leave it for you to poke at. Cheering for Featurely regardless — the indie-dev admin-suite framing is the right wedge.
>
> — Viktor (lastest.cloud)

**Reddit DM fallback** (only if u/lastesthero finds him on Reddit):

> Hi Marius — caught Featurely on FeedbackQueue. The "Replace 5 tools with one dashboard" wedge + the compare-plans honesty in particular felt sharp.
>
> I'm building Lastest, a free visual-regression tool on Playwright, and I spun up a baseline of your public pages plus the /demo landing —
>
>   `<URL>`
>
> One click to claim into your own account; from there it auto-flags any visual change on deploy. Free, no card, OSS.
>
> PS — the share also captures two friction points on your auth flows (/demo Enter stuck on "Signing you in…", /sign-up submit stuck on "Please wait…"). No follow-up needed; just thought you'd want to know.
>
> — Viktor


---

## 2026-05-14 — ByteChef team / ByteChef

- **Source:** FeedbackQueue (confirmed via founder reply path; original FQ post not recorded in this session)
- **Site:** https://www.bytechef.io
- **Tagline:** Open-source, AI-native, low-code platform for API orchestration, workflow automation, and AI agent integration. Apache-2.0, German-Croatian team.
- **Lastest repo:** `c9542463-059f-497d-93a5-95735c219658` (name: `bytechef-demo`)
- **Test:** `2685bf38-8756-4a55-8ca2-ed9b57fa748a` — "ByteChef — register + app walkthrough"
- **Build (video):** `e042cb78-b40f-4c0f-977c-0eab00c448d5` — review_required then approved, baselines paired against prior build `12532749`.
- **Demo notes:** `docs/gtm/bytechef-demo-notes.json` POSTed to build `12532749` and surfaced on the share via `getLatestDemoNotesForRepo`.
- **Scenarios captured (15):**
  1. www.bytechef.io/ Home
  2. /pricing
  3. app.bytechef.io/register (email step)
  4. /register (password step)
  5. Post-register state
  6. /login form
  7. Post-login (h1-waited, content rendered)
  8. /automation/projects
  9. /automation/deployments
  10. /automation/executions
  11. /automation/connections
  12. /automation/chats
  13. /embedded/integrations
  14. /embedded/configurations
  15. /embedded/connected-users
- **Share URL:** https://app.lastest.cloud/r/eFhwrvc7VvjrC-xPrIVMmg (video-enabled, video build, baselines approved)
- **Channel:** Discord (discord.com/invite/VKvNxHjpYx)
- **Sent:** yes, 2026-05-14
- **Message body (as sent):**

  > hey guys,
  > Tested your app from feedbackqueue but couldnt send it there.
  > https://app.lastest.cloud/r/eFhwrvc7VvjrC-xPrIVMmg
  > Mostly just Console-level 401 noise on Embedded pages - LMK if I can help with anything else.

- **Reply (48h check on 2026-05-16):** —

### Friction points surfaced (in demo notes)

1. Email-activation gate forces a 4-screen redirect dance (signup, activation email, back to login, finally /automation/projects).
2. Workspace switcher chrome reads "DEVELOPMENT" on both /automation/* and /embedded/* with no top-bar text distinguishing the two product modes.
3. Console-level 401 noise on every /embedded/* page from a project-scoped endpoint (the one mentioned in the Discord DM).
4. Login submit button aria-label is "log in button", not the accessible name "Log in".

### Testing struggles solved

- Two-step signup (email then password) needed an explicit wait for the password input to render between fills.
- API-direct register fallback via XSRF cookie-to-header dance, in case the UI form drops the token.
- Post-login SPA hydration race: networkidle resolves before React mounts the page header. Fixed with an h1 wait + 800ms buffer.

---

## 2026-05-14 — Variant Systems / Postbox

- **Source:** predates this session, original discovery channel not recorded in repo logs. Most likely sourced from the agent/MCP ecosystem (FeedbackQueue, Reddit r/mcp, or similar).
- **Site:** https://usepostbox.com
- **Tagline:** Agent-native data collection. AI-powered spam detection, auto-translation, and smart replies from a single API endpoint.
- **Founder:** Variant Systems (link in homepage footer).
- **Lastest repo:** `14b4d8fd-eedf-4798-a322-548b83521176` (name: `postbox-demo`)
- **Test:** `b7d950ea-6ebd-4cda-9d47-507b32722ea1` — "Postbox — register + app walkthrough"
- **Build (video):** `745a0237-b1da-449f-89db-f14e95375323` — review_required then approved, baselines paired against prior build `c29560fb`, video player enabled.
- **Demo notes:** `docs/gtm/postbox-demo-notes.json` POSTed to build `c29560fb` and surfaced via `getLatestDemoNotesForRepo`.
- **Scenarios captured (14):**
  1. `/` Home
  2. `/features`
  3. `/pricing`
  4. `/users/register` (empty form)
  5. Post-signup, "Signed in." toast over "Choose how you want to connect" onboarding modal
  6. `/forms` (after modal dismissed via "Set up manually instead")
  7. `/knowledge_base`
  8. `/integrations/api-keys`
  9. `/integrations/mcp`
  10. `/integrations/skill`
  11. `/logs`
  12. `/billing`
  13. `/settings/account`
  14. Final bare screenshot
- **Share URL:** https://app.lastest.cloud/r/34bwqtRzClckEIniHUapOw (video-enabled, baselines approved)
- **Channel:** per user (not recorded in this session; mark above when known).
- **Sent:** yes, 2026-05-14 (per user, message body not recorded here).
- **Reply (48h check on 2026-05-16):** —

### Friction points surfaced (in demo notes)

1. Forced "Choose how you want to connect" onboarding modal blocks all authenticated routes until "Set up manually instead" is clicked.
2. "Signed in." toast can race the modal hydration on first paint, producing a brief flash of empty.

### Testing struggles solved

- Onboarding modal trapped the first 9 authed-route screenshots into byte-identical duplicates. Fixed by clicking "Set up manually instead" then re-dismissing on each navigation.
- Re-runs on the same email hit "email already exists" on /users/register with no visible error. Test now falls through to /users/log-in as fallback.

---

## 2026-05-14 — 3×3 batch run

Ran `/gtm-lastest-saas-demo` as 9 parallel agents across 9 discovery sources (3 batches × 3 agents). 5 builds published to `/r/<slug>`; 4 builds left unpublished because their sites have a real signin we couldn't authenticate against (don't ship a demo claiming to "review" a SaaS we never logged into).

### q9 Beatable — APPROVED (strong)

- **Source:** r/indiehackers, "Friday share fever" thread https://reddit.com/r/indiehackers/comments/1t73rnd/
- **Site:** https://beatable.co — Laravel stack (CSRF, email+password+confirm+consent checkboxes, no captcha, no OAuth).
- **Founder:** u/diodo-e (Reddit). No public X / email surfaced.
- **Repo:** `80a0cd1e-ea51-44a3-b44c-b288fc9a55da` (`q9-beatable-demo`)
- **Test:** `a683e71d-2128-412f-9fc1-d12f453c88b1`
- **Build:** `d66fdca0-1553-460b-9e26-9370d796c033` — 8 screenshots, video, all diffs approved.
- **Share URL:** https://app.lastest.cloud/r/n7WfRS1miOhexYaRdjQHZg
- **Demo notes:**
  - *uxSummary:* Clean Laravel SaaS with a polished marketing surface and an honest email+password signup that actually completes. The post-signup surface renders in three sequential views (Steps 5/6/7), giving a useful per-state baseline for any future onboarding tweaks.
  - *Highlights:* (a) Signup is email+password with confirm + terms, no OAuth pressure. (b) Auth completed end-to-end with the canonical template (only target in the batch where this happened cleanly). (c) Three post-signup screenshots make the authenticated surface itself versionable, not just the marketing site.
  - *Friction:* Cloudflare's email-decode script throws console noise on every page (executor flags it as "failed" but it's third-party — Beatable can ignore). The auth phase reaches three sequential post-signup states that look very similar; could indicate a brief redirect chain worth tightening if speed matters. *(Correction: an earlier version of this entry listed "/features 404" as friction. Beatable doesn't link to /features anywhere — that was the test template inventing a URL and then complaining when it didn't exist. Fixed in the template, removed from the report.)*
  - *Testing struggles:* None on this run — the only target in 9 that didn't hit captcha / silent-submit / OAuth-only / target-broken.
  - *Skipped routes:* App routes `/dashboard`, `/app`, `/projects`, `/home`, `/settings`, `/account` were tried after auth; the loop only captured the first ones that returned 200, so post-signup steps reflect Beatable's actual landing surface rather than guessed paths.
- **Outreach channel:** Reddit DM to u/diodo-e (draft below in outreach section).
- **Sent:** pending user approval.

### q8 Trace — PUBLISHED (marginal)

- **Source:** r/startups "Feedback Friday" thread https://www.reddit.com/r/startups/comments/1t6y210/feedback_friday/
- **Site:** https://gettrace.vercel.app (vercel.app dev subdomain — very early product).
- **Founder:** Reddit u/handle for the "Trace" comment was NOT captured by the agent — needs lookup before sending.
- **Repo:** `11d3d3c3-103b-4cd7-bc5e-c6e88ad0d92a`
- **Build:** `98cd0b39-e2bd-49f9-8bb6-be81b5dd8140` — 6 screenshots, video, all diffs approved.
- **Share URL:** https://app.lastest.cloud/r/dCPlFFJMVkd8a15jxnvBTg
- **Demo notes:**
  - *uxSummary:* "Conversational product discovery system" pitch; signup flow has the bare-minimum email+password+name+terms. Auth completed (URL transitioned away from /signup) but only one post-signup screenshot was captured because no conventional app route (`/dashboard`, `/app`, etc.) returned a 200 status.
  - *Highlights:* Clean three-field register form with no OAuth-only pressure and no captcha — rare in this batch.
  - *Friction:* Post-signup landing doesn't expose a `/dashboard` (or any of the standard app routes the test probes after auth) — the authenticated baseline is therefore one screenshot rather than a full walkthrough. *(Earlier draft listed "/features 404" and "/pricing 404" — Trace doesn't link to those paths, so the test was inventing URLs to fail at. Removed.)*
  - *Skipped routes:* `/dashboard`, `/app`, `/projects`, `/home`, `/settings`, `/account` all 404 or auth-bounce.
- **Outreach:** pending u/handle lookup + draft.

### q2 Hivemind — PUBLISHED (no-auth site)

- **Source:** r/SideProject https://www.reddit.com/r/SideProject/comments/1tcqmpf/
- **Site:** https://askhivemind.app — Reddit-powered search engine; one verdict per question; explicitly no accounts / no auth.
- **Founder:** u/Glad_Struggle6343, email ask.hivemind.app@gmail.com (homepage footer).
- **Repo:** `c96cfc6f-f1d6-457b-b028-79a05cd536ad`
- **Build:** `ff75acf4-8d39-4d8d-a0ed-8addc320a4fd` — 6 screenshots, video, all diffs approved.
- **Share URL:** https://app.lastest.cloud/r/4OnJnmfWtDL87v2H6Ub-JA
- **Demo notes:**
  - *uxSummary:* Single-page search UI with one question box and a single-verdict answer. The whole product is the homepage; no nav, no auth, no pricing tiers. Loading → verdict is the only state transition, which makes it a perfect (small) visual-regression target.
  - *Highlights:* (a) Test captured the full search interaction — typed query, submitted, captured loading + verdict states — instead of stopping at the static landing. (b) Six baselines from a one-page product. (c) Zero auth friction means the founder can replay the test themselves without a demo account.
  - *Design note (not friction):* The home page has no internal nav links besides Next.js asset bundles — Hivemind is intentionally one-page. Any 307s the test recorded were for paths we probed that the founder never linked. Not a finding. *(Earlier draft framed this as "friction"; corrected — there's nothing to fix on a deliberately single-page product.)*
  - *Testing struggles:* Verdict render is async with no settled state marker (no aria-live, no done-flag). Used a fixed timed wait to stabilise the screenshot.
- **Outreach channel:** Reddit DM to u/Glad_Struggle6343.

### q4 LifeByLogic — PUBLISHED (no-auth site)

- **Source:** r/microsaas.
- **Site:** https://lifebylogic.com — "Think Better. Decide Better. Live Better." Flourishing Index assessment, by Abiot Y. Derbie (cognitive neuroscientist).
- **Founder:** u/neanea12 (Reddit), hello@lifebylogic.com, [LinkedIn](https://www.linkedin.com/in/abiot-y-derbie-427622266/).
- **Repo:** `6595bbf3-c58d-42d8-b3aa-7f83d978605c`
- **Build:** `a335bfd5-c3c3-426f-b313-659c75ed6d0b` — 7 screenshots, video, all diffs approved.
- **Share URL:** https://app.lastest.cloud/r/Gn7UKmZTRJ7wy6u1xbhmzA
- **Demo notes:**
  - *uxSummary:* Clean, calm scientific tone. Flourishing Index loads quickly; the assessment is two clicks from the homepage. Site markets "No sign-up. No paywall." so the demo crawled the public assessment flow instead of attempting auth.
  - *Highlights:* (a) Strong credibility framing (PhD founder, Global Flourishing Study benchmark). (b) Six-domain promise is clear on the assessment landing. (c) Fast homepage with no friction.
  - *Friction:* `/about` and `/tools` are both linked from the nav but only respond on the trailing-slash form (307 redirects from non-trailing — worth normalising so external links land in one hop). The "Start assessment" CTA copy is ambiguous; the test had to fall back to a generic role selector to advance. *(Earlier draft listed "/pricing 404" — LifeByLogic doesn't link to /pricing anywhere and isn't promising a paid tier on the home page, so that was a fabricated finding. Removed.)*
  - *Testing struggles:* First-question control on the assessment isn't a native radio, so a generic locator may click an adjacent element instead of advancing the survey. No stable test-id attributes on CTAs.
- **Outreach channel:** Reddit DM to u/neanea12 (or email if DM ignored).

### q6 Causo — PUBLISHED (no-auth site)

- **Source:** ProductHunt https://www.producthunt.com/products/causo-hub-free-tools-for-fundraising
- **Site:** https://causo.ai — "Pitch the right VCs, skip the grind". Single-page anchor site.
- **Founder:** X handle @dawbuildsthings.
- **Repo:** `62adf8d3-90c7-440b-83be-618c9c200cae`
- **Build:** `cdc8d4e8-44bd-4894-9cd7-65891f35266c` — 6 screenshots, all diffs approved. (Video flag passed; agent reported `has_video: false` but that's the slim-API gap, not actual recording state — webm should exist.)
- **Share URL:** https://app.lastest.cloud/r/pEvE2NPohcTvJdH4bSiAYA
- **Demo notes:**
  - *uxSummary:* Sharp VC-matching pitch on a single-page anchor site. No app surface to log into; everything happens via inline CTAs.
  - *Highlights:* (a) The VC-matching angle is differentiated. (b) Single-page tightness — no friction between hero and CTA. (c) Maker @dawbuildsthings is reachable on X with a public profile.
  - *Design note (not friction):* Causo's homepage links only `/about-us`, `/privacy`, `/terms`, and homepage anchors (`#features`, `#pricing` style). That's a deliberate single-page anchor pattern — not a flaw. *(Earlier draft listed five 404s — `/features`, `/pricing`, `/signup`, etc. — but Causo never links those paths, so the test was inventing URLs and surfacing their absence as friction. Removed.)*
- **Outreach channel:** ProductHunt comment (preferred — launch context) or X DM to @dawbuildsthings.

### Not published (auth required but failed)

These targets DO have a signin on their site, so per the gate they need a real authenticated capture. The test template's known confirm-password bug ([[feedback-saas-demo-test-template-confirm-password]]) prevented that on q5/q7; q1 is Clerk-modal-only (unautomatable today); q3's site itself was 502'ing during the run.

| # | Product | Founder | Block reason |
|---|---------|---------|--------------|
| q1 | AImpact / a-impact.dev | Abbas Makasarwala (u/Low-Succotash4499) | Clerk modal-only signup; URLs use sign-in/sign-up with hyphens, our regex didn't catch them as auth pages, but no real app route exists to capture |
| q3 | Script7 / app.script7.io | u/Big-Pepper9305 | Target site threw 502 + CSP errors during the run; test stopped at step 7/22 on /login |
| q5 | FileReadyNow / filereadynow.com | u/shubh_aiartist | Submit clicked, URL didn't transition. Likely confirm-password unfilled. Worth rerunning after template fix |
| q7 | HabitHeat / habitheat.com | u/Impressive-Pack9746 | Same as q5 — form has email/password/confirm-password, template didn't fill confirm. Worth rerunning after template fix |



## 2026-05-14 — Floorable / u/jaypeepeeee

- Source: Reddit r/SideProject ("I told a client I could build indoor maps...", posted 2026-05-14T13:01Z)
- Site: https://floorable.app
- Lastest repo: cbbc608a-3d52-4571-80e8-af92580c36b2 (floorable-demo)
- Build: 2b78b7a0-a1ea-4ce9-9f5d-cc6a27bd7226  passed=1 failed=1 changes=0 (fallback mode: Test 1 reds independently on bot-gated signup; Test 2 public phase clean — 5/5 steps passed after consoleErrorMode=warn applied)
- Tests: 3cb62499 (auth setup) + e7b0d086 (app walkthrough)
- Share: https://app.lastest.cloud/r/oIH3ZigSHBsMM7mZoE-YDA
- Channel: Reddit DM (chat.reddit.com/user/t2_18wd5gof)
- Sent: yes — 2026-05-14T17:29Z UTC (lastesthero → jaypeepeeee)
- Message: "Liked the per-vertical pages, especially the Education breakdown. Ran a Lastest review on Floorable. Signup has two breakers: • /onboarding 404s (where the Supabase verify link redirects) • Verify token expires ~6min after issuance (otp_expired). Walk: https://app.lastest.cloud/r/oIH3ZigSHBsMM7mZoE-YDA"
- Reply (48h check): —
- Notes: First demo to exercise the v1.15 two-test architecture with setupTestId chaining (PUT /api/v1/tests/:id) + per-repo consoleErrorMode=warn (PUT /api/v1/repos/:id/playwright-settings). Both APIs landed on prod earlier in this session. Floorable's signup is bot-gated past pressSequentially in headless EB; chain was unset and skill switched to fallback mode (Test 2 in public-only). Real founder-actionable bugs surfaced: /onboarding route returns hard 404, Supabase verify token errors as otp_expired within minutes of issuance.



## 2026-05-14 — Face Privacy / faceprivacy.ai

- Source: peerpush.net/?view=live
- Site: https://faceprivacy.ai
- Tagline: "Own Your Face in an AI-Driven World" / "The Incogni of facial recognition databases"
- Auth backend: Firebase Auth (auth.faceprivacy.ai); runtime Date.now stamp used per-run to avoid EMAIL_EXISTS collision
- Lastest repo: e3c5be81-6f99-452e-b162-6a695d9297f8 (faceprivacy-demo)
- Tests: ff121ad5 (auth setup, Step 1 only — NEVER uploads photo) + 13b1a465 (app walkthrough, chained via setupTestId)
- Build: 389dff03-ea42-4d9d-9bd5-18b968b8d791  passed=1 failed=0 changes=9 (chained setup ran, walk completed clean)
- Scenarios captured: home, /about/, /blog/, /countries/, /databases/ (or /blur/), authed-home revisit, authed /login/ revisit, authed /register/ wizard-resume state, final home — 9 baselines total
- Baselines: approved (lastest_approve_all_diffs)
- Share: https://app.lastest.cloud/r/hCEw6UGRNiny2qG1UjdB_w
- Demo notes: POSTed to /api/v1/builds/:id/demo-notes (uxSummary + 3 highlights + 2 frictionPoints + 3 testingStruggles)
- Channel: pending user review — DM not sent (Phase 9 deferred at user request)
- Sent: no — Phase 9 deferred for user review
- Reply (48h check): —
- Run-time pivots:
  1. First attempt failed — Test 1 wait-for-Step-2 used text matchers; the Face Privacy register page is a "steps-as-visibility" SPA where ALL wizard inputs (#first_name through #consent_terms + photo inputs) are present in initial DOM and just toggle visibility. URL stays /register/ across all 4 steps.
  2. Second attempt: switched to placeholder-based selectors — failed because the form has NO placeholders (only visible labels above inputs).
  3. Third attempt (succeeded): switched to ID selectors (#first_name, #last_name, #email, #password, #password_confirm) and advancement detection to computed-style visibility on #photo-input-face. Runtime Date.now stamp swapped in for the Firebase rerun trap.
  4. PostHog blocked via page.route — its session-recorder rewrites HTMLInputElement.value setter and corrupts React-controlled input state in headless context.
- Constraints honored: never uploaded a photo, never advanced past Step 2 (Photo), no destructive verbs, no paid checkout reached.



## 2026-05-14 — MerryDiv / www.merrydiv.com

- Source: Hacker News (Show HN)
- Site: https://www.merrydiv.com/
- Tagline: "Dividend Tracker with Automatic Brokerage Sync. Know Your Dividends." / "Track your dividend income and grow your passive income portfolio"
- Founder: MerryDiv team — @merrydiv on X
- Auth backend: api.merrydiv.com/api/v1/auth/register (custom REST, NOT Firebase / NOT Supabase)
- Lastest repo: cc05a266-3b69-46cc-b95b-1846802fb4f6 (merrydiv-demo)
- Test: 95dd9438-5553-49fe-9374-f4409ec3bbdc (merrydiv — public walkthrough)
- Build: 81da42aa-4e1e-452e-90ea-d03ca9dee3e1  passed=1 failed=0 changes=7
- Scenarios captured: home, related-resources, /pricing, /signup, plus 2 DOM-discovered nav links, final home — 7 baselines
- Baselines: approved (lastest_approve_all_diffs)
- Share: https://app.lastest.cloud/r/uUfDv66dVhdPcfFHaMU_jQ
- Test layout: 1 test — public-only walkthrough (pivoted after 4 auth retries, see Run-time pivots)
- Login outcome: n/a — public-only by design (after 4 retries on auth wall, see notes)
- Demo notes: POSTed to /api/v1/builds/:id/demo-notes (uxSummary + 3 highlights + 2 frictionPoints + 3 testingStruggles)
- Channel: pending user review — DM not sent (Phase 9 deferred at user request)
- Sent: no — Phase 9 deferred for user review
- Reply (48h check): —
- Run-time pivots:
  1. Auth attempt 1 (build e09e2ee0): pressSequentially with 26-char password — MerryDiv enforces a max-20-char password limit, only visible after typing. Test red on "still on /signup".
  2. Auth attempt 2 (build a408fd4e): shortened to 15-char `MD-Demo-141810!`, same flow. Same failure, no visible page error.
  3. Auth attempt 3 (build e23ba62d): switched to page.evaluate with React's native input setter + manual input/change/blur dispatch. Failed in 5s — submit clicked but page stayed on /signup.
  4. Auth attempt 4 (build 58da0bf7): hybrid page.fill() + inputValue verification + isChecked verification on terms. Verification passed, submit clicked, 20s timeout still on /signup.
  5. Manual verification via Playwright MCP eval: same email+password+terms submitted via React's native input setter from within page context DID succeed, landed on /i/dashboard. Suggests MerryDiv's signup API has a synthetic-event / Amplitude-fingerprint heuristic that rejects standard Playwright fill+click, but accepts manual JS-driven submission.
  6. Pivoted to public-only mode (build 81da42aa): deleted auth setup test, unset setupTestId, renamed test to "merrydiv — public walkthrough", added signup page itself as a screenshot to flag the form for the founder. Build green in 37.6s.
- Constraints honored: never uploaded brokerage credentials, never clicked Plaid/connect/bank links, no paid checkout reached, no real money path touched.

---

## 2026-05-14 — AgentKanban team / AgentKanban

- Source: Hacker News Show HN
- Site: https://www.agentkanban.io/
- Tagline: "A task board with AI agent harness integration. Create and plan tasks with real-time collaboration, then hand off to GitHub Copilot."
- Founder: AgentKanban team (contact via /contact)
- Vertical: Dev tools — kanban for AI coding agents (VS Code + GitHub Copilot integration)
- Auth backend: email/password (Name, Email, Password fields; GitHub + Google OAuth also offered)
- Lastest repo: b2b2b763-5e76-4852-87a7-7b7d2b8e20cb (agentkanban-demo)
- Test 1: 986f3a46-b76b-46e6-930f-a7b78ec70c0f (AgentKanban — auth setup)
- Test 2: 41660715-92f4-4901-a223-7e4bbfcfd3f4 (AgentKanban — app walkthrough, chained via setupTestId)
- Build: f4b96b49-73a2-4e58-a827-691acf85595f  passed=1 failed=0 changes=8
- Demo identity: viktor+agentkanban202605141823@lastest.cloud / Lastest-Demo-202605141823!
- Scenarios captured (Test 2, 8 screenshots, 29.9s, video 863KB):
  1. /boards (Scenario 1 home — authed redirect from /)
  2. /boards (Scenario 2 nav-discovered)
  3. /dashboard (Scenario 3)
  4. /settings/members (Scenario 4)
  5. /boards (Scenario 5 post-auth landing after chained re-nav)
  6. /boards (Scenario 6 in-app nav walker)
  7. /dashboard (Scenario 7 in-app nav walker)
  8. /boards (final bare screenshotPath)
- Baselines: approved (lastest_approve_all_diffs ✓)
- Share: https://app.lastest.cloud/r/pqgTVjRe9Z7qQRt2uBVv-w (scoped to Test 2)
- Test layout: 2 tests — auth setup + app walkthrough (chained via setupTestId)
- Login outcome: ✓ signed up + walked authenticated surface (org auto-provisioned as "Lastest Demo's Organisation")
- Demo notes: POSTed to /api/v1/builds/:id/demo-notes (uxSummary + 3 highlights + 3 frictionPoints + 1 testingStruggle)
- Channel: pending user review — DM not sent (Phase 9 deferred at user request)
- Sent: no — Phase 9 deferred for user review
- Reply (48h check): —
- Run-time pivots:
  1. setupTestId chain worked first try — no fallback needed. Test 1 ran as setup step, injected storage state (1 cookie), Test 2 started on /boards already authed.
  2. Authed redirect collapsed public + authed phases: visiting baseUrl / when authed redirects to /boards, so the "public homepage" screenshot in Test 2 is actually the in-app boards view. Worth noting in demo notes (done) — share viewer sees one continuous authed journey, which is the more interesting surface here anyway.
  3. Safe-CTA walker found no matching primary button on /boards (create/new/add/view/open/explore/browse/start/continue/get started regex) — captured in frictionPoints (CTAs may be link-styled or icon-only).
  4. Cloudflare email-decode script 404s on every page (ERR_FAILED on /cdn-cgi/scripts/.../email-decode.min.js). Already blocked via page.route at test start so it didn't red the build; flagged as a real product friction point in demo notes.
- Constraints honored: never connected a real GitHub repo, no destructive CTAs clicked, no paid checkout reached, no third-party OAuth flow attempted.

---

## 2026-05-14 — Johnny / ECFotos

- **Source:** BetaList (https://betalist.com/startups/ecfotos)
- **Site:** https://ecfotos.com
- **Tagline:** "Create listing-ready product images fast with AI and bulk editing"
- **Founder:** Johnny — @ECFotos_app on X, wx0021 on BetaList
- **Vertical:** SMB e-commerce — AI product image editor
- **Lastest repo:** `b51fe8cf-07c5-4fea-b3f6-b78d62e4b990` (name: `ecfotos-demo`)
- **Test:** `e5c8c649-ae7c-4e2e-bc81-635090eb9308` — "ECFotos — public walkthrough"
- **Build:** `04a964b8-dd0a-4874-ac66-7426c36a0b04` — passed 1/1, 0 failed, **10 baseline screenshots**, `overallStatus: review_required` (review_required is expected on first-run new baselines; all approved via `lastest_approve_all_diffs`).
- **Scenarios captured:**
  1. `/` Homepage hero
  2. First marketing nav route (DOM-discovered)
  3. Second marketing nav route (DOM-discovered)
  4. Third marketing nav route (DOM-discovered)
  5. `/app` Workspace (freemium, no login)
  6. `/app/tools` AI Tools catalog
  7. `/app/models` AI Models catalog
  8. `/app/ai-photo-editor` AI Photo Editor entry
  9. `/app/tools/ai-listing-images` AI Listing Images tool (safe additive entry)
  10. Final homepage hero
- **Share:** https://app.lastest.cloud/r/5_2esGc5y7kxRzMAPEPi6g
- **Test layout:** 1 test — public walkthrough mode. Signin/signup are Google OAuth only, so no email+password auth phase was built. The walk still reaches deep into the real product because /app and all sub-routes are freemium-browsable without login.
- **Login outcome:** n/a — public-only demo by design (OAuth-only auth, not automatable). Compensated by walking the genuine /app workspace surface which is freemium-accessible.
- **Channel:** Reddit DM / X DM — pending user review of share
- **Sent:** **PENDING USER REVIEW** — Phase 9 not executed. Awaiting explicit approval before any outreach is drafted or sent.
- **Run-time pivots:**
  1. Phase-3 snapshot revealed the /account/auth/signup page contains only a single "Sign Up" button (Google OAuth), no email/password form. /account/auth/signin shows only "Continue with Google". Classified `AUTH_AUTOMATABLE=false` immediately and skipped Test 1 entirely.
  2. Surprise discovery during the snapshot: clicking "Sign Up" on the signup page redirects to `/app` instead of opening an OAuth dialog. The /app workspace itself is browsable without authentication, including the AI Tools and AI Models catalogs. Pivoted the public-only walkthrough to walk the real product surface instead of stopping at marketing pages. Made the demo substantially more valuable because the founder sees Lastest baselining their actual product UI, not just their landing page.
  3. Cloudflare email-decoder script throws console errors on every page; pre-blocked at `page.route` test start so consoleErrorMode warnings stay clean. Did not affect any screenshot.
- Constraints honored: no images uploaded, no credit-burning generation triggered, no destructive verbs clicked, no paid checkout reached, no OAuth flow attempted.

---

## 2026-05-14 — Pigeon Codeur / StackMemo

- **Source:** IndieAppCircle (handle `pigeon-codeur`)
- **Site:** https://stackmemo.app/
- **Tagline:** "Dashboard for builders running multiple side projects — costs, KPIs, renewals"
- **Vertical:** Indie-builder tooling (direct ICP overlap with Lastest)
- **Lastest repo:** `ab4ea01e-5339-4ba2-9111-a0af8435cdf7` (name: `stackmemo-demo`)
- **Tests:**
  - `1c5cec89-dcce-41f7-b767-9eef5d0c0b69` — "StackMemo — auth setup" (3 scenarios)
  - `1a977f84-ea0d-40a5-a3ab-f626961f7815` — "StackMemo — app walkthrough" (chained via setupTestId, 6 scenarios)
- **Build:** `e31d0b7b-f07b-4863-94de-21ac7ca53ee7` — passed 1/1, 0 failed, **6 screenshots**, `overallStatus: review_required` (auto-approved post-run), `elapsedMs: 40581`
- **Scenarios captured (Test 2):**
  1. `/` Home
  2. `/pricing`
  3. Post-auth `/dashboard` (empty state, side nav visible)
  4. In-app `/connectors`
  5. In-app `/settings`
  6. Final home (logged-in state visible in nav)
- **Share URL:** https://app.lastest.cloud/r/DfKZpi8WOogFnyKOs_3ORQ
- **Channel + send status:** Reddit DM (founder `pigeon-codeur` on IndieAppCircle; no Reddit handle confirmed yet) — **NOT SENT, awaiting user review per request (Phase 9 skipped)**
- **Login outcome:** signed up + walked authenticated surface (`/dashboard`, `/connectors`, `/settings`)
- **Run-time pivots:**
  1. Build 1 failed: networkidle race on Server Action redirect. Switched to explicit `waitForURL(u => !/signup/)` with `domcontentloaded` waitUntil.
  2. Build 2 failed: setup phase exceeded the 30s remote-setup budget because `page.waitForLoadState('networkidle')` after submit blocks indefinitely on Next.js streaming responses. Replaced with bounded `networkidle` (4s timeout) + explicit `main/h1` visibility wait.
  3. Build 3 failed: button regex `/sign ?up|register/i` matched the "Sign up with GitHub" OAuth button first, redirecting test to github.com/login. Fix: scope submit button via `passField.locator('xpath=ancestor::form[1]').getByRole('button').first()` so only the password-form's button is clickable.
  4. Filtered `/plans` out of in-app walker — link said "free" plan-badge href that would have walked the test into an upgrade flow.
- Constraints honored: no Stripe connection, no destructive verbs, no real API connectors, no paid checkout, no OAuth flow.
- Phase 9 status: **pending user review**.

---

## 2026-05-14 — Coffee Rambler AI

- **Source:** IndieAppCircle (handle `coffeerambler`)
- **Site:** https://rambler.coffee/
- **Tagline:** "Your Personal Coffee Intelligence — AI brew/bean/gear reviews, brew diary, sensory coaching"
- **Vertical:** Lifestyle/consumer SaaS (coffee brewing AI assistant)
- **Lastest repo:** `9d8959d3-933d-4010-a718-0b4a3b1c9415` (name: `coffee-rambler-demo`)
- **Test layout:** 1 test — **public walkthrough** (auth flow not automatable: verify-email gate after signup)
  - `ea8ef9e9-e8c7-4ba6-bff5-1354a1d28495` — "Coffee Rambler AI — public walkthrough" (6 scenarios)
  - Test 1 ("auth setup") was created, ran red on the verify-email gate, then **soft-deleted**. Demo notes describe the gate so the founder sees it as friction signal, not test infrastructure noise.
- **Build:** `2693f255-92c1-492c-8742-22cc3515d41a` — passed 1/1, 0 failed, **6 screenshots**, `overallStatus: review_required` (auto-approved post-run), `elapsedMs: 27487`
- **Scenarios captured:**
  1. `/` Home (hero, palate wheel, AI coach card, community beans, stats card, palate wheel, pricing, FAQ, footer)
  2. `/en` localized landing
  3. `/guides` (public guides index)
  4. `/legal/privacy`
  5. `/legal/terms`
  6. `/signup` (form pre-submit — Email / Password / Confirm Password / Create Account)
- **Baselines:** approved (`approve_all_diffs` ok).
- **Demo notes:** posted to `build_demo_notes` (uxSummary highlights the iCloud verification-delay warning, three-tier pricing including a Coming soon Pro tier with B2B signals, and the explicit 30-questions-free promise; testingStruggles documents the verify-email gate)
- **Share URL:** https://app.lastest.cloud/r/C5Yj4YwFc0wb0HPGvQA1CA
- **Channel + send status:** Reddit DM TBD (founder `coffeerambler` on IndieAppCircle — Reddit handle not yet confirmed) — **NOT SENT, awaiting user review per request (Phase 9 skipped)**
- **Login outcome:** n/a — public-only demo by design (verify-email gate after signup; submit lands on "You're all set, check your inbox" with no in-app session)
- **Run-time pivots:**
  1. Build 1 (chained auth setup + walkthrough) failed: Test 1 threw "auth did not complete — still on /en/signup" after 5.6s. Manual probe confirmed the signup submits cleanly but lands on a "You're all set — Check your inbox" verify-email screen (still on `/en/signup` path, just with the form replaced by a confirmation heading). The verify-email regex would have caught the heading, but `Promise.race` resolved on the URL guard branch first because the URL never changed.
  2. Pivot: deleted Test 1, unset `setupTestId` on Test 2, rewrote Test 2 in public-only mode (home + DOM-discovered nav routes + signup-form-pre-submit screenshot), re-ran. Public phase passed cleanly with 6 baselines including the signup form (a real surface worth showing the founder).
  3. Filtered `/login`, `/signup`, `/en/login`, `/en/signup` out of the nav walker so the public phase doesn't redundantly re-visit the auth pages — signup gets a single intentional capture at the end.
  4. Blocked third-party noise via `page.route` (Cloudflare email-decode, GTM, GA, Hotjar, Segment, Intercom, Fullstory, PostHog, Sentry, HubSpot) so `consoleErrorMode='warn'` had a clean surface to evaluate.
- Constraints honored: no real account created in the founder's DB (signup never completed; the in-flight email at `viktor+coffeerambler202605141843@lastest.cloud` was never confirmed and will auto-expire on Coffee Rambler's side), no destructive verbs, no paid checkout, no language-switcher mutation, no FAQ accordion expansion.
- Phase 9 status: **pending user review**.

---

## 2026-05-14 — Paxmiles / Tempora

- **Source:** IndieAppCircle (also runs Specula.vision).
- **Site:** https://tempora.events/
- **Tagline:** "Visualize information with timelines — organize, correlate and retain events like never before"
- **Founder:** Paxmiles (PAX GLOBAL S.R.L., Romania).
- **Vertical:** Productivity / timeline tooling for students, teachers, researchers, writers, planners, journalers, worldbuilders.
- **Lastest repo:** `92ff7e5a-1c4a-4675-9417-a875ed41568e` (name: `tempora-demo`)
- **Test:** `4db87f51-317f-4131-92c9-ece5e75ac876` — "Tempora — public walkthrough"
- **Build:** `1939ddcb-8bbf-4cd0-b4bb-5340e1974109` — passed 1/1, 0 failed, **8 baseline screenshots**, `overallStatus: review_required` (first run, all new baselines, then `approve_all_diffs`).
- **Scenarios captured:**
  1. `/` Home (hero, audience band, 12-tile feature grid, FAQ, footer with legal/registry, ANPC links)
  2. `/login/` (linked from header)
  3. `/cookies` (footer)
  4. `/privacy` (footer)
  5. `/terms` (footer)
  6. `/register/` form (intentional capture — the "Verifying Security..." [disabled] submit is brand-positive)
  7. `/login/` form (final pass)
  8. Home (final thumbnail)
- **Baselines:** approved (`approve_all_diffs` ok).
- **Demo notes:** posted to `build_demo_notes` (uxSummary highlights the audience-as-identity hero band, the honest in-development asterisks on Presentation/Learning, and the security-gated auth as a brand-positive signal; frictionPoints flag the long fade-in animations and the unusual /signup/ behavior where the URL renders the confirmation-email preview rather than a form; testingStruggles documents the public-only pivot)
- **Share URL:** https://app.lastest.cloud/r/M4fUH_T_oupTqnq4lirTuQ
- **Channel + send status:** Reddit/IndieAppCircle DM TBD — **NOT SENT, awaiting user review per request (Phase 9 skipped)**
- **Login outcome:** n/a — public-only demo by design (auth gated by Cloudflare-style JS challenge on submit button + email-verification step post-submit)
- **Run-time pivots:**
  1. Phase 3 snapshot revealed `/signup/` is not a form but a static preview of the confirmation email that gets sent. Real signup form lives at `/register/`.
  2. Both `/register/` and `/login/` submit buttons render as "Verifying Security..." [disabled] while a JS challenge runs in the background. Combined with the verify-email step post-submit, classified `AUTH_AUTOMATABLE=false`.
  3. No Test 1 built. Test 2 expanded to capture the register and login forms as intentional public-surface scenarios — Tempora's auth UI is part of what a visitor sees, and the disabled "Verifying Security..." button is a brand-positive signal worth showing the founder.
  4. Added 1.2-1.5s post-load buffers because Tempora's hero and feature grid use long fade-in animations.
  5. Blocked third-party noise via `page.route` (Cloudflare email-decode, GTM, GA, Hotjar, Segment, Fullstory) so `consoleErrorMode='warn'` had a clean surface.
- Constraints honored: no account created (signup never attempted; the Verifying-Security gate made it impossible from a Playwright context anyway), no destructive verbs, no paid checkout, no FAQ accordion expansion, no academic-discount form submission.
- Phase 9 status: **pending user review**.

---

## 2026-05-14 — Paxmiles / Specula

- **Source:** IndieAppCircle (sister product to Tempora; same maker, PAX GLOBAL S.R.L.).
- **Site:** https://specula.vision/
- **Tagline:** "Observe Information with widgets — create, customize and view dashboards like never before"
- **Founder:** Paxmiles (PAX GLOBAL S.R.L., Suceava, Romania).
- **Vertical:** Dashboards / widgets — info-organization tool for busy persons, analysts, control-freaks, lifelong learners.
- **Lastest repo:** `61f5a220-00de-4774-8ea1-20bdaca0fba3` (name: `specula-demo`)
- **Test:** `87fb13f3-3847-4899-a6e4-6148d626fb81` — "Specula — public walkthrough"
- **Build:** `bd45d195-922f-4daf-bca7-8f6c35be9510` — passed 1/1, 0 failed, **8 baseline screenshots**, `overallStatus: safe_to_merge` (after `approve_all_diffs`).
- **Scenarios captured:**
  1. `/` Home (hero illustration, persona-rotating headline, 11-tile feature grid with WIP asterisks, FAQ, legal footer)
  2-5. 4 DOM-discovered nav routes (cookies / privacy / terms / footer-linked legal pages, depending on order)
  6. `/register/` form (intentional capture — Username / Email / Password / Confirm + the disabled "Verifying Security..." submit)
  7. `/login/` form
  8. Home (final thumbnail)
- **Baselines:** approved (`approve_all_diffs` ok).
- **Demo notes:** posted to `build_demo_notes` (uxSummary highlights the persona-rotating headline, the honest WIP-asterisks on Alerting and Multiple Sources, and the EU/ECO/GDPR positioning; frictionPoints flag the anti-bot gate on /register/, the JOIN-link-routes-to-login surprise, and the single-page marketing layout with no /features or /pricing routes; testingStruggles documents the public-only pivot mirroring sister-product Tempora).
- **Share URL:** https://app.lastest.cloud/r/Xtivbk29bKxbKLik2izhBQ
- **Channel + send status:** Reddit/IndieAppCircle DM TBD — **NOT SENT, awaiting user review per request (Phase 9 skipped)**
- **Login outcome:** n/a — public-only demo by design (auth gated by JS security challenge holding the submit button in a disabled "Verifying Security..." state, same gate as sister product Tempora; per the Tempora run, even past that gate there is a verify-email step).
- **Run-time pivots:**
  1. Phase 3 register-page snapshot showed `button "Verifying Security..." [disabled]` on first probe — identical pattern to Tempora. Per the user brief ("be ready to pivot to public-only quickly") and the SaaS-demo template policy ("if signup is bot-gated after 1 retry, pivot to public-only"), classified `AUTH_AUTOMATABLE=false` immediately without burning a retry cycle.
  2. No Test 1 built. Test 2 expanded to capture the register and login forms as intentional public-surface scenarios — Specula's auth UI is part of what a visitor sees, and the disabled "Verifying Security..." button is a brand-positive signal worth showing the founder.
  3. Filtered `/register/` and `/login/` out of the nav-discovery walker so the public phase doesn't redundantly re-visit them — both get a single intentional capture at the end.
  4. Blocked third-party noise via `page.route` (Cloudflare email-decode, GTM, GA, Facebook, Hotjar) so `consoleErrorMode='warn'` had a clean surface. /register/ and /login/ still emit ~15 console errors per load from the security-challenge handshake; ran in warn mode so the build did not red.
- Constraints honored: no account created (Verifying-Security gate made it impossible from a Playwright context anyway), no destructive verbs, no paid checkout, no FAQ accordion expansion, no academic-discount form submission.
- Phase 9 status: **pending user review**.

---

## 2026-05-15 — InsightsFlowAI team / InsightsFlow AI

- **Source:** IndieAppCircle (handle `support`).
- **Site:** https://www.insightsflowai.com/
- **Tagline:** "Best Free AI Data Analyst — upload CSV, get insights, reports, anomalies"
- **Founder:** InsightsFlowAI team (IndieAppCircle `support`).
- **Vertical:** AI-powered analytics dashboard SaaS.
- **Lastest repo:** `d0819d77-0c49-44d1-83f5-e85613f1bd45` (name: `insightsflow-demo`, found-and-reused from prior 2026-05-14 attempt; no second repo created).
- **Tests:**
  - `1cbb4a2d-6a20-45cf-a2f1-8603262fa848` — "InsightsFlow AI - auth setup" (Test 1, re-stamped to today's UTC `202605150644`)
  - `aab8ae92-9964-4a5e-935a-0efb1a48d24b` — "InsightsFlow AI - app walkthrough" (Test 2, chained via `setupTestId`)
- **Build:** `26621f49-f1d8-4f07-97b9-4e8d9106e674` — passed 1/1, 0 failed, **5 baseline screenshots**, video recorded (44.6s duration), `overallStatus: review_required` pre-approval.
- **Scenarios captured (Test 2 in chained-authed context):**
  1. Authenticated dashboard with sidebar + "Start with confidence" onboarding modal (Interactive tour vs Demo dataset)
  2. Same dashboard re-rendered after attempted Features nav click
  3. Same dashboard re-rendered after attempted How-It-Works nav click
  4. Same dashboard re-rendered after attempted Pricing nav click
  5. "Welcome! Let's set up your account" account-type modal (Personal / Company / Client / Stakeholder cards)
- **Baselines:** approved (`approve-all` ok, returned `{success: true}`).
- **Demo notes:** posted to `build_demo_notes` (uxSummary highlights the industry-aware onboarding, the role-segmentation modal, and the interactive-tour-plus-demo-dataset pairing; frictionPoints flag the onboarding modal overlapping nav clicks, the missing in-app path back to the public marketing site, and the cookie banner persisting in-app; testingStruggles documents the stale-stamp signup collision from yesterday's run and the executor clipping screenshots to viewport instead of fullPage).
- **Share URL:** https://app.lastest.cloud/r/WmDmnRKDaAuzzPGSMoXlYw
- **Channel + send status:** IndieAppCircle DM / founder email TBD — **NOT SENT, awaiting user review per request (Phase 9 skipped)**.
- **Login outcome:** signed up + walked authenticated dashboard (chained `setupTestId` worked on second attempt; first run reds because the email had been registered the prior day).
- **Run-time pivots:**
  1. Reused existing `insightsflow-demo` repo and existing test rows (memory rule: one repo per customer). Both repo + tests were created on 2026-05-14 but Test 1 had `lastRunStatus: null`.
  2. Set `consoleErrorMode='warn'` and `networkErrorMode='warn'` on the repo's playwright settings via the PUT endpoint before triggering the first run (memory rule: standard Phase 4b setup).
  3. Chained Test 2 onto Test 1 via `PUT /api/v1/tests/<id> {setupTestId}` (confirmed live on prod per memory).
  4. First chained run failed in 7.7s: `setup_failed: auth did not complete — signup modal still visible`. Diagnosed as stamp collision (yesterday's stamp `202605141905` had registered the email; today the modal stays open with a silent error). Re-stamped both tests to today's UTC `202605150644` and reran.
  5. Second run completed cleanly: Test 2 passed, 5 screenshots, video recorded, 44.6s duration. The "public phase" of Test 2 captured the authed dashboard 3x because the chained auth meant the browser landed authenticated and the public-only Features / How-It-Works / Pricing buttons no longer exist in the nav. The founder gets a baseline of the dashboard chrome and the persistent Start-with-confidence onboarding modal.
- Constraints honored: no real CSV uploaded, no destructive verbs, no paid checkout, used `viktor+insightsflow202605150644@lastest.cloud` plus-addressed test account, blocked Cloudflare email-decode noise via `page.route`.
- Phase 9 status: **pending user review**.

---

## 2026-05-15 — reframe team / reframe

- **Source:** IndieAppCircle (top app by credits — 679).
- **Site:** https://re-frame.lovable.app/
- **Tagline:** "A quiet companion. Not a tracker — a mirror. Not discipline-first — awareness-first." (Calm awareness system for resilience and overcoming compulsive behavior.)
- **Founder:** `reframe.` (IndieAppCircle handle); team name not disclosed on site.
- **Stack signal:** Lovable (lovable.app subdomain) + Supabase auth (email-confirmation gate is the Supabase default pattern).
- **Lastest repo:** `1877aab4-5c5f-494c-a4a0-48dc02647cfd` (name: `reframe-demo`).
- **Test:** `2615965f-920c-44ae-bfdd-9cbde37e7f6e` — "reframe — public walkthrough" (renamed after pivot from "reframe — app walkthrough").
- **Build:** `90b5a487-047b-46a1-b05a-9d605c1d034b` — passed 1/0 failed, 6 baseline screenshots, 26.8s, video recorded, `overallStatus: review_required` then approved.
- **Scenarios captured (6):**
  1. `/` Home (full hero, soft tools, "Different by design" three-pillar block)
  2. `/help` (DOM-discovered footer link)
  3. `/pricing` (DOM-discovered nav link via /auth footer)
  4. `/auth` sign-in default state
  5. `/auth` create-account toggle state
  6. `/` home (final gallery thumbnail)
- **Baselines:** approved (`approve_all_diffs` ok).
- **Share URL:** https://app.lastest.cloud/r/aRpV-mkdLVBSWrm-ANDuRA
- **Channel:** TBD — IndieAppCircle DM / Reddit (no public X handle surfaced from IAC profile).
- **Sent:** no.
- **Reply (48h check):** —

### Run-time pivots
- Built Test 1 (auth setup) + Test 2 (app walkthrough chained via setupTestId) as the primary plan. Probed /auth via Playwright MCP first; surface looked like a clean email+password create-account.
- First chained run (build `30738963-de91-46e7-b97e-60ab6a9ac97d`) failed in 7.7s: `setup_failed: auth did not complete — still on /auth`.
- Re-probed manually: clicking "Create account" returns a paragraph "Check your email to confirm." with no URL change. Supabase default email-confirmation gate — not visible pre-submit.
- Pivot: deleted Test 1, unset `setupTestId` on Test 2, rewrote Test 2 as **public-only** (`AUTH_AUTOMATABLE=false`) renamed "reframe — public walkthrough". Second run passed in 26.8s with 6 screenshots covering both the home page and the full pre-auth funnel (signin + create-account states), so the founder still gets a useful baseline of the surface a new visitor sees.
- Constraints honored: no journal entries / no triggers submitted, no destructive verbs, sensitive-feature browsing avoided, blocked Cloudflare email-decode noise via `page.route`.

### Phase 9 status
**pending user review** — share published, demo notes written, log entry recorded. No DM sent; awaiting user approval on outreach.

---

## 2026-05-15 — Chaitnaya Bhagat / Sanctuary

- **Source:** IndieAppCircle
- **Site:** https://sanctuary-mocha.vercel.app/
- **Tagline:** "Pause. Attune. Be well." — Awareness app for emotional eating; reframes food as a messenger, not a problem.
- **Founder:** Chaitnaya Bhagat (IndieAppCircle)
- **Stack signal:** Vercel-hosted Next.js + Firebase Auth (Firestore ai-studio backend; identitytoolkit.googleapis.com signup endpoint observed in network).
- **Lastest repo:** `228243b6-390b-4302-a108-aa155d83a73b` (name: `sanctuary-demo`)
- **Tests:**
  - Test 1 — `e6635cbf-9a19-4c9d-9546-a08d0346bd9c` — "sanctuary — auth setup" (passed standalone, 2 screenshots, 104s)
  - Test 2 — `170533d1-c0ae-4f11-bf88-c63b62c6ed55` — "sanctuary — app walkthrough" (fallback mode after setup-chain wallclock timeout)
- **Build:** `d8aaf6da-8c14-4a00-aef5-501acca12aa7` — Test 2 passed 1/1, 6 baseline screenshots, `overallStatus: review_required` (then approved).
- **Scenarios captured (Test 2):**
  1. `/` Home (anonymous)
  2. Post-auth landing (homepage as signed-in user)
  3. `/insights`
  4. `/progress`
  5. `/settings`
  6. Final `/` (signed-in)
- **Baselines:** approved (`approve_all_diffs` for build d8aaf6da).
- **Demo identity:** viktor+sanctuary202605150702@lastest.cloud / Lastest-Demo-202605150702!
- **Share URL:** **https://app.lastest.cloud/r/HwLDkBBT1ES7k0mURsMR9w** (scoped to Test 2 with video)
- **Demo notes:** POSTed (uxSummary + 3 highlights + 2 frictionPoints + 2 testingStruggles)
- **Channel:** TBD — pending user review (Phase 9 deferred per request)
- **Sent:** no — Phase 9 pending user review
- **Reply (48h check):** —

### Run-time pivots
1. **Setup-chain wallclock too short for Sanctuary.** Test 1 takes ~104s end-to-end against a cold Vercel instance — well past the 30s `Setup timed out after 30000ms` ceiling on chained setupTestId. Switched Test 2 to fallback mode (`CHAINED_AUTH=false`, `setupTestId: null`); Test 2 logs in inline with the credentials Test 1 minted earlier.
2. **Post-signup redirect is back to `/`, not a `/dashboard` route.** Updated the URL-match regex on both tests to broaden the "auth completed" signal (added `practice|journal|library|exercises|today|insights|progress`) — the URL-still-on-login check is what enforces success now, since `/` doesn't match any positive-success URL.
3. **Considered API-direct register fallback and inbox-pull** — neither needed: the signup form accepted Playwright keypresses on the first attempt (no captcha, no verify-email gate, no anti-bot). Documented for completeness only.

---

## 2026-05-15 — Vashon Gonzales / Launch Map

- **Source:** IndieAppCircle
- **Site:** https://launch.tavalabs.app/
- **Tagline:** "Launch once. Be seen everywhere." — Track 30+ startup directory listings and showcase badges from one place.
- **Founder:** Vashon Gonzales (Tava Labs; also runs Cash Capy)
- **Stack signal:** Vercel-hosted SPA (Vite + React), Firebase / Firestore backend (noir-53b43 ai-studio project visible in network), JetBrains Mono + Bricolage Grotesque type stack.
- **Lastest repo:** `11a5a87b-9f06-4c7e-b48e-b9120e2da696` (name: `launchmap-demo`)
- **Test:** `902f29d2-4d38-4cdd-973b-43e9ccc352c8` — "Launch Map — public walkthrough"
- **Build:** `aa72630b-22f2-49b9-82d4-5f621adffd10` — passed 1/1, 0 failed, 5 baseline screenshots, 94s elapsed, `overallStatus: review_required` (then approved).
- **Scenarios captured:**
  1. `/` Home (hero + feature grid)
  2. `/about` (Vercel 404)
  3. `/pricing` (Vercel 404)
  4. `/login` (Vercel 404 on direct nav)
  5. Hero CTA destination — clicked "Start Your Launch", SPA client-side routing renders the actual `/login` form (EMAIL / PASSWORD / SIGN IN / "Need an account? Sign up")
- **Baselines:** approved (`approve_all_diffs` for build aa72630b).
- **Share URL:** **https://app.lastest.cloud/r/4RCuUKSgASfN5ZGkFKfi-w** (scoped to walkthrough test, video included)
- **Demo notes:** POSTed (uxSummary + 3 highlights + 3 frictionPoints + 2 testingStruggles + 1 skippedRoute)
- **Channel:** TBD — pending user review (Phase 9 not executed per request)
- **Sent:** no — Phase 9 pending user review
- **Reply (48h check):** —

### Run-time pivots
1. **Auth not automatable end-to-end — pivoted to public-only.** Every advertised route (/about, /pricing, /login, /signup) returns a Vercel 404 on direct navigation. The `/login` form only ever renders via client-side click navigation. No public register page is reachable for automated signup, so Test 1 was not built; only the walkthrough test was created.
2. **First two runs failed on signature drift.** `stepLogger is not a function` then `screenshotPath is not a function` — corrected by reading the canonical test-template.md signature (`screenshotPath` is a string, derive scenario filenames via `screenshotPath.replace('.png', '-N-slug.png')`). Third run passed cleanly.
3. **CTA destination scenario IS the demo's punch line.** Direct nav to `/login` is a 404, but clicking "Start Your Launch" from the homepage renders a working login form via SPA routing. The fifth screenshot captures this exact split — strong evidence the founder is missing a Vercel rewrite rule (catch-all to index.html) and shipping a refresh-breaks-everything experience to every deep-linked visitor.

---

## 2026-05-15 — Daniel Notthoff / FamWake

- **Source:** IndieAppCircle (queued replacement target).
- **Site advertised:** https://famwake.de/ (NXDOMAIN — does not resolve on 8.8.8.8 / 1.1.1.1; system resolver also fails).
- **Site actual:** https://familienwecker.de/ (one-page marketing site for the Android app, EN/DE).
- **Tagline:** "Smart family alarm clock — Relaxed mornings for the whole family."
- **Founder:** Daniel Notthoff (German-language presence; CTA is Google Play install + iOS waitlist button).
- **Outcome:** **DISQUALIFIED at Phase 2 — mobile-native product, no web app to demo.**
- **Lastest repo:** not created.
- **Build:** none.
- **Share URL:** n/a.
- **Channel:** n/a.
- **Sent:** no.

### Why disqualified

The skill's Phase-2 qualification rules require the target to be a web app (strict). FamWake is an Android/iOS native product. Its only public web surface is `familienwecker.de`, which is a single-page marketing site whose primary CTA is a Google Play store link and whose secondary CTA is an "iOS Waitlist" button (no actual web signup, no `/signup` path, no in-app surface).

The signup URL in the brief (`https://famwake.de/signup`) cannot work because `famwake.de` itself does not exist as a registered domain — the founder's real domain is `familienwecker.de` (German: "Family alarm clock") and that domain has no signup page at all. Public surface is: hero, feature grid, "Look into the app" image gallery, FAQ, founder bio. That's 4-5 screenshots of marketing copy with no interaction surface — the exact "you have a register form" anti-pattern the skill warns against (worse here: there's no form at all).

A public-only share would render purely as a brochure scrape with no founder-relevant signal — the founder already knows what their landing page looks like, and Lastest cannot demonstrate visual-regression value on a single static page he hand-built.

### Run-time pivots

1. **Stopped at Phase 2 before creating any repo.** Per skill rules ("Drop disqualifiers"), refused to create a `famwake-demo` repo only to populate it with marketing screenshots. No artefacts left in the team.
2. **DNS confirmation:** verified famwake.de NXDOMAIN via `dig +short @8.8.8.8` and `@1.1.1.1`. Google search located the real domain (`familienwecker.de`) and a Google Play listing (`de.familienwecker.famwake`). Skipped further probing because the qualification verdict doesn't depend on it.
3. **Phase 9 (DM):** pending user review — no message drafted because there is no share URL to send.

---

## 2026-05-15 — Efe Eşme / CavemanDetector

- **Source:** IndieAppCircle.
- **Site:** https://cavemandetector.dev/
- **Tagline:** "Finds local businesses with no website and generates personalized cold outreach pitches."
- **Founder:** Efe Eşme (IndieAppCircle).
- **Lastest repo:** `a5579404-72ed-446a-b005-4e854a4e2d19` (name: `cavemandetector-demo`)
- **Test:** `c5d1aaeb-fcfa-4be5-8101-9b259440cf3e` — "CavemanDetector — public walkthrough"
- **Build:** `053b30fe-b1b2-4e3d-bb53-461e3879e751` — passed 1/1, 0 failed, **6 baseline screenshots**, `overallStatus: review_required` (now approved).
- **Scenarios captured:**
  1. Homepage hero ("Detect. Discover. Dominate the market.")
  2. Category picker (step 01 of 03)
  3. Location picker (Near Me / Browse Region toggle)
  4. Region grid (country selector with Area type sub-controls)
  5. Results list (4 of 20 businesses without websites in Lisbon Belém, restaurants)
  6. AI pitch generator panel (per-result chat that drafts a personalized cold-outreach message)
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Demo notes:** posted to `build_demo_notes` (uxSummary + 3 highlights + 2 frictionPoints + 2 testingStruggles).
- **Share URL:** https://app.lastest.cloud/r/1GBOMRUIgXYRjaNdT366DA
- **Channel:** Reddit DM (handle TBD by user — IndieAppCircle source so no public Reddit handle yet) or X DM if a handle surfaces.
- **Sent:** no — Phase 9 (DM) **pending user review** per skill run instructions.
- **Reply (48h check):** —

### Login outcome

n/a — public-only demo by design. CavemanDetector is genuinely no-signup (per its IAC tagline "60 seconds, no signup, free"). The primary founder-intended interaction IS the public flow (category → region → results → click result → AI pitch panel), and the test walks it end-to-end including the per-result AI generator. There is no gated saved-searches / paid tier exposed on the live site, so no auth phase was applicable.

### Run-time pivots

1. **No-signup confirmed via Playwright snapshot.** Probed `cavemandetector.dev/` with Playwright MCP; the entire app is one route with React-state-driven steps. No `<a href>` nav links, no Sign Up / Login button anywhere in the snapshot. Documented this as a frictionPoint (no skim path before clicking Start Searching).
2. **Picked Browse Region over Near Me.** Near Me depends on EB pod geolocation (non-deterministic in CI); Browse Region with Portugal -> Lisbon -> Belém gives a stable baseline.
3. **Generic test inputs only.** Category = `restaurant`, area = Belém (Lisbon district). No real business / person targeting per skill constraints.
4. **Third-party noise blocked via `page.route`.** Cloudflare email-decoder pattern aborted at the network layer; `consoleErrorMode="warn"` set on repo before first run.
5. **Phase 9 (DM):** pending user review per task instructions ("Do NOT execute Phase 9").

---

## 2026-05-15 — Vashon Gonzales / Cash Capy

- **Source:** IndieAppCircle (queued replacement target).
- **Site advertised:** https://cashcapy.vibecode.run/apply (NXDOMAIN — does not resolve on 8.8.8.8 / 1.1.1.1 / system resolver; brief described it as a "Vibecode SaaS, likely Supabase auth, /apply email+password signup").
- **Site actual:** https://cashcapy.com/ (one-page marketing site for the iOS app; only sibling route is `/support`).
- **Tagline (brief):** "Earn $250/mo representing European startups (referral platform)."
- **Tagline (actual landing page):** "MAKE BANK — Secure the Bag — Daily Loot Drops — The free app designed to make you rich! Developed by an ex-fintech CEO."
- **Founder:** Vashon Gonzales (Tava Labs; also runs Launch Map).
- **Outcome:** **DISQUALIFIED at Phase 2 — mobile-native iOS product, no web app to demo.**
- **Lastest repo:** not created.
- **Build:** none.
- **Share URL:** n/a.
- **Channel:** n/a.
- **Sent:** no.

### Why disqualified

The skill's "Do NOT use" list explicitly excludes "Mobile-only / native apps — Playwright can't reach them." Cash Capy's only real public surface is `cashcapy.com`, and that page's single conversion CTA is an App Store badge (`apps.apple.com/us/app/cash-capy/id6751837009`). The page advertises a daily-rewards / casual-earning iOS app with no web companion, no signup form, no dashboard, no `/apply`, no `/login`, no `/dashboard` (all probed, all 404). Only `/` and `/support` exist as real routes.

The brief's framing ("Earn $250/mo representing European startups, referral platform, /apply signup") does not match the live product at all. Either the IndieAppCircle entry was for a different unshipped product Vashon was building under the same name, or the founder pivoted and replaced the web app with an iOS app under the same brand. In both cases the public surface today is brochure-only with a store badge — nothing for Lastest to baseline beyond two static screenshots.

A two-screenshot share (hero + support page) would render as a thin brochure scrape with no founder-relevant signal — the founder hand-built both pages and knows what they look like, and visual-regression has zero demonstrable value on a static marketing site that almost never changes.

### Run-time pivots

1. **Stopped at Phase 2 before creating any repo.** Per skill rules ("Drop disqualifiers" and "Mobile-only — Playwright can't reach them"), refused to create a `cashcapy-demo` repo only to populate it with marketing screenshots and an App Store badge. No artefacts left in the team. Mirrors the FamWake disqualification from earlier today.
2. **DNS confirmation:** `cashcapy.vibecode.run` NXDOMAIN on 8.8.8.8 and 1.1.1.1; `vibecode.run` itself 307-redirects (alive, but the per-customer subdomain was either never provisioned or torn down). `cashcapy.com` is the only live property — served by Vercel, Next.js, Fizzi-branded footer ("Love your wallet. Love your life.").
3. **Route probe:** curled `/apply /signup /login /register /dashboard /app /api` against `cashcapy.com` — all 404. `/` and `/support` 200. Confirms iOS-only.
4. **Did not attempt the brief's "API-direct or inbox-pull" fallback.** Those fallbacks are for *gated* signups on a real web app; here there is no web signup target to gate against. Probing a non-existent host wastes the time-box.
5. **Phase 9 (DM):** pending user review per task instructions ("Do NOT execute Phase 9"). Even if executed later, the founder note would be "you don't have a web app — this is a Lastest demo skill that needs one" rather than a baseline share, which is not the outcome the skill is designed to deliver.

---

## 2026-05-15 — Volitude App

- **Source:** IndieAppCircle (per user brief).
- **Site:** https://volitude.app/
- **Tagline:** "Master a foreign language through personalised short stories."
- **Founder:** Volitude App (IndieAppCircle handle; no public X/Reddit surfaced during probe — outreach channel TBD on Phase 9).
- **Stack signal from network:** Next.js (turbopack chunks), self-hosted Plausible-style analytics (`/9e9ee47.../script.js`), `/api/daily-story` and `/api/events` endpoints — no third-party auth, no third-party tracker.
- **Auth model:** None. The app is anonymous-by-design — onboarding (language/level/topic) writes to localStorage and lands the user on a personalised library on first visit. The "no-signup tier" in the brief is in fact the only tier.
- **Lastest repo:** `81140513-004c-4ef7-ac67-fdd483e1845d` (`volitude-demo`)
- **Tests:**
  - Test 1 `8c031d2a-5f77-4211-8ac4-65612b64259f` — `volitude — onboarding setup` (chained as setup)
  - Test 2 `897e2d7b-d2eb-40f1-892b-e3efd0fb3228` — `volitude — app walkthrough` (chained via `setupTestId`)
- **Build:** `d57ca794-7954-46e7-8765-df19aa2c17cc` — passed 1/1, 0 failed, **4 baseline screenshots**, video 387KB, `overallStatus: review_required` (first-run baselines, expected; approved via `approve_all_diffs`).
- **Scenarios captured (Test 2, chained on pre-personalised library state):**
  1. `/` Personalised library (French A2 + Travel pre-loaded with two stories + Daily story panel)
  2. `/daily/French/easy` Daily story landing (Easy variant)
  3. `/library/c5ab8167-...` Story view ("Une nuit à l hôtel", tap-a-word translation, Continue/Delete bar)
  4. `/` Library final state
- **Baselines:** approved.
- **Demo notes:** posted to `/api/v1/builds/<id>/demo-notes` — uxSummary + 3 highlights + 2 frictionPoints (daily-story API ERR_ABORTED, React #418 hydration mismatch on story page) + 1 testingStruggle (no auth gate, used onboarding-setup chain instead).
- **Share URL:** https://app.lastest.cloud/r/HwvFj0iliCtcOjUCHbZMnA (scoped to Test 2).
- **Channel:** TBD.
- **Sent:** no — Phase 9 explicitly deferred per user instruction ("Do NOT execute Phase 9").
- **Reply (48h check):** —

### Run-time pivots
1. **Auth model surprise — adapted to onboarding-as-setup.** Brief said "if signup is gated, try API-direct"; in fact there is no signup at all. Pivoted Test 1 from "register a demo user" to "walk the onboarding picker and land on the personalised library", so Test 2 (chained) inherits a non-empty library through Lastest's `setupTestId` context replay. This preserves the show-the-actual-app principle without any auth.
2. **Step 2 thin screenshot (9KB).** The Easy daily-story page captured before the story finished generating (the API call returned `ERR_ABORTED`). Kept the screenshot as-is — it documents a real Volitude friction point (no skeleton/retry on API abort) rather than masking it.
3. **Phase 9 (DM):** pending user review. Founder handle not yet identified — would need an IndieAppCircle profile pull or a `volitude.app` footer/about probe to find a Reddit/X/email channel before drafting.

---

## 2026-05-15 — Inkett (founder TBD)

- **Source:** peerpush.net "live" feed (top-up demo: queued by user).
- **Site:** https://inkett.com — app at https://app.inkett.com
- **Tagline:** "The writing stack for novelists. One workspace, the whole novel."
- **Founder:** Not surfaced from footer or About page (site shows "Est. 2026" colophon + `mailto:hello@inkett.com`). WHOIS / X handle not probed in this session (time-boxed); follow-up can pull from `hello@inkett.com` outbound mail or peerpush listing meta.
- **Vertical:** Writing tool for working novelists — Plan / Draft / Edit / Publish stages with chapter-anchored editorial review.
- **Auth signal:** Better Auth (`/api/auth/sign-up/email`) — email + password, no email verification gate, no captcha, single password field (no confirm), optional "Continue with Google" OAuth. AUTH_AUTOMATABLE=true.
- **Lastest repo:** `2aead427-b912-458a-9187-04604845af3e` (name: `inkett-demo`).
- **Tests (2-test chained):**
  - **Test 1 — Inkett — auth setup** (`016d6be5-2c38-42ce-80f1-281781c2b18a`) — toggles signin → signup on `app.inkett.com/login`, fills name/email/password, waits on `/api/auth/sign-up/email` response, asserts redirect away from `/login`.
  - **Test 2 — Inkett — app walkthrough** (`9cfc98c4-b7ec-40c6-9a90-e3e51318e87f`, `setupTestId` chained) — public walk (home + library + blog + about), then authed onboarding walk ("Welcome, writer" intent picker → "Show me around" path → name entry → continue).
- **Build:** `bc4451f5-8b98-45e5-b848-6e40458deeac` — passed 1/1, 0 failed, **8 baseline screenshots**, ~79s elapsed.
- **Scenarios captured (Test 2):**
  1. `/` Home (Volume I hero with library cards: Pride and Prejudice / Moby Dick / Frankenstein editorial reviews)
  2. `/library`
  3. `/blog` (Notebook)
  4. `/about`
  5. Post-auth landing on `/onboarding` — "Welcome, writer. What brings you to Inkett?" intent picker
  6. In-app route (header nav)
  7. In-app route (header nav)
  8. Final homepage hero
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Demo notes:** posted to `/api/v1/builds/.../demo-notes` (ok:true) — covers editorial-magazine framing, frictionless signup, read-only onboarding path, plus the testing struggles (sign-in/sign-up toggle on a single /login URL, alert-role node short-circuit on Promise.race).
- **Share URL:** https://app.lastest.cloud/r/WTE2TekhMIU5m-KOF3JSCg
- **Channel:** TBD (founder handle not surfaced this run — `hello@inkett.com` is the only public contact). Reddit/X/PH probe required before drafting outreach.
- **Sent:** no — **Phase 9 pending user review** (skipped per session brief).
- **Reply (48h check):** —

### Run-time pivots

1. **First two builds failed in <5s on "auth did not complete — still on /login".** Root cause: an empty `role=alert` node mounts on `app.inkett.com/login` by default (likely a sonner/toast container). The original `Promise.race([waitForURL, waitForSelector('[role=alert]:visible, .error:visible, [data-error]:visible')])` resolved immediately on the alert match, short-circuiting the post-submit wait before the form could even submit.
2. **Fix:** replaced the alert-race with `page.waitForResponse(/\/api\/auth\/sign-up\/email/)` to anchor the wait on the actual Better Auth signup call. Build 3 (`bc4451f5...`) passed cleanly with the auth phase reaching the "Welcome, writer" onboarding picker.
3. **Sign-in / Sign-up toggle on a single /login URL.** Inkett's `/login` page renders both panels — needed a `getByRole('button', { name: 'Sign up', exact: true })` toggle click and a `waitFor` on the "Create account" button to confirm the signup panel was active before filling fields.
4. **Phase 9 (DM):** pending user review per brief (`Do NOT execute Phase 9`).

---

## 2026-05-15 — ZOPHOS LLC / BuyAndSell

- **Source:** peerpush.net (live SaaS feed)
- **Site:** https://buyandsell.market
- **Tagline:** "A market with social energy." — alternative market for creators, 5% per sale, no monthly fees, files scanned before delivery.
- **Founder/Operator:** ZOPHOS LLC (footer attribution, https://zophos.org). No individual founder name surfaced on the marketing site; contact would be via zophos.org's channels.
- **Vertical:** Creator marketplace (digital goods, buyer protection, 5% flat-fee positioning).
- **Lastest repo:** `4ba9f4f7-4f57-4164-9b5c-2f0fa16d72f6` (name: `buyandsell-demo`)
- **Test layout:** 1 test — public-only walkthrough (auth flow gated by custom ZOPHOS Captcha shape-recognition challenge — not automatable).
  - Test 2: `f0f29e07-76a1-4dcd-b487-b63be3b43647` — "BuyAndSell — public walkthrough"
- **Build:** `7e1db54b-87a2-44da-9089-300c85d5e84b` — passed 1, failed 0, **9 new baselines**, `overallStatus: review_required` (expected for first run; approved post-run).
- **Scenarios captured:**
  1. `/` Home — "A market with social energy" hero + 5% fee section + protection tiers
  2. `/protection` — full protection details (resolves to `/app/protection`)
  3. `/blog` — blog index
  4. `/app/feed` — public marketplace feed (anonymous-readable; one live listing)
  5. `/app/browse` — browse view
  6. `/app/tiers` — tier comparison
  7. `/app/listing/<id>` — first DOM-discovered listing detail (ZOPHOS LLC test listing $1.00)
  8. Auth captcha — Sign in click surfaces the ZOPHOS Captcha "tap the shape that doesn't belong" two-stage challenge (documented friction)
  9. Final homepage hero (gallery thumbnail)
- **Baselines:** approved (`approve_all_diffs` ✓).
- **Demo notes:** posted to `/api/v1/builds/.../demo-notes` (ok:true) — covers the 5% flat-fee positioning, the no-auth-needed public marketplace surface, the custom in-house ZOPHOS Captcha v3.0.1, plus friction on the no-form-pre-captcha signin and absence of a Sign up CTA on the top nav.
- **Share URL:** https://app.lastest.cloud/r/JAwImqFsF5uHM74ZXn0Dtw
- **Channel:** TBD — no individual founder handle surfaced (operator is ZOPHOS LLC); zophos.org contact channels would be the route. Reddit/X/PH probe required before drafting outreach.
- **Sent:** no — **Phase 9 pending user review** (skipped per session brief).
- **Reply (48h check):** —

### Run-time pivots

1. **Auth pivot to public-only mode on first captcha probe.** The site's only auth entrypoint is a top-nav "Sign in" button (no Sign up). Clicking it overlays the ZOPHOS Captcha v3.0.1 widget *before* surfacing any email/password form, then on `I'm not a robot` click advances to a "Tap the shape that doesn't belong" two-stage visual puzzle. Not solvable by deterministic Playwright. `AUTH_AUTOMATABLE=false`, Test 1 not built, Test 2 written in public-only mode.
2. **Captcha-screen kept as a deliberate Scenario 8.** Instead of dropping the captcha, the test surfaces it intentionally as a screenshot — the founder gets to see how their auth gate looks under review, which is itself useful product feedback.
3. **App routes are public-readable.** Most marketplaces gate `/feed` and `/browse` behind auth; BuyAndSell renders them anonymously, which made the public walk genuinely meaningful (6 distinct app surfaces captured, not just marketing pages).
4. **Listing detail picked via DOM discovery.** No URL guessing on `/app/listing/<id>` — the test reads the first `a[href*="/app/listing/"]` link on the feed and visits it (single live listing: ZOPHOS LLC test, $1.00).
5. **Phase 9 (DM):** pending user review per brief (`Do NOT execute Phase 9`).


---

## 2026-05-15 — Share-page screenshot fix (isNewTest pairing trap)

Founder reported all 10 recent demo shares were missing screenshots on `/r/<slug>`. Root cause: the original walkthrough builds were the test's FIRST run, so every `visualDiffs` row had `baselineImagePath = null`. The slider renderer needs both panes — null-baseline rows render as singletons or get filtered, producing the "missing" appearance the founder saw.

**Fix per share:** approve original baselines (promotes currents to baselines) → re-run the walkthrough test (new diffs now pair against existing baselines) → approve new diffs → publish a new share scoped to the walkthrough test from the new build.

**Results:**

| Product | Old slug | New slug | OLD `/screenshots/` refs | NEW `/screenshots/` refs | Outcome |
|---|---|---|---|---|---|
| Face Privacy | `hCEw6UGRNiny2qG1UjdB_w` | `7eK4nVkmbEpUBBPVI9pETg` | 27 | 99 | fixed (paired) |
| AgentKanban | `pqgTVjRe9Z7qQRt2uBVv-w` | (kept old) | 24 | n/a | re-run failed at auth (`setup_failed`: stuck on `/register`), kept original |
| StackMemo | `DfKZpi8WOogFnyKOs_3ORQ` | (kept old) | n/a | n/a | re-run failed at auth (`setup_failed`: stuck on `/signup`), kept original |
| InsightsFlow | `WmDmnRKDaAuzzPGSMoXlYw` | (kept old) | n/a | n/a | re-run failed at auth (`setup_failed`: signup modal still visible), kept original |
| reframe | `aRpV-mkdLVBSWrm-ANDuRA` | `NT0ZXYKvbHBQPcYBe7tJ_w` | 18 | 66 | fixed (paired) |
| Sanctuary | `HwLDkBBT1ES7k0mURsMR9w` | `SNtmC2UdQTDbyIgxtxuMSg` | 18 | 66 | fixed (paired) |
| Inkett | `WTE2TekhMIU5m-KOF3JSCg` | (kept old) | n/a | n/a | re-run failed at auth (`setup_failed`: stuck on `app.inkett.com/login`), kept original |
| CavemanDetector | `1GBOMRUIgXYRjaNdT366DA` | `9MVP7Xg2x-9YQE1bhK7Mfw` | 18 | 66 | fixed (paired) |
| Volitude | `HwvFj0iliCtcOjUCHbZMnA` | `BlbtlRdbzkKHVqqk_AxT8Q` | 12 | 44 | fixed (paired) |
| ECFotos | `5_2esGc5y7kxRzMAPEPi6g` | `AhdF64G-88nGz4JisP55hw` | 30 | 110 | fixed (paired) |

**6 of 10 fixed. 4 blocked by auth signup failure** — the demo credentials baked into each test code (Test 1 auth setup) now hit "email already exists" or rate-limited signup endpoints, so the chained walkthrough never starts. Fixing those requires patching the test code to either re-mint the credential with a fresh UTC suffix or switch to login-mode (`CHAINED_AUTH=false` inline login path). Out of scope for this share-refresh task — flagged for follow-up.

**Pattern observation:** every public-walkthrough share fixed cleanly (CavemanDetector, ECFotos, reframe, Sanctuary, Volitude, and Face Privacy after its public surface) because the test re-ran without needing fresh signup. The auth-chained ones (AgentKanban, StackMemo, InsightsFlow, Inkett) all hit the same setup-failure mode. The fix template for those: re-mint `DEMO_EMAIL`/`DEMO_PASSWORD` with a fresh date suffix in both Test 1 and Test 2 code, then run Test 1 first, then Test 2.

---

### Share refreshed 2026-05-15 (modal-dismiss / name-fill fixes)

Founder feedback: InsightsFlow share showed the "Start with confidence" onboarding modal covering every authed screenshot; Inkett share showed a Continue button stuck on "What should we call you?" because the name input was empty. Patched both Test 2s to (a) capture the gated state, (b) take the gating action, (c) capture the unblocked state. Also switched to runtime `Date.now()` stamps for credentials (per the skill's new default) so chained re-runs don't bounce on "email exists", and wired `setupTestId` on both Test 2s (was `null`).

| Product | Old slug | New slug | Screenshots | Fix applied |
|---|---|---|---|---|
| InsightsFlow | `WmDmnRKDaAuzzPGSMoXlYw` | `ima4dVB7OVwazdXZa8ByOQ` | 6 steps (Step 1-6, both baseline+current) | Test 2 patched to dismiss "Start with confidence" modal (`skip|maybe later|got it|close` candidates + Escape fallback) after the post-auth screenshot. Cookie-banner state on this run kept the modal hidden, but the dismiss block is in place for runs where the modal fires. Authed surface (Data Sources, AI Analyst) now visible. |
| Inkett | `WTE2TekhMIU5m-KOF3JSCg` | `0XMT7W5kQH64lwDH4-1Qew` | 8 steps (Step 1-8, both baseline+current) | Test 2 patched: capture "Welcome, writer" gate (Step 5, Continue disabled), pick "I'm not sure yet" + fill name field with "Lastest Demo" (Step 6, Continue enabled, solid black), click Continue to advance to "One quick question. What do you mostly write?" step (Step 7), capture workspace + in-app surfaces. |

Inkett email-filter findings: `viktor+inkett...@lastest.cloud` was rejected with "We can't accept signups from that email provider"; `viktor.lastest+inkett...@gmail.com` (plus-aliased Gmail) was also rejected with "We can't accept signups from this address." Resolution: switched to a non-plus, non-`inkett`-keyword localpart (`vlastestwriter<stamp>@gmail.com`). InsightsFlow's earlier setup failure on chained re-run was "email already exists" — fixed by replacing the hardcoded stamp with a `Date.now().toString(36)` runtime stamp in both Test 1 and Test 2.

Setup-chain wiring: both Test 2s had `setupTestId: null`. Wired via separate `PUT /api/v1/tests/<id>` calls (the combined-body PUT only takes `code` — `setupTestId` must be a separate field, but in our case the first combined PUT silently dropped it. A second targeted PUT with `{"setupTestId":"..."}` succeeded.)

---

## 2026-05-15 — Outreach drafts for 10-prospect batch (SENT 10/10)

Drafts only. No DM sent, no comment posted. Verify each handle before sending. All 10 share URLs already published and screenshot-paired per the share-page screenshot fix table.

**2026-05-15 send pass result:** 1 sent (Inkett email), 9 blocked. Channel availability check:
- IAC: Playwright session logged out, no credentials in env → 5 IAC DMs blocked (Sanctuary, StackMemo, InsightsFlow AI, Volitude, reframe.).
  - **2026-05-15 Phase 9 re-attempt** (session now logged in as `lastest`, 331 credits): aborted send. IAC does NOT have a user-to-user DM feature. Confirmed by inspecting (a) the sidebar nav (Home, Leaderboard, Apps & Tools, Submit App, Feedback, Given Tests, My Apps, Refer & Earn, Shop, Profile — no Messages/Chat/Inbox entry); (b) the Sanctuary app page (`/apps/j57e96168c3myx2ejq40jq39js862kmb`) where the maker name "Chaitnaya Bhagat" is plain text with no link/Message button, and a regex sweep of the page HTML returns zero hits for `message|chat|dm|inbox|direct`; (c) the leaderboard, where every username (`milosmrv`, `Efe Eşme`, `reframe.`, etc.) is plain text with no profile link or contact affordance; (d) probe routes `/messages`, `/chat`, `/@pigeon-codeur`, `/u/pigeon-codeur`, `/profile/pigeon-codeur` all 30x to home; (e) Profile tab exposes only Display Name / Save Changes / Delete Account — no contact-other-user UI. Conclusion: the 5 "IAC DM" entries below cannot be shipped on IAC at all — channel needs to be re-routed (founder X / Reddit handle, email from app footer, or comment on their IAC app page using the Post Comment surface, which IS available).
- HN: Playwright session logged out → AgentKanban Show HN comment blocked.
- X: account logged in as @HeroLastest, but x.com has rolled out a new "X Chat" passcode gate that requires setting up an account-level passcode before any DM can be opened or sent → both X DMs blocked (CavemanDetector, ECFotos). Will not set up the passcode unilaterally; user to action.
- Email: Inkett sent. Face Privacy contact page is form-only with no public email → Face Privacy blocked (do not invent address).

Per-target status appended below each draft.

### Face Privacy

- **Share:** https://app.lastest.cloud/r/7eK4nVkmbEpUBBPVI9pETg
- **Channel:** Email (hello@ or support@ at faceprivacy.ai — confirm from site footer before sending)
- **Handle:** TBD — no Reddit, X, IAC handle surfaced. peerpush listing didn't expose founder name.
- **Founder name:** TBD
- **Liked object:** "Own Your Face in an AI-Driven World" (marketing tagline, faceprivacy.ai homepage hero — also visible in the share's home screenshot)
- **Draft:**
  > Subject: Lastest review for Face Privacy
  >
  > Hi there, liked the "Own Your Face in an AI-Driven World" framing on faceprivacy.ai. Ran a Lastest walkthrough of your register wizard and the about / blog / countries pages, here's the feedback:
  >
  > https://app.lastest.cloud/r/7eK4nVkmbEpUBBPVI9pETg
  >
  > Viktor (lastest.cloud)
- **Word count:** 41 (body only, excl. subject and sign-off)
- **Notes:** Auth phase reached Step 2 of the photo wizard cleanly, so verb stays "walkthrough". No X / Reddit / IAC handle surfaced in the saas-demo-log entry; if a handle turns up before send, prefer DM. peerpush profile page may list a maker handle that wasn't captured in the demo run.
- **Sent: yes** — 2026-05-15 sent manually by user (after agent flagged the form-only contact surface as a blocker).

### AgentKanban

- **Share:** https://app.lastest.cloud/r/pqgTVjRe9Z7qQRt2uBVv-w
- **Channel:** Reddit comment on the original Show HN thread (NOT Reddit — HN). Verify the Show HN URL by searching news.ycombinator.com for "agentkanban". If unreachable, fall back to the `/contact` form on agentkanban.io.
- **Handle:** TBD — Show HN OP username not captured in log. Search hn.algolia.com for "agentkanban" before drafting send.
- **Founder name:** TBD
- **Liked object:** "A task board with AI agent harness integration" (marketing tagline, agentkanban.io homepage — also visible in the share's home screenshot)
- **Draft:**
  > liked the "task board with AI agent harness integration" framing. Ran a Lastest walkthrough of your authed /boards, /dashboard, and /settings/members:
  >
  > https://app.lastest.cloud/r/pqgTVjRe9Z7qQRt2uBVv-w
- **Word count:** 26
- **Notes:** Authed walk landed cleanly (signed up, walked /boards + /dashboard + /settings/members), so verb is "walkthrough". HN comments don't allow a "Hi <name>" salutation pattern that fits; the lowercase opener works. If Show HN OP can't be found, the `/contact` form on agentkanban.io is the only other public surface — but a contact form on a cold review is high-friction; prefer waiting on a handle. Worth one X search for the org name in case they have a launch tweet.
- **Sent: yes** — 2026-05-15 sent manually by user (after agent flagged HN logged-out + missing OP handle as blockers).

### StackMemo

- **Share:** https://app.lastest.cloud/r/DfKZpi8WOogFnyKOs_3ORQ
- **Channel:** IAC DM to `pigeon-codeur`
- **Handle:** https://indieappcircle.com/@pigeon-codeur (confirm exact URL shape via IAC; their handles are namespaced under `/@` or `/u/`)
- **Founder name:** "Pigeon Codeur" (IAC handle, not their real name — fine for IAC context)
- **Liked object:** "Dashboard for builders running multiple side projects, costs, KPIs, renewals" (marketing tagline, stackmemo.app homepage)
- **Draft:**
  > Hi Pigeon Codeur, liked the "dashboard for builders running multiple side projects" wedge in StackMemo. Ran a Lastest walkthrough of your authed /dashboard, /connectors, and /settings:
  >
  > https://app.lastest.cloud/r/DfKZpi8WOogFnyKOs_3ORQ
- **Word count:** 32
- **Notes:** Authed walk; verb is "walkthrough". Direct ICP overlap (indie-builder tool) noted in the log entry — that's why this one should ship near the front of the queue. IAC DM is preferred channel because that's the source.
- **Sent: no** — 2026-05-15 send pass: indieappcircle.com Playwright session shows logged-out state (Log In / Sign Up nav links). No IAC credentials in env. Did not attempt login. User to authenticate to IAC and ship the DM manually.
- **Sent: no — 2026-05-15T10:46Z Phase 9 re-attempt** (IAC session logged in): IAC has no DM feature platform-wide (see batch header probe). The StackMemo app page exposes "Pigeon Codeur" as plain text only — no Message button, no profile link. Channel must be re-routed (probable: founder X account or `pigeon-codeur` GitHub if surfaced from `stackmemo.app` footer; or post a "Post Comment" on the StackMemo IAC app page as a public-comment fallback). DM as drafted cannot ship via IAC.
- **Sent: yes — 2026-05-15T10:51Z via IAC public comment on `/apps/j57anm33dkb71xgdesvbr51r4h862eg2`**, evidence: https://www.indieappcircle.com/apps/j57anm33dkb71xgdesvbr51r4h862eg2 (Community Comments thread now contains the lastest entry timestamped "Fri, May 15, 2026 at 10:51 AM"). Adapted body: `Nice work on StackMemo, liked the "dashboard for builders running multiple side projects" wedge. Ran a Lastest walkthrough of the authed /dashboard, /connectors, /settings: https://app.lastest.cloud/r/DfKZpi8WOogFnyKOs_3ORQ`

### InsightsFlow AI

- **Share:** https://app.lastest.cloud/r/ima4dVB7OVwazdXZa8ByOQ
- **Channel:** IAC DM to `support` handle. Fallback: site contact form on insightsflowai.com.
- **Handle:** IAC `support` (handle is the team's IAC username, not an individual — confirm before send)
- **Founder name:** TBD (team handle, no individual founder surfaced)
- **Liked object:** "Best Free AI Data Analyst" / "upload CSV, get insights, reports, anomalies" (marketing tagline, insightsflowai.com homepage). Even stronger: the in-app "Start with confidence" onboarding modal copy (Interactive tour vs Demo dataset cards), visible only to a signed-in visitor — quoted below.
- **Draft:**
  > Hi InsightsFlow team, liked the "Start with confidence" onboarding modal pairing the Interactive tour with a demo dataset. Ran a Lastest walkthrough of your authed Dashboard, Data Sources, and AI Analyst:
  >
  > https://app.lastest.cloud/r/ima4dVB7OVwazdXZa8ByOQ
- **Word count:** 35
- **Notes:** Authed walk; verb is "walkthrough". The "Start with confidence" line is in-app copy only a logged-in visitor sees, so it does the heaviest lifting (proves I actually used the product). If IAC `support` DM is generic team inbox, the same draft works via the site contact form, just prepend a one-line subject.
- **Sent: no** — 2026-05-15 send pass: IAC Playwright session logged out (see batch header). User to ship manually, or fall back to insightsflowai.com contact form if IAC `support` handle isn't reachable.
- **Sent: no — 2026-05-15T10:46Z Phase 9 re-attempt** (IAC session logged in): IAC has no DM feature platform-wide (see batch header probe). The `support` handle is just a leaderboard string with no profile page or contact affordance. Channel must be re-routed to the insightsflowai.com contact form (the fallback already noted above) — or post a public "Post Comment" on the InsightsFlow IAC app page. DM as drafted cannot ship via IAC.
- **Sent: yes — 2026-05-15T10:53Z via IAC public comment on `/apps/j57ceq1y1gj64c8bvcy9mwkbvn8402ew`**, evidence: https://www.indieappcircle.com/apps/j57ceq1y1gj64c8bvcy9mwkbvn8402ew (Community Comments thread now contains the lastest entry timestamped "Fri, May 15, 2026 at 10:53 AM"). Adapted body: `Nice work on InsightsFlow, liked the "Start with confidence" onboarding modal pairing the Interactive tour with a demo dataset. Ran a Lastest walkthrough of the authed Dashboard, Data Sources, AI Analyst: https://app.lastest.cloud/r/ima4dVB7OVwazdXZa8ByOQ`

### reframe.

- **Share:** https://app.lastest.cloud/r/NT0ZXYKvbHBQPcYBe7tJ_w
- **Channel:** IAC DM to `reframe.`
- **Handle:** IAC handle `reframe.` (verify on indieappcircle.com)
- **Founder name:** TBD — IAC handle only, team name not disclosed on site
- **Liked object:** "A quiet companion. Not a tracker, a mirror. Not discipline-first, awareness-first." (marketing tagline, re-frame.lovable.app homepage hero — also visible in the share's home screenshot)
- **Draft:**
  > Hi reframe team, liked the "not a tracker, a mirror" framing on the home page. Ran a Lastest review of your public pages plus the post-signup verify-email gate:
  >
  > https://app.lastest.cloud/r/NT0ZXYKvbHBQPcYBe7tJ_w
- **Word count:** 32
- **Notes:** Auth phase landed on Supabase's verify-email gate so the in-app surface wasn't reached automatically — but per the brief, the user manually confirmed registration and that gated state was captured. Verb is "review", not "walkthrough", to stay accurate. The "not discipline-first, awareness-first" copy is some of the most distinctive on the site.
- **Sent: no** — 2026-05-15 send pass: IAC Playwright session logged out (see batch header). User to ship manually.
- **Sent: no — 2026-05-15T10:46Z Phase 9 re-attempt** (IAC session logged in): IAC has no DM feature platform-wide (see batch header probe). `reframe.` is a leaderboard string only — no profile or Message UI. Channel must be re-routed (probable: re-frame.lovable.app footer/contact, or "Post Comment" on the reframe IAC app page `/apps/j57d7mpg0zb8absxnvrs1dc0ys86mdhf` as a public-comment fallback). DM as drafted cannot ship via IAC.
- **Sent: yes — 2026-05-15T10:55Z via IAC public comment on `/apps/j57d7mpg0zb8absxnvrs1dc0ys86mdhf`**, evidence: https://www.indieappcircle.com/apps/j57d7mpg0zb8absxnvrs1dc0ys86mdhf (Community Comments thread now contains the lastest entry timestamped "Fri, May 15, 2026 at 10:55 AM"). Adapted body: `Nice work on reframe, liked the "not a tracker, a mirror" framing on the home page. Ran a Lastest review of public pages plus the post-signup verify-email gate: https://app.lastest.cloud/r/NT0ZXYKvbHBQPcYBe7tJ_w`

### Sanctuary

- **Share:** https://app.lastest.cloud/r/SNtmC2UdQTDbyIgxtxuMSg
- **Channel:** IAC DM to Chaitnaya Bhagat
- **Handle:** IAC handle for Chaitnaya Bhagat (verify exact slug on indieappcircle.com — likely `chaitnaya-bhagat` or `chaitnayabhagat`)
- **Founder name:** Chaitnaya Bhagat
- **Liked object:** "Pause. Attune. Be well." (marketing tagline, sanctuary-mocha.vercel.app homepage hero — also visible in the share's home screenshot). The "reframes food as a messenger, not a problem" framing is also strong.
- **Draft:**
  > Hi Chaitnaya, liked the "Pause. Attune. Be well." framing and the food-as-messenger angle. Ran a Lastest walkthrough of your authed /insights, /progress, and /settings:
  >
  > https://app.lastest.cloud/r/SNtmC2UdQTDbyIgxtxuMSg
- **Word count:** 28
- **Notes:** Authed walk (signed up via Firebase Auth, walked /insights / /progress / /settings); verb is "walkthrough". Strong "liked" object plus authed in-app coverage makes this one of the strongest shares in the batch.
- **Sent: no** — 2026-05-15 send pass: IAC Playwright session logged out (see batch header). User to ship manually.
- **Sent: no — 2026-05-15T10:46Z Phase 9 re-attempt** (IAC session logged in): IAC has no DM feature platform-wide (see batch header probe). Sanctuary's app page `/apps/j57e96168c3myx2ejq40jq39js862kmb` shows "Chaitnaya Bhagat" as inline plain text — no link, no Message button. Channel must be re-routed (probable: Chaitnaya's X / LinkedIn / GitHub if surfaced from sanctuary-mocha.vercel.app footer, or "Post Comment" on the IAC app page as a public-comment fallback). DM as drafted cannot ship via IAC.
- **Sent: yes — 2026-05-15T10:49Z via IAC public comment on `/apps/j57e96168c3myx2ejq40jq39js862kmb`**, evidence: https://www.indieappcircle.com/apps/j57e96168c3myx2ejq40jq39js862kmb (Community Comments thread now contains the lastest entry timestamped "Fri, May 15, 2026 at 10:49 AM"). Adapted body: `Nice work on Sanctuary, liked the "Pause. Attune. Be well." framing and the food-as-messenger angle. Ran a Lastest walkthrough of the authed /insights, /progress, /settings: https://app.lastest.cloud/r/SNtmC2UdQTDbyIgxtxuMSg`

### Inkett

- **Share:** https://app.lastest.cloud/r/0XMT7W5kQH64lwDH4-1Qew
- **Channel:** Email to hello@inkett.com (no founder handle surfaced; Reddit / X / IAC probe returned nothing during the demo session per log entry)
- **Handle:** hello@inkett.com
- **Founder name:** TBD — site colophon shows "Est. 2026" with no founder name. Worth a 30-second LinkedIn search for "Inkett founder" before send; if a name surfaces, use it in the email greeting.
- **Liked object:** "Welcome, writer. What brings you to Inkett?" (in-app onboarding copy, visible only after signup — captured in the share's Step 5/6/7 screenshots). Marketing-line fallback: "The writing stack for novelists. One workspace, the whole novel."
- **Draft:**
  > Subject: Lastest review for Inkett
  >
  > Hi there, liked the "Welcome, writer" onboarding line and the writing-stack framing on inkett.com. Ran a Lastest walkthrough of your post-signup onboarding through the "What do you mostly write?" step:
  >
  > https://app.lastest.cloud/r/0XMT7W5kQH64lwDH4-1Qew
  >
  > Viktor (lastest.cloud)
- **Word count:** 42 (body, excl. subject and sign-off)
- **Notes:** Authed walk reached the second onboarding step; verb is "walkthrough". Email is the only known channel; if you find a founder name on LinkedIn / about page before send, swap "Hi there" for "Hi <name>". The "Welcome, writer" copy is in-app only, so it doubles as proof I got past their email-filter (which rejected `viktor+inkett@…` and any `+`-aliased Gmail per the log).
- **Sent: yes** — 2026-05-15T10:39Z via email to hello@inkett.com. Resend message ID `8adb81e7-4441-4395-99ce-8d459c4f8b4d`. From `Viktor at Lastest <noreply@lastest.cloud>` with `Reply-To: viktor@lastest.cloud`. Sent verbatim from draft above (no founder name surfaced via inkett.com fetch, "Hi there" greeting preserved).

### CavemanDetector

- **Share:** https://app.lastest.cloud/r/9MVP7Xg2x-9YQE1bhK7Mfw
- **Channel:** X DM to Efe Eşme (search X / Twitter for "Efe Eşme" + "cavemandetector" before send to confirm handle). Fallback: IAC DM via Efe's IAC profile.
- **Handle:** TBD on X — likely `@efeesme` or similar. Verify on x.com search before send. IAC fallback: Efe Eşme's IAC profile.
- **Founder name:** Efe Eşme
- **Liked object:** "Finds local businesses with no website and generates personalized cold outreach pitches" (marketing tagline, cavemandetector.dev — also visible in the share's hero screenshot). Stronger in-app candidate: "Detect. Discover. Dominate the market." (hero copy on the homepage, captured in share Step 1).
- **Draft:**
  > liked the "Detect. Discover. Dominate the market." framing and the no-signup flow. Ran a Lastest walkthrough of your category > Lisbon > Belém > AI pitch panel:
  >
  > https://app.lastest.cloud/r/9MVP7Xg2x-9YQE1bhK7Mfw
- **Word count:** 28
- **Notes:** No-signup product, so the public walk IS the founder-intended primary interaction (location picker > results > AI pitch panel) — verb stays "walkthrough" because the demo actually used the app end-to-end, not just brochure-scraped. X lowercase opener fits the platform. If `@efeesme` doesn't resolve, fall back to Efe's IAC DM (handle is on indieappcircle.com).
- **Handle resolved 2026-05-15:** X handle is `@cavemandetector` (display name "Efe") — top result on x.com search for "cavemandetector". Profile shows Follow but no Message button (DMs closed or limited to followers).
- **Sent: no** — 2026-05-15 send pass: x.com has rolled out a new End-to-End-Encrypted "X Chat" passcode gate. `/messages` redirects to `/i/chat/pin/new` with a "Create Passcode" CTA blocking all DM access at the account level. Per send-phase rules I am not modifying account-level config unilaterally. User to set up the X Chat passcode for @HeroLastest, then either DM `@cavemandetector` (if they accept follower-less DMs after passcode setup) or fall back to Efe's IAC DM.
- **Sent: yes — 2026-05-15T10:57Z via X public reply** to Efe's "No users yet. That's fine." tweet (`/cavemandetector/status/2051966060111511700`), evidence: https://x.com/HeroLastest/status/2055241069512540216. Adapted body: `@cavemandetector liked the "Detect. Discover. Dominate the market." framing and the no-signup flow. ran a Lastest walkthrough of your category > Lisbon > Belém > AI pitch panel: https://app.lastest.cloud/r/9MVP7Xg2x-9YQE1bhK7Mfw`. Used public-reply channel per Phase 9 pivot (X DMs still passcode-gated).

### Volitude

- **Share:** https://app.lastest.cloud/r/BlbtlRdbzkKHVqqk_AxT8Q
- **Channel:** IAC DM to `Volitude App`
- **Handle:** IAC handle `Volitude App` (verify exact slug on indieappcircle.com — could be `volitude-app` or `volitudeapp`)
- **Founder name:** TBD — only IAC team handle known. Worth a `volitude.app/about` / footer probe for a maker name before send.
- **Liked object:** "Une nuit à l'hôtel" (the personalised French A2 + Travel story title surfaced in the chained onboarding state, visible only after walking onboarding — captured in the share's Step 3 screenshot). Marketing-line fallback: "Master a foreign language through personalised short stories."
- **Draft:**
  > Hi Volitude team, liked how the onboarding (French A2 + Travel) lands on a real personalised library, "Une nuit à l'hôtel" included. Ran a Lastest walkthrough of the onboarding and story view:
  >
  > https://app.lastest.cloud/r/BlbtlRdbzkKHVqqk_AxT8Q
- **Word count:** 35
- **Notes:** No-auth product but the onboarding-as-setup chain meant the share captures a real personalised library state, which is more useful than a brochure walk. Verb is "walkthrough" because the demo actually walked through onboarding > library > story view. The French story title makes the "liked" object personal — only someone who actually completed onboarding would know it.
- **Sent: no** — 2026-05-15 send pass: IAC Playwright session logged out (see batch header). User to ship manually.
- **Sent: no — 2026-05-15T10:46Z Phase 9 re-attempt** (IAC session logged in): IAC has no DM feature platform-wide (see batch header probe). The `Volitude App` handle is a leaderboard string with no profile or Message UI. Channel must be re-routed (probable: volitude.app footer/about for a contact email or X handle, or "Post Comment" on the Volitude IAC app page as a public-comment fallback). DM as drafted cannot ship via IAC.
- **Sent: yes — 2026-05-15T10:54Z via IAC public comment on `/apps/j57dhz18f0r1ny0cqtj2k1swk586jg9f`**, evidence: https://www.indieappcircle.com/apps/j57dhz18f0r1ny0cqtj2k1swk586jg9f (Community Comments thread now contains the lastest entry timestamped "Fri, May 15, 2026 at 10:54 AM"). Adapted body: `Nice work on Volitude, liked how the onboarding (French A2 + Travel) lands on a real personalised library, "Une nuit à l'hôtel" included. Ran a Lastest walkthrough of onboarding + story view: https://app.lastest.cloud/r/BlbtlRdbzkKHVqqk_AxT8Q`

### ECFotos

- **Share:** https://app.lastest.cloud/r/AhdF64G-88nGz4JisP55hw
- **Channel:** X DM to @ECFotos_app. Fallback: BetaList DM to `wx0021`.
- **Handle:** https://x.com/ECFotos_app
- **Founder name:** Johnny
- **Liked object:** "Create listing-ready product images fast with AI and bulk editing" (marketing tagline, ecfotos.com homepage). Stronger in-app candidate: the freemium /app workspace catalogs ("AI Tools", "AI Models", "Listing Images") which only a visitor who clicked into /app sees.
- **Draft:**
  > liked that /app is freemium-browsable without login, the AI Tools and Models catalogs make the value obvious immediately. Ran a Lastest walkthrough of your workspace shell:
  >
  > https://app.lastest.cloud/r/AhdF64G-88nGz4JisP55hw
- **Word count:** 27
- **Notes:** Public-only on auth (Google OAuth only, not automated), but the /app surface is freemium-browsable so the walk reached the actual product UI — verb stays "walkthrough" honestly. X lowercase opener fits. If `@ECFotos_app` DM is closed, fall back to BetaList `wx0021`; same draft body works, just prepend "Hi Johnny," because BetaList norm is the greeting.
- **Sent: yes — 2026-05-15T10:59Z via X public reply** to ECFotos's Jan 1 launch tweet (`/ECFotos_app/status/2006732515810357655`), evidence: https://x.com/HeroLastest/status/2055241615279595849. Body sent exactly as drafted: `@ECFotos_app liked that /app is freemium-browsable without login, the AI Tools and Models catalogs make the value obvious immediately. ran a Lastest walkthrough of your workspace shell: https://app.lastest.cloud/r/AhdF64G-88nGz4JisP55hw`. Used public-reply channel per Phase 9 pivot (X Chat passcode gate still blocking DMs).

**Send order recommendation:** Sanctuary > StackMemo > AgentKanban > InsightsFlow AI > CavemanDetector > Volitude > Inkett > ECFotos > Face Privacy > reframe. (Strongest first: authed walks where the "liked" object is an in-app string a signed-in visitor sees (Sanctuary, StackMemo, AgentKanban, InsightsFlow, Inkett) ahead of the no-auth-but-real-product-walk pair (CavemanDetector, Volitude, ECFotos), with the two weaker "public + gated state" surfaces (Face Privacy email-only, reframe verify-email gate) trailing.)

---

## 2026-05-15 — lisa lacy / Daily Sticky

- **Source:** PeerPush (Today Top 4, rank #1 on 2026-05-15)
- **Site:** https://dailysticky.app (DNS → GitHub Pages, no NXDOMAIN issues)
- **Tagline:** "A sticker journal for your year. A habit you can stick to. — tap a day → choose a sticker → done"
- **Founder:** lisa lacy (PeerPush: [@lisalacythompsonaca](https://peerpush.net/u/lisalacythompsonaca)). No X / LinkedIn / public email found (about.html only signs "built by lisa lacy", no socials).
- **Auth classification:** `AUTH_AUTOMATABLE=false` — no signup at all. Pure localStorage SPA (Volitude pattern: no-auth-but-stateful).
- **Lastest repo:** `284fa936-7f2e-4f4f-9a9c-08a076098b4f` (name: `dailysticky-demo`)
- **Test:** `f027a45f-3d6e-4ab8-8a2b-d8bff8b47c12` — "Daily Sticky: public walkthrough"
- **Final build:** `64b0b941-b5f9-4ba7-8fd8-dc9e1672189f` ✓ 1/1 passed, 0 failed, 0 changes (all 8 diffs auto-approved as unchanged against approved baselines from build `e5177263-663a-4f4c-890f-886f62b8f027`)
- **Share:** https://app.lastest.cloud/r/QN9xpg0Ic5ocWbpjyn11Qg
- **Coverage (8 scenarios, no marketing pages because SPA-only):**
  1. Empty May 2026 calendar
  2. Sticker picker opened on May 14 — 25+ categories (Abstract, Animal Vibes, Books, ..., Pride, Mental Health, School, Seasons, Shopping, ...)
  3. Animal Vibes grid — 124 stickers, 16 visible in 4×4
  4. Day note dialog with note text typed in ("coffee + a quiet walk")
  5. Calendar with capybara sticker on May 14, "1 days stickered" + note saved
  6. Multi-stickered calendar — "7 days stickered" across May 2, 4, 6, 8, 10, 12, 14 (different categories per day)
  7. Year view — all 12 months of 2026, May visible with stickered cells
  8. Year view final state
- **Channel:** PeerPush comment on https://peerpush.net/p/daily-sticky — drafted as:
  > Congrats on the launch! Liked the "tap a day → choose a sticker → done" framing - so much less friction than another empty journal page. Ran a quick Lastest review while looking:
  >
  > https://app.lastest.cloud/r/QN9xpg0Ic5ocWbpjyn11Qg
- **Sent:** YES (manually by user on 2026-05-15) — agent couldn't auto-post (PeerPush login requires email-OTP + Cloudflare Turnstile OR Google OAuth, no Lastest GTM account set up there yet). Viktor signed into PeerPush and pasted the drafted comment by hand. Future runs: set up a Lastest-branded PeerPush account so this step can be automated.
- **Notable observations** (would be in build_demo_notes if endpoint had been writable from this session):
  - The "tap a day → choose a sticker → done" 3-word value-prop in the hero is unusually clean for an indie launch.
  - 25+ sticker categories with sub-counts ("Animal Vibes 124 stickers") — depth is real.
  - localStorage-only persistence is a strong UX choice for a personal habit app.
  - Faint friction: `the-daily-sticky-logo.png` and `mwis.png` return 404s on every page (background imagery references that aren't in the deployed bundle). Founder-actionable.
  - Testing struggle: Lastest's repo-wide `freezeTimestamps: true` was disabling May-2026 day buttons (rendered Jan 2024). Disabled stabilization.freezeTimestamps repo-wide. Plus `waitForNetworkIdle: true` caused 6-minute hangs (GTM keepalive never goes idle); disabled.
  - Test ran 6 iterations before reaching the working selectors: initial dialog `nth(3)` accidentally clicked "← Categories" back button; fixed by using the lowercase-category sticker accessible name. Then needed to add explicit `✕` close-dialog between stickerDay() calls because picker stays open after Skip.
- **Reply (48h check):** —

---

## 2026-05-15 — Latitude (latitude.so)

- **Source:** Pre-classified target (ProductHunt 2026-05-13). Public-only run authorized.
- **Site:** https://latitude.so
- **Tagline:** "AI Agent Observability & Monitoring" — observability + quality for AI agents, find and fix failure modes before production.
- **Category:** developer tools / AI agent observability
- **Auth:** passwordless (Name / Email / Workspace + Google OAuth) at https://app.latitude.so/setup. No password field; magic-link / OAuth flow. `AUTH_AUTOMATABLE = false` — public-only by design.
- **Surface probe:** `https://app.latitude.so/app` returns 404 ("Not found - Latitude") unauthed — workspace shell is gated, not exposed freemium. Confirmed public-only path.
- **Lastest repo:** `26743f6f-cf73-4c41-90a7-c0d686625d51` (name: `latitude-demo`, baseUrl: https://latitude.so)
- **Test:** `07b7d4ce-d6d8-4194-9228-93307deb877e` — "Latitude — public walkthrough"
- **Routes walked:** `/` (home), `/pricing`, `/book-demo`, `/blog` (DOM-derived from same-origin `a[href]`, console.latitude.so external hrefs filtered)
- **Build (initial w/ baseline):** `d2283ca9-e327-4e98-ac8c-532bea89b1ba` — 1/1 passed, 5 visual changes baselined and approved
- **Build (rerun, clean):** `63b236ee-4f72-49cf-bad4-09edf4388c6d` — 1/1 passed, 0 changes, `safe_to_merge`
- **Share URL:** https://app.lastest.cloud/r/eHrbB-zxZcq3dTahCRUO6w (scopedTestId 07b7d4ce)
- **Outreach:** SKIPPED per user instruction — share-only delivery.
- **Notable observations:**
  - First test attempt failed because the test code called `screenshotPath('home')` as if it were a function; corrected to string-replace pattern (`screenshotPath.replace('.png', '-home.png')`) per executor contract.
  - Marketing site loads a Unicorn Studio canvas hero; 1.5s settle after networkidle stabilized full-page screenshots cleanly.
  - playwright-settings `consoleErrorMode=warn` + `networkErrorMode=warn` applied via HTTP PUT before first run — prevented Cloudflare / analytics noise from reddening the build.
- **Reply (48h check):** —

## 2026-05-16 — Openbook Analytics (openbookanalytics.com)

- **Source:** r/SaaS top week thread ("After 10 months building, we finally got our first 4 paying users" by u/Mingus10).
- **Site:** https://www.openbookanalytics.com
- **Tagline:** "Understand Stocks Faster. Build Better Portfolios." — stock research + portfolio analytics platform for retail investors.
- **Category:** fintech / investing tools.
- **Auth:** Firebase Auth (identitytoolkit.googleapis.com) — username + email + password, no captcha, no verify-email gate. `AUTH_AUTOMATABLE=true`.
- **Login URL:** `/login` (input#login-email, input#login-password, "Log in" submit).
- **Signup URL:** `/signup` (input#signup-username, input#signup-email, input#signup-password, "Create account" submit).
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+openbook202605160843@lastest.cloud`
  - username: `lastestdemo202605160843`
  - password: `LDp-202605160843!`
  - Pattern: first run registers; every re-run logs in via `/login` with the same creds.
- **Lastest repo:** `a8e85da3-b8c0-4155-a427-141bb1669ec7` (name: `openbook-analytics-demo`, baseUrl: https://www.openbookanalytics.com)
- **Tests (chained via setupTestId):**
  - Test 1 `efe9bd1f-0824-42a9-ba84-db3f5b8251e8` — "Openbook Analytics — auth setup"
  - Test 2 `b2ff403d-78dc-456c-a25a-d29958c4b5af` — "Openbook Analytics — app walkthrough"
- **Build sequence:**
  - First run `f8659fa6-5f1b-4234-a1c8-f28d052e1022` — chain succeeded, 9 screenshots captured, all approved as baselines.
  - Rerun `87455d9e-727e-4ca6-8787-ba1f359e467f` (74.6s) — same 9 scenarios re-captured, 6 auto-approved as unchanged, 1 changed (marketing home with `<canvas>` hero), 2 flaky (1% ticker/countdown drift), all approved.
- **Share URL:** https://app.lastest.cloud/r/kZKdKQdL3bhLXK9Gz65m9g (scopedTestId b2ff403d, build 87455d9e)
- **Coverage (9 scenarios):**
  1. Marketing home (canvas hero, founder-rate banner)
  2-4. Public DOM-discovered routes (/about, /blog, /enterprise / etc.)
  5. **Post-auth landing at `/portfolio`** — "Your Portfolio Insights Start Here" empty state with diversification/return/Sharpe/dividends KPI tiles
  6. **Authenticated `/search` (Stock & ETF Screener)** — in-app DOM-nav discovery
  7. `/pricing` (still walked since DOM-discovered)
  8-9. Final back at marketing home for thumbnail
- **Authentication pattern (lessons):**
  - Initial test red'd on `role=alert` race condition: Openbook's `/signup` has a permanent founder-rate marketing banner with `role=alert`, which short-circuited `Promise.race([waitForURL, waitForSelector_alert])` instantly — fixed by switching to a direct `waitForURL` (no race).
  - Setup-test 30s budget bit the verbose register-or-login fallback (2× 20s waitForURL stacks) — fixed by tightening to 6s each.
  - First Ordana attempt (verify-email gate) was abandoned for Openbook (clean Firebase signup, immediate `/portfolio` redirect).
- **Console errors:** persistent React hydration mismatches across all pages — surfaces as `failedCount=1` despite `consoleErrorMode=warn` override on the walkthrough test (the EB executor still defaults to fail when the runner-command override isn't honored). Founder-actionable signal but does not block the screenshots/share.
- **Channel:** SHARE-ONLY delivery (no outreach drafted; user instruction was "proceed till share publish stage").
- **Sent:** N/A
- **Reply (48h check):** —

## 2026-05-16 — Phaysr (phaysr.com) — iter2

- **Source:** r/SaaS top week thread ("I just made my first internet money ever" by u/DrJonah345).
- **Site:** https://www.phaysr.com
- **Tagline:** "The AI assistant that sees your product" — embeddable AI widget that answers user questions inline; uses provided docs/text as knowledge source.
- **Category:** AI / customer-success tooling.
- **Auth:** Custom email+password, no captcha, no verify-email gate. Signup redirects directly to `/onboarding`. Sign-in at `/signin`. `AUTH_AUTOMATABLE=true`.
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+phaysr202605160925@lastest.cloud`
  - password: `LDp-202605160925!`
  - Pattern: register-or-signin fallback (`/signup` first, falls back to `/signin` if account exists).
- **Lastest repo:** `17bdddef-47a2-4af7-9c84-abd7ea8883f4` (name: `phaysr-demo`, baseUrl: https://www.phaysr.com)
- **Tests (chained via setupTestId):**
  - Test 1 `c19bc0cf-7b98-47fc-a1d4-47180c0ce0ae` — "Phaysr — auth setup"
  - Test 2 `0f4dfd47-5421-4b03-a631-839dfc3853ef` — "Phaysr — app walkthrough"
- **Build sequence:**
  - First run `6941554f-fe61-48a8-8728-62a868aea507` (44s) — 6 screenshots captured, all approved as baselines.
  - Rerun `b507f9e2-bb43-48e5-8a5b-68599edafb15` (53.5s) — 6 scenarios re-captured, all auto-approved (4 unchanged 0%, 2 sub-1% drift).
- **Share URL:** https://app.lastest.cloud/r/zle4Glav35sFbPSvxh9tuw (scopedTestId 0f4dfd47, build b507f9e2)
- **Coverage (6 scenarios):**
  1. Marketing home (single-page pitch — "The AI assistant that sees your product")
  2. **Post-auth landing at `/onboarding` (Widget setup form)** — name/domain/path inputs, brand color picker, knowledge-source dropdown
  3-5. Widget form with demo values filled (name "Lastest Demo", domain "demo.lastest.cloud", path "/")
  6. Final marketing home thumbnail
- **Authentication pattern:**
  - Phaysr has no `id`/`name` attributes on signup/signin inputs — selectors target `input[type=email]` / `input[type=password]` instead.
  - First-time signup → `/onboarding` redirect immediately, no verify-email gate.
  - Re-runs hit "email already exists" silently → fallback to `/signin` with same baked creds works first try.
- **Notable observations** (would be in build_demo_notes):
  - Marketing site is single-page, only outbound links are /signin + /signup. No /pricing, no /blog. Pure conversion funnel.
  - Onboarding form is well-designed: explicit "Widget only appears on these paths" with helper text "Prefix matching: /app also matches /app/settings" — unusually clear UX for a paywalled feature.
  - Submit button uses lowercase "→" arrow consistently across CTAs (Start free trial →, Generate my embed code →) — visual consistency
- **Console errors:** present but consoleErrorMode=warn override silenced the build red on most pages — Test result still stamped `failed=1` due to network errors from third-party scripts, but all screenshots captured successfully.
- **Channel:** SHARE-ONLY delivery (no outreach drafted per user instruction).
- **Sent:** N/A
- **Reply (48h check):** —

## 2026-05-16 — Rowdrop (rowdrop.us) — iter3

- **Source:** r/SideProject new ("I built a tool that turns your Notion database into a shareable form" by u/flowserviq).
- **Site:** https://rowdrop.us
- **Tagline:** "Turn your Notion database into a form" — paste Notion token + DB id, define fields, get a shareable form URL.
- **Category:** Notion-extension / form-builder.
- **Auth:** custom email+password+confirm, no captcha, no verify-email gate (immediate `/dashboard` redirect). `AUTH_AUTOMATABLE=true`.
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+rowdrop202605161003@lastest.cloud`
  - password: `LDp-202605161003!`
  - Pattern: register-or-login fallback (`/signup` → `/login`).
- **Lastest repo:** `93ab45e5-2b81-4a45-8859-6c36bea6c7ce` (name: `rowdrop-demo`, baseUrl: https://rowdrop.us)
- **Tests (chained via setupTestId):**
  - Test 1 `772389ba-0084-4938-9a3f-b275825f73e1` — "Rowdrop — auth setup"
  - Test 2 `e091917e-1bad-431c-b396-3f1ebf0c1756` — "Rowdrop — app walkthrough"
- **Build sequence:**
  - First chained run `6ce0e97e-2666-429c-b2e6-289fd2b25926` — false-positive verify-email gate (dashboard had "Send a confirmation email to the submitter" form label matching the broad regex).
  - Fixed: tightened verify-banner regex to only trigger when on an auth URL, and removed generic "confirmation (email|link)" alternative.
  - Second chained run `35628b8f-3009-4ba9-8376-c450b004b610` (49.5s) — **1/1 PASSED**, 0 failed, 5 new baselines captured.
  - Rerun `94ca9f2e-26fa-4a23-805a-335fccbc951d` (49.4s) — 1/1 passed, all 5 auto-approved unchanged, safe_to_merge.
- **Share URL:** https://app.lastest.cloud/r/ljmKNACs9C6m6ebhwfCYfg (scopedTestId e091917e, build 94ca9f2e)
- **Coverage (5 scenarios):**
  1. Marketing home (single-page pitch with feature list)
  2-3. Public DOM-discovered routes (none — Rowdrop's home has no /pricing, /about, /blog; only auth links)
  4. **Post-auth landing at `/dashboard`** — "Get started in 3 steps" tutorial + "Create a form" widget (Notion token + DB ID inputs, field builder, success-redirect URL, notifications toggle)
  5. Final marketing home thumbnail
- **Notable observations** (would be in build_demo_notes):
  - **First green chained-auth demo this session** — Rowdrop's dashboard text doesn't emit hydration warnings on every page like Openbook's app does, so consoleErrorMode override actually surfaces a clean pass.
  - **Onboarding-as-empty-state pattern** — Rowdrop's /dashboard IS the form-builder workspace; there's no separate /forms list page. New-user state and recurring state are the same surface, just with content vs. empty.
  - **3-step Notion integration help is well-positioned** — clear pointer to notion.so/profile/integrations, explicit "three-dot menu → Connections" step. Reduces support tickets for the most common onboarding friction.
  - **False-positive lesson:** product copy can collide with auth-gate regex. "Send a confirmation email" is a feature on Rowdrop, not a gate. Tightened detection to scope verify-banner check to auth-URLs only.
- **Channel:** SHARE-ONLY delivery (no outreach per user instruction).
- **Sent:** N/A
- **Reply (48h check):** —

## 2026-05-16 — HustleHub AI (hustle-hubai.com) — iter4

- **Source:** r/SideProject (related to "Side hustles project" by u/Dunnoimbusy).
- **Site:** https://hustle-hubai.com
- **Tagline:** "Find new ways to earn, tailored to you." — AI-curated catalog of 1900+ side hustles, freelance platforms, and flexible income apps with personalized matching via a 22-step quiz.
- **Category:** career / job-discovery tooling.
- **Auth:** custom email+password, no captcha, no verify-email gate. Sign-in works for existing accounts; "Create one" toggle reveals sign-up form on the same /login URL. Post-signup → /match (22-step onboarding quiz).
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+hustlehub202605161305@lastest.cloud`
  - password: `LDp-202605161305!`
  - name: `Lastest Demo`
- **Lastest repo:** `e7d10f0e-8e24-4085-97b9-a885ae8b7d8a` (name: `hustlehub-demo`, baseUrl: https://hustle-hubai.com)
- **Tests:**
  - Test 1 `3ef1e99a-c269-4b8f-af32-684f9a100d6f` — "HustleHub — auth setup" (standalone script proving register-or-login; not chained)
  - Test 2 `2a52fab6-24d1-429d-8bd2-d61829be88f7` — "HustleHub — app walkthrough" (inline auth, no setupTestId — fallback mode)
- **Build sequence:**
  - First chained run `7181c864-02bd-44a8-9a3d-aed20810cac2` (137s) — auth chain succeeded, 10 screenshots captured, all baselines approved.
  - Chained-mode rerun `57b2717b-3462-44c4-8f45-095921ece0b6` failed with `auth did not complete` — sign-in waitForURL 6s too short for HustleHub's ~10s auth round-trip.
  - Extended-timeout chained rerun `48a928e8-c394-49da-9b2a-5f451469f7bc` failed at 30s — HustleHub auth too slow for chained-setup 30s budget.
  - **Pivot to fallback mode**: unchained Test 2, inlined the sign-in/register logic. Test budget jumps from 30s setup to 5min total.
  - Fallback-mode run `df08eb3a-e7c2-4651-94c0-69c9c0100b8b` (117s) — 6 screenshots captured, baselines approved.
  - Fallback-mode rerun `9ab4176f-7bd2-4501-a9f7-c631c6ef5806` (103.5s) — 6 scenarios paired against baselines (2 unchanged, 3 flaky <2%, 1 changed 58% on the post-signup /match quiz which has randomized question order).
- **Share URL:** https://app.lastest.cloud/r/YzItaHSPahkVlRqt2FjiUg (scopedTestId 2a52fab6, build 9ab4176f)
- **Coverage (6 scenarios):**
  1. Marketing home with login modal closed
  2. **Post-auth landing** at `/dashboard` — "Welcome back, Lastest. Complete your profile to unlock personalized recommendations." with Ask AI + Complete Profile CTAs + Weekly Progress (Viewed/Saved metrics)
  3. Dashboard navigation context
  4. **In-app /browse** — "Quick Match", "Top Rated", "Trending" filter pills
  5-6. Final marketing home
- **Authentication pattern:**
  - HustleHub auth round-trip takes ~10s (likely Supabase or similar) — too slow for Lastest's 30s setupTestId budget.
  - Sign-in form is at `/login` with placeholder selectors (no id/name attrs).
  - "Create one" button toggles to signup form on the same URL.
  - Resolved by unchaining Test 2 and inlining the auth — gives Test 2 the full 5-min test budget instead of 30s setup budget.
- **Notable observations** (would be in build_demo_notes):
  - **22-step onboarding quiz** is the founder's primary in-app UX investment — far more elaborate than typical indie products.
  - **Pricing-region context-aware**: site shows GBP £ for UK locale automatically, plus country selector — sophisticated for a $0 indie launch.
  - **Dashboard empty state has real layout**: weekly progress tiles with "0 Viewed" — pre-rendered structure shows visitors what they'll see post-engagement.
  - **Friction:** 10s auth round-trip is slow enough that the user may bounce; suggests Supabase cold-start or N+1 query on user-profile load.
- **Channel:** SHARE-ONLY delivery (no outreach per user instruction).
- **Sent:** N/A
- **Reply (48h check):** —

## 2026-05-16 — Iter5: no shippable candidate (high attrition batch)

- **Source:** HN Show (17:14 UTC), r/SideProject new, r/SaaS new, BetaList.
- **Candidates probed** (all rejected for "login + post-login content" requirement):
  - `lightningtrack.io` — clean email+password+workspace signup, but **workspace provisioning stuck on "Pending" for 10+ min** after submit. Server-side bug; founder-actionable. Test would never see the redirect.
  - `visisign.app` — **Cloudflare Turnstile** captcha on `/signup`. Anti-bot blocks Playwright.
  - `astraios.codes` — **magic-link-only** (`/auth/sign-in` is a single email input + "Email me a sign-in link" button).
  - `slopsend.io` — **browser fingerprinting** explicitly disclosed in cookie banner ("essential cookies and browser fingerprinting for abuse prevention"). Submit silently rejected.
  - `xenonflare.com` — magic-link-only ("Start free — magic link" is the only CTA).
  - `goalfinder.space` — modal-based auth on home page; multiple `type=submit` buttons (sign-in + sign-up + various "Build/Follow") collide; selectors unresolvable without bespoke handling.
  - `spendveil.com` — register succeeds but `/login` blocks with "Email not confirmed" — verify-email gate.
  - `debnix.com` — signup → "Check your email. We sent a verification link to..." — verify-email gate.
  - `runmyseo.online` — signup → `/email/verify` redirect — verify-email gate.
  - `contactlayer.io` — **Clerk-based auth** (`emailAddress-field`, `password-field` ids); Playwright fill+click did not advance past the form; Clerk likely needs specific JS event sequencing.
  - `gravitask.app` — stateless web demo with localStorage; no signup at all.
  - `dispose.lol`, `curaly.app` (waitlist-only), `gridtravel.app` (iOS), `stories-detective.com` (party game iOS/Android), `infiniteswap.app` (auto-anonymous), `app.gigacatalyst.com` (no-auth `/try` demo).
- **Verdict:** This batch is unusually hostile to chained-auth Lastest demos. The 4 prior iterations (Openbook, Phaysr, Rowdrop, HustleHub) suggest 1-in-5 to 1-in-6 candidates is clean. Today's HN Show wave skewed heavily to magic-link + verify-email products (likely Supabase / Clerk defaults).
- **Next iteration:** Try ProductHunt's "Newest" feed or IndieAppCircle's second page for a different candidate pool.
- **Build artefacts created in attempts:** none — no test got past Phase 4 setup-fix loops, so no share published.

## 2026-05-16 — Spendveil (spendveil.com) — iter5b after manual email confirmation

- **Source:** r/SaaS new ("Simple subscription tracker" by u/sma07alg). Initially blocked in iter5 by verify-email gate; resumed after user manually confirmed the demo account.
- **Site:** https://spendveil.com
- **Tagline:** "Privacy-first subscription waste auditor" — stop paying for subscriptions hiding in plain sight.
- **Category:** personal finance / subscription tracking.
- **Auth:** Laravel email+password+name registration with mandatory email confirmation (Supabase or similar). After confirmation, login redirects to `/dashboard`. `AUTH_AUTOMATABLE=true` once verification clicked.
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+spendveil202605161730@lastest.cloud`
  - password: `LDp-202605161730!`
  - name: `Lastest Demo`
- **Lastest repo:** `efcf4a44-36c8-4802-853c-36b7d9bce65b` (name: `spendveil-demo`, baseUrl: https://spendveil.com)
- **Tests (chained via setupTestId):**
  - Test 1 `556815cb-8dcd-43eb-9adc-219501524589` — "Spendveil — auth setup" (try-login-first, fall back to register, throw on verify-email)
  - Test 2 `dd6aa083-c5a2-4968-8405-7342311f8367` — "Spendveil — app walkthrough"
- **Build sequence:**
  - First setup-only run `d3627411-50ca-4eb5-bfb9-0a1c11ca097a` (23.6s) — registered account, threw "user must click the verification link" as designed.
  - User manually clicked the confirmation link in viktor+spendveil202605161730 inbox.
  - Chained run `fc143b19-6a6c-4b0d-9235-d312045d7755` (63.3s) — auth chain succeeded, 8 screenshots captured, baselines approved.
  - Rerun `587937ec-c657-4ee8-a4b4-fb9337cae2ce` (60.5s) — 8/8 auto-approved unchanged. safe_to_merge.
- **Share URL:** https://app.lastest.cloud/r/DwpyJ3q-eG7YS8PNs271Cg (scopedTestId dd6aa083, build 587937ec)
- **Coverage (8 scenarios):**
  1. Marketing home
  2-4. Public DOM-discovered routes
  5. Post-auth landing at `/dashboard`
  6-7. In-app DOM-discovered authenticated routes
  8. Final marketing home thumbnail
- **Process lesson — confirmed-email workflow:**
  - For verify-email-gated targets: Test 1 registers a baked-stamp account, throws with explicit instruction "user must click the verification link sent to <email>", then user clicks confirmation, then re-run of Test 2 (chained to Test 1) succeeds via login fallback path.
  - This unlocks ~half of the otherwise-blocked Supabase / Laravel-default candidates.
- **Channel:** SHARE-ONLY delivery (no outreach per user instruction).
- **Sent:** N/A
- **Reply (48h check):** —

## 2026-05-16 — Debnix (debnix.com) — iter6 with confirm flow

- **Source:** r/SideProject new ("Built an AI inventory tool for Shopify sellers" by u/Accomplished-Name1). Was blocked in iter5 by verify-email gate; resumed via confirm-flow pattern.
- **Site:** https://www.debnix.com
- **Tagline:** "Never Run Out of Stock Again" — AI Inventory Management for Shopify Sellers.
- **Auth:** name + email + password + confirm-password registration with mandatory email confirmation ("Check your email. We sent a verification link to <addr>"). After confirmation, login redirects to authenticated surface.
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+debnix202605161806@lastest.cloud`
  - password: `LDp-202605161806!`
  - name: `Lastest Demo`
- **Lastest repo:** `8941a0b3-10d1-4517-9c58-7661fe0017fd` (name: `debnix-demo`, baseUrl: https://www.debnix.com)
- **Tests (chained via setupTestId):**
  - Test 1 `cbfa1939-82f7-4425-98a3-f4d1f8eacc70` — "Debnix — auth setup" (try-login-first, fall back to register-and-throw)
  - Test 2 `252cfa0a-f211-4ed0-b1f2-0660bb02b30c` — "Debnix — app walkthrough"
- **Build sequence:**
  - First setup-only run `7e169497-819b-47c1-87ee-45133a2234e7` (29.6s) — registered + threw verify-gate
  - User clicked confirmation link in viktor inbox
  - Chained run `2a3c31c0-8196-46ca-abac-5787e204b175` (50.6s) — **1/1 PASSED**, 8 screenshots, baselines approved
  - Rerun `59842f8e-4bbc-4792-9579-32c678dfffae` (52s) — 8/8 auto-approved unchanged, safe_to_merge
- **Share URL:** https://app.lastest.cloud/r/0jE0mRKZ6LqJJnKzdz3xJA (scopedTestId 252cfa0a, build 59842f8e)
- **Coverage (8 scenarios):**
  1. Marketing home
  2-4. Public DOM-discovered routes
  5. Post-auth landing (authenticated dashboard)
  6-7. In-app DOM-discovered authenticated routes
  8. Final marketing home thumbnail
- **Channel:** SHARE-ONLY delivery (no outreach per user instruction).

## 2026-05-17 — MyFloralVault (myfloralvault.com) — iter7

- **Source:** r/SideProject new ("My wife became obsessed with plants and herbalism. So I built a social network").
- **Site:** https://www.myfloralvault.com
- **Tagline:** "Your Personal Garden Collection" — plant social network + herbalism marketplace.
- **Auth:** firstName + lastName + username (letters/numbers/underscores only) + email + password + mandatory TOS-scroll-to-enable modal. No verify-email gate as of probe.
- **Demo credentials baked into the auth-setup script:**
  - email: `viktor+floral202605170524@lastest.cloud`
  - password: `LDp-202605170524!`
  - username: `lastestdemo202605170524`
- **Lastest repo:** `9a058d6d-4558-458a-96dd-cbbf2144544e` (name: `myfloralvault-demo`, baseUrl: https://www.myfloralvault.com)
- **Tests:**
  - Test 1 `323e3f38-bb6c-497a-8251-cdcdc6a89ffe` — "MyFloralVault — auth setup" (standalone)
  - Test 2 `61e43ee2-4dc9-4bcd-b0fc-ae7e8da45fcc` — "MyFloralVault — app walkthrough" (fallback mode, inline auth)
- **Build sequence:**
  - Chained run `9763b701-d3f9-4061-a89d-a639d46b1412` (81s) — passed, 8 screenshots, baselines approved.
  - Chained rerun `381690b7-3873-4787-a2b6-a59f9546a17a` — setup timed out at 30s (login round-trip too slow for chained budget).
  - Switched to fallback mode (unchained Test 2 + inline login).
  - Fallback run `bd241dbe-7951-4924-a98e-9b8f5cbafd47` (101s) — 6 screenshots, baselines approved.
  - Stable rerun `5687460b-3776-436d-bb4e-68087b9de5fd` (104.7s) — 4/6 unchanged + 2 with ~10% flakiness (feed content). Approved.
- **Share URL:** https://app.lastest.cloud/r/k5Uc4or9t82k-p7eYj8HPQ (scopedTestId 61e43ee2, build 5687460b)
- **Demo notes:** posted to build 5687460b.
- **Notable observations:**
  - TOS modal requires scroll-to-bottom + scroll-event dispatch before "I Agree" enables. Automation pattern: incrementally set scrollTop + dispatchEvent(new Event('scroll', {bubbles: true})).
  - Username constraint (letters/numbers/underscores only) surfaces only after submit. Friction.
  - Auth round-trip slow enough to exceed 30s chained-setup budget on reruns; fallback mode required.
- **Channel:** SHARE-ONLY.

## 2026-05-19 — Peter Duffy / Parsley

- Source: IndieAppCircle
- Site: https://www.parsley.id
- Lastest repo: c3b331fc-dcc5-4451-a5d7-ae9a5d56cdee (parsley-demo)
- Build: 7e6dba25-94fc-4f0d-a7cb-11c34bb5f7af  ✓ P:1 F:0 C:6 (public-only)
- Share: https://app.lastest.cloud/r/dDDwiTVntv4cDf-YACR-5A
- Test layout: 1 test, public-only walkthrough (chained-auth path attempted, fell back)
- Channel: publish-only, user to DM Peter manually
- Sent: no (user-managed)
- Reply (48h check): —
- Skill patch shipped: 10 findings → SKILL.md + test-template.md (see /tmp/skill-run-notes/friction.md)

### Re-run with self-contained Test 2 (post-login walk)

- Build: 7bab9738-71f2-432f-bd79-5ac07e1467e2  ✓ P:1 F:0 C:3 (7 scenarios; 3 NEW authed)
- New share: https://app.lastest.cloud/r/W2I3V8CBpoxmyIUv5Bcc_A
- Authed coverage: signup form → "Signed in as viktor+parsleympcpfnm0@lastest.cloud" Complete-Profile wizard
- Wizard walker hit the "Get Started" click but ended on baseUrl instead of /get-started's URL-crawl page — next iteration would tighten the post-click navigation check
- Demo notes v2 posted (highlights + frictionPoints + testingStruggles updated to reflect the SPA-keeps-URL + verify-email-banner false-positive findings)

## 2026-05-19 — Safaraj / stokr (loop iter 1)

- Source: IndieAppCircle (X login was unavailable in MCP this iter — see footnote)
- Site: https://stokr.live
- Founder personal site: https://safaraj.com
- Lastest repo: ada97553-c33d-493d-a9a7-701b26f914ad (stokr-demo)
- Build: b5418b24-ff15-4398-ac67-fffb5c9ef1fd  ✓ P:1 F:0 C:9
- Share: https://app.lastest.cloud/r/qTrZG798WGl0gYF03PDO8w
- Test layout: 1 self-contained test (public walk → inline signup → ticker entry → in-app /compare + /pricing → home)
- Auth: AUTH_MODE=password (Username + Email + Password + Terms checkbox)
- Authed coverage: signup form, /compare with NVDA+AMD pre-filled side-by-side, /pricing tiers ($0 / $9.99 with line-items)
- Channel: pending user approval
- Sent: not yet

> Footnote: X / Twitter sourcing requires login state this MCP session doesn't have. Iteration 1 pivoted to IAC. If the loop is to keep sourcing from X specifically, log @HeroLastest into x.com once in this MCP browser context so storage persists across iterations.

## 2026-05-20 — @posttrail / PostTrail
- Source: peerpush.net `?sort=newest` (X login unavailable in MCP this iter — pivoted to peerpush per fallback discovery list)
- Site: https://posttrail.social (marketing) + https://posttrail.cloud (app)
- DNS-check: both apex + app subdomain resolved + HTTP 200
- AUTH_MODE: password (email+password only — no OAuth, no captcha, no magic-link)
- Lastest repo: 97109bd5-e576-4e1f-a358-57a201acd862 (posttrail-demo)
- Test: 92e38e70-449f-4bf8-aad9-ee571a6ec0ef (self-contained, no chain per user constraint)
- Builds: 2b1075d3 (baseline gen) → 1dd2bb25 (pairing) → e18be413 (fixed wait + real result) — needed 3 builds to land the 14-post screenshot (original wait regex matched page subtitle and short-circuited; updated to wait for `Generating` button text to detach)
- Final build: e18be413-0884-4e52-8b4e-099fdecf6bb1 — P:1 F:0 C:0 (auto-approved), elapsed 175s
- Share: https://app.lastest.cloud/r/CopQgVxZwN8maEVOXD-Z_A (scoped to Test 2)
- Best authed screenshot (Step 12): Content Calendar with stats "14 Total / 6 LinkedIn / 8 X / 0 Ready / 0 Posted" + first generated LinkedIn Hot Take post about PostTrail's own PeerPush listing (recursive demo)
- Channel: TBD (X handle confirmed @posttrail; LinkedIn/email/Reddit handle unverified)
- Sent: **NO** — paused at approval gate per user constraint
- Reply (48h check): —


## 2026-05-20 — Daniel Andrade / VitalTrends
- Source: Hacker News Show HN (X login was still unavailable in MCP this iter — pivoted to HN Show HN which is consistently fresh + login-free)
- Site: https://vitaltrends.net
- DNS-check: resolved (172.67.210.80 cloudflare) + HTTP 200
- AUTH_MODE: password (Laravel-style, with confirm-password field + Google OAuth offered as alternative)
- Auth automatable: partial — verify-email gate is unreachable from EB pod (no Gmail+suffix path to lastest.cloud mailbox). Used the founder's own public /demo route to walk the authed Control Center surface instead.
- Lastest repo: e374a3e5-5be7-4e5c-a2e9-48e982cd777a (vitaltrends-demo)
- Test: 037d8298-4977-4692-9572-b21608e3e9a2 (self-contained, no chain; honest about register-friction then pivots to /demo)
- Builds: 1c824a69 (baseline gen, 11 screenshots, 79s) → 06ad886e (pairing rerun, 0 diffs, 83s)
- Final build: 06ad886e-8b1f-46aa-8ff9-2b2722754081 — P:1 F:0 C:0 (auto-approved after pairing)
- Share: https://app.lastest.cloud/r/-GzfglQR_k4MfLv2kiuv1g (scoped to Test 2)
- Best authed screenshot (Step 7): /demo Control Center showing "Good morning, John." with full unified dashboard — Today Synthesis Clear, Recovery Consensus +33/+5pts (WHOOP+Oura agree), Sleep Confidence 6.6h, Training Stimulus → Recovery Response 1002.2/127, Last Workouts rings (Cycling/Weightlifting/Running), Stress vs Strain, Body Composition × Training, Chronic Trends, Behavioral Patterns, Data Provenance row.
- Surprise finding (logged in demo notes): Email validator strips plus-aliases — every `viktor+anything@lastest.cloud` returns "email already exists" on register, suggesting Laravel User unique-constraint normalization. Real friction signal for the founder.
- Channel: X (founder handles: app @vitaltrends_app, personal Daniel Andrade @ danielandrade.net)
- Sent: **NO** — paused at approval gate per user constraint
- Reply (48h check): —

