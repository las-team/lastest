# Share Conversion Playbook — `/r/<slug>` founder shares

_Research + audit, July 2026. Covers: (a) sourcing & targeting, (b) content creation & quality, (c) share-page optimization. Based on a full code audit of `src/app/(public)/r/[slug]/page.tsx` and the publish/claim pipeline, plus external conversion research._

---

## 0. The diagnosis in one paragraph

The share page is an **engineering report, not a pitch**. It leads with a verdict card and a 10-chip technical grid, its CTAs are auth-first ("Sign up free" / "Sign in") instead of benefit-led, personalized AI demo notes are missing on most shares (only the quickstart pipeline generates them), and the "claim" promise ("Download test code") is a hard signup wall with no payoff preview. On top of that, **conversion is currently unmeasurable**: the `viewCount` counter is dead code, there are no CTA-click/video-play events, and no UTM/attribution joins "share viewed → signed up → claimed". Distribution-wise, a naked link DM'd to a high-reach founder is the weakest possible play; the leverage is in **public, visual, reply-first content** where the share page is the destination, not the hook.

Benchmarks worth anchoring to:

- Cold X DMs: 8–15% reply rate at best, and founders are the most responsive seniority (~0.57% on cold email). High-volume DM automation gets accounts shadowbanned.
- Personalized video in outreach: 25–30% reply rates, ~216% lift vs. text (Terminus), ~300% CTR lift (Forrester).
- Personalized audit/report lead magnets: ~4× more leads than generic content.
- Social cards with a real product screenshot: 2–3× CTR vs. generic previews. (Ours is already good — see §C.)
- Personalized CTAs convert ~202% better than generic ones; cutting form fields lifted conversions up to 120%; visible social proof lifts 19–34%.

---

## A. Sourcing & targeting (high-reach founders on X)

### A1. Split "reach targets" from "conversion targets"

- **High-reach founders (>50k followers)** are *content subjects*, not DM targets. Their DMs are closed or flooded; the reply rate math is against you. Use them for **public teardowns** (see §B2): "We ran a free visual regression test on {famous product} — here's what we found" earns reach from their name and their audience, and occasionally a repost from the founder themselves.
- **Conversion targets are mid-tier builders (≈1k–50k followers)**: seed-stage/indie SaaS founders, #buildinpublic accounts, recent Product Hunt / launch-week / YC-batch launchers. They reply, they repost, they actually claim tests. Reply-first engagement with this tier is the fastest organic growth loop on X (strategic replies surface in the feeds of everyone engaging with the post).

### A2. Target on *signals*, not follower lists

Build a lightweight trigger list; every trigger maps to a natural opening line:

| Signal | Where to find it | Opening angle |
|---|---|---|
| Launched today/this week | Product Hunt daily, launch hashtags, "we're live" posts | "Launch-day safety net: we recorded a regression test of your signup flow — free report" |
| Shipped a redesign / dark mode / new pricing page | Their feed | "Redesigns are where regressions hide — before/after diff of your new page" |
| Complained about a bug, hotfix, or broken deploy | Keyword search: "we broke", "hotfix", "sorry, fixed now" | "This is exactly the class of bug this test would have caught — we built one for you" |
| Hiring first QA / talking about testing pain | Job posts, tweets | "Until that QA hire starts: your product, tested nightly, free" |
| YC/accelerator batch, hackathon winners | Batch lists | Batch-themed teardown series |

### A3. The reply-first ladder (not the DM-first ladder)

1. **Engage before the ask**: 1–3 substantive replies on the target's posts over a few days (20 min/day of genuine replies is the highest-ROI growth activity on X).
2. **The pitch is a public reply with media**, ideally under their launch/ship post: a 20–40s clip or GIF of *their* product being driven by the test (cursor moving, diff slider wiping), one specific finding in the text, and the `/r/` link. Public replies double as content and social proof; a DM link does neither.
3. **DM only as escalation** once they've engaged (liked/replied), or when the finding is embarrassing (a real bug, a broken flow — report privately first, that builds trust and often earns the public shout-out from *them*).
4. **Volume discipline**: 5–10 deeply personalized targets/day beats 100 spray DMs, and keeps the account safe from spam heuristics.

### A4. Make targets discoverable in-product

Add a tiny "prospect" note to the publish dialog (founder name + X handle + trigger) so the Discord ping (`LASTEST_SHARE_DISCORD_WEBHOOK_URL`) and future analytics can tie a share to an outreach motion and, later, to a claim.

---

## B. Content creation & quality

### B1. The share is the proof; the *post* is the product

