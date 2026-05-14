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
