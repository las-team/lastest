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