Nobody clicks a naked link from a stranger. Every outreach unit should be: **native visual media + one specific finding + the link**. X's algorithm boosts visual posts; video prospecting reply rates run 25–30%. Concretely:

- Auto-export a **15–40s MP4/GIF** from the run recording (we already have clips + chapter data) sized for X (16:9 or 1:1, big text overlay: "{domain} — 3 visual changes found").
- The text names **one concrete finding** ("your pricing toggle shifts 14px on mobile Safari" beats "we found 3 issues").
- The link unfurls to our OG card — which already embeds a real screenshot with a red/teal status bar. Good; keep it.

### B2. Launch a public teardown series (the viral engine)

The "roast/teardown" format is a proven attention machine (Demand Curve teardowns, the entire roast-my-landing-page economy). Weekly cadence:

- "**We ran a free visual regression + a11y test on {Linear / Vercel / Cal.com / current PH #1}**" — thread: 1 clip, 2–3 findings with screenshots, the grades, link to the live `/r/` report.
- End every teardown with the loop: "Want yours? Reply with your URL." Replies are the strongest reach signal on X, and each reply is a warm, *self-selected* lead — flipping the motion from outbound to inbound.
- Batch themes compound: "We tested all 10 of yesterday's top Product Hunt launches", "State of YC W26 landing-page accessibility" (leaderboard content doubles as SEO and PR).

### B3. Findings are the hook — an all-green report is a weak one

A share that says "Passed ✓ · 0 pixels changed" gives a founder no reason to act. Rules of thumb for outreach shares:

