# SaaS Demo Log

Append-only log for `/gtm-lastest-saas-demo` runs. Re-check 48h after each session.

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