- Prefer runs that **found something real**: a visual diff, console errors, a failing a11y criterion, a slow Web Vital. The mild sting ("grade C on WCAG 2.2") is what gets opened and shared.
- If everything passes, reframe: "Your site held up — here's the safety net for the day it doesn't", and lead with the graded tiles (there's almost always a non-A grade somewhere).
- **Never send a share without demo notes.** Today only the quickstart/`gtm-lastest-saas-demo` pipeline generates `build_demo_notes`; a plain publish falls back to the generic italic pull-quote ("Recorded once. Runs on every build. Zero regressions.") — boilerplate that kills the "we actually looked at YOUR product" magic, which the audit-lead-magnet data says is the whole reason this tactic works. Make demo-note generation part of every outreach publish (see §C-P1).
- Resolve the **frictionPoints contradiction**: the generation prompt says friction points are "Product-facing — never shown in outreach", but `DemoNotesPanel` renders them publicly on the share. Decide the intent. Recommendation: *show* 1–2 friction points — findings build credibility — but have the prompt write them in a "fixable, not embarrassing" tone since they're public.

### B4. Add a human layer on top of the AI layer

- A 30–60s personal video note ("Hey Sam — I recorded this against your onboarding flow, watch the diff at 0:12") on high-value targets. Personalized video is the single highest-lift outreach format in the research (up to 216% response lift).
- A one-line **personal note field on the share itself** (see §C-P2) so the page opens with "Built for {founder} @ {company}" instead of a generic verdict — "built for you" framing is currently absent from the page entirely.

### B5. Give them something to show off (the badge loop)

Founders share things that make *them* look good. Offer an embeddable badge/card ("Visual regression: A · WCAG 2.2: B — verified by Lastest") once they claim. Every embed and every "we scored an A" repost is a free backlink + impression loop. The awards system (`AwardBadgeRow`) already exists but only renders for repos that earned a tier — extend it into a claimable, embeddable asset.

---

## C. Share-page optimization

### P0 — Instrument first (you're flying blind)

1. **Wire the dead view counter**: `incrementPublicShareView` (`src/lib/db/queries/public-shares.ts:249`) is never called; the publish dialog's "{viewCount} views" always shows 0. Call it (fire-and-forget) from the share page load, with basic bot filtering.
2. **Umami custom events** on the share page: CTA clicks (per-CTA name), video play/complete, diff-slider interaction, scroll-to-claim, outbound "Visit site". Zero `trackEvent` calls exist in `src/app/(public)` today.
3. **Attribution join**: carry the `?claim=<slug>` through registration into an analytics event (`share_claim_signup` with slug), so "share → signup → claimed" becomes a queryable funnel. `claimedAt` is already recorded — views and clicks are the missing links.
4. **UTM discipline** on every link we post (`?utm_source=x&utm_campaign=teardown-w27...`), logged on first page view.

### P0 — Fix the hero: benefit-led headline + CTA above the fold

Today the first CTA-ish element in the hero is **"Visit site" — which sends the visitor away to their own product**, and the first conversion CTA sits below the video, verdict card, and stat grids. Change:

- Add one line of "built for you" framing above/inside `OutcomeHeader`: "**We built this regression test for {domain} — free.**"
- Primary CTA in the hero: "**Claim this test — it's yours, free**" (personalized, benefit-led CTAs convert ~2–3× generic "Sign up free").
- Demote "Visit site" to a quiet text link.

### P1 — CTA copy & payoff preview

- Replace generic "Sign up free"/"Sign in" with value CTAs: "Claim your test", "Run this on every deploy".
- "**Download test code**" currently hits a straight auth wall. Show a **teaser of the actual Playwright code** (first ~10 lines, rest blurred, "Sign up to get the full test") — the visitor invested nothing yet; show the payoff before the gate.
- Consider a **lower-commitment ask** alongside signup: "Email me this report + the test code" (email-only capture). Form-field reduction is the single highest-lift CRO change in the research (~120%); today the only conversion path is full registration + team creation.
- Stop linking **all 10 layer chips** to `/login?claim=` — a cold visitor clicking "A11y: C" wants an explanation, not a login form. Make chips expand a one-line explainer with a "see full detail — free account" link, and make "—" chips honest ("not measured in this run").

### P1 — Social proof

The page has effectively none (award badges rarely render for cold targets). Add a slim strip near the claim CTA: "**{n} tests run this week · {m} products tested**" (real numbers from the DB), 1 short testimonial, and 3–4 favicon+grade cards from recent public teardowns linking to `/demos`. Expected lift from visible social proof: 19–34%.

### P2 — Deeper personalization & polish

- **Publish-dialog fields**: optional founder name/handle, one-line personal note, custom hero message. Everything on the page is auto-derived today; a single sentence of human context is the cheapest large personalization win.
- **Fix "Copy link"** in `SocialShareRow` — it's a plain `<a href>` that navigates instead of copying (`page.tsx:2073`).
- **Prefill the "Post to X" intent** with strong copy + the finding, so a founder who loves their report shares it in one click (the viral loop back into §A).
- **not-found page**: revoked shares show "This share isn't available" with no conversion path — add a signup CTA.
- **Snapshot integrity**: test-scoped shares auto-repoint to the latest run, so a link already sent to a founder can silently change (or flip from "3 changes" to "Passed"). Pin outreach shares to the build they were sent with, or version them.
- **Page weight**: gallery and diff images ship full-resolution raw `<img>`s; add resized variants — the OG route's 1.8MB screenshot cap is a hint these assets are heavy, and slow first paint on a phone (where founders open X links) taxes conversion directly.
- **OG card**: already strong (real screenshot, status banner). Add the target's domain + favicon prominently so the unfurl instantly reads as "this is about *my* product" in the timeline.

---

## 30-day experiment plan

| Week | Do | Measure |
|---|---|---|
| 1 | P0 instrumentation + hero/CTA rework. Demo notes mandatory on outreach publishes. | Baseline: views, CTA CTR, claim rate per share |
| 2 | First 2 public teardowns of high-reach products + 25 reply-first touches on signal-matched mid-tier founders (media replies, not naked links). | Impressions, profile visits, replies, share views by UTM |
| 3 | Code-teaser gate + email-capture variant; badge embed for claimed tests. | Signup rate vs. week 1; email captures |
| 4 | Double down on the best-performing trigger + format; publish "State of {batch}" leaderboard. | Claims/week; cost (minutes) per claim |

North-star: **claims per week** (already tracked via `claimedAt`); guardrails: share→view rate (is the post working?), view→CTA rate (is the page working?), CTA→claim rate (is the gate working?).

---

## Sources

- X growth/reply strategy: okara.ai "X Marketing for Founders", opentweet.io "X Algorithm 2026", innmind.com "X Growth Playbook for Startup Founders", postwizard.ai "Complete X Growth Playbook 2026"
- Outreach benchmarks: dowhatmatter.com "X vs LinkedIn Outreach", belkins.io "Cold Email Response Rates", thedigitalbloom.com "Cold Outbound Reply-Rate Benchmarks"
- Video prospecting: loom.com/customers/intercom, weezly.com "Video in Cold Email", prospeo.io "Loom Video Cold Email Strategy"
- Audit lead magnets: mywebaudit.com (80% close-rate case study), insites.com "Free audits as lead generation", vida.io "Best B2B Lead Magnets"
- Teardown format: demandcurve.com/teardowns, roastmylandingpage.com, roastd.io
- CRO: vwo.com "Landing Page Optimization", landingpageflow.com "CTA Placement 2026", optimonk.com "Landing Page Optimization Tips", lovable.dev "Landing Page Best Practices"
- Social cards: imageseo.io "Open Graph Social Media Cards Guide", screenhance.com OG image guides
