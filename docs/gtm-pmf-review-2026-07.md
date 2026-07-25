# GTM & PMF review — July 2026

_Audit of current marketing activity (website/SEO, X, Reddit, directories & listing sites, the demo/teardown machine) plus specific recommendations for finding product–market fit and reaching customers who will actually pay._

Companion to `docs/share-conversion-playbook.md` (share-page CRO) and `docs/saas-demo-skill-refinements.md` (demo quality). Those two documents optimize the *machine*. This one asks whether the machine is pointed at anyone who buys.

---

## 0. Method & evidence limits

- Marketing site (`lastest.cloud`) was **not directly fetchable from this sandbox** — the egress proxy returns 403 for that host (the same 403 appears for unrelated hosts, so this is our sandbox, not a block on their side). Everything about the marketing site below comes from **search-index snippets**, which are enough to establish page inventory and copy but not layout or conversion detail.
- `app.lastest.cloud` **was** fetchable — a live public share (`/r/HHGV_qX4gN823cbzsO32uQ`) was read end-to-end.
- Codebase, GitHub org, and repo metadata were read directly.
- **No production database access**, so claims/signups/revenue per share are unknown. Several recommendations below exist precisely because that number is currently unknowable even to us (§7).

---

## 1. What's actually running today

### Website & SEO — the strongest asset

Indexed inventory includes a blog with comparison-led SEO content (`/blog/chromatic-vs-lastest-visual-regression-testing`, `/blog/lastest-vs-lost-pixel`, `/blog/best-open-source-visual-regression-testing-playwright`), segment landing pages (`/for/solo-founders`), docs (`/docs/wiki`), a public demo gallery (**`/demos` — "308 live Lastest reports"**), and a launch/directory product (`/launch/instavm` — "tested & featured on Lastest Launch").

This is a real content operation. The comparison posts are the right SEO shape: "X vs Y" and "best open-source Z" are the highest-intent queries in this category, and we rank for at least some of them.

### The demo machine — high volume, unknown yield

308 published reports is a lot of compute and a lot of operator time. The pipeline is genuinely differentiated: scout → walkthrough codegen → run → AI demo notes → public `/r/` share with OG card. The live share I read is good — real findings ("50+ radio button options for backgrounds may confuse accessibility-focused users"), "Claim this test — free" hero CTA, "no credit card" framing. The July playbook's P0 hero rework and the standalone demo-notes generator (`src/server/actions/demo-notes.ts`) both shipped.

### X — no discoverable footprint

No company account surfaced in search. Nothing in the codebase points to one (`src/lib/brand.ts` contains only a Discord invite). The share page has a "Post to X" intent button and there's a social-share kit, so the *plumbing* for other people to post exists — but there is no owned account building an audience. The playbook's reply-first ladder (§A3) does not appear to have been executed at any visible scale.

### Reddit — zero footprint

Targeted searches for `lastest` on Reddit return nothing. Meanwhile r/QualityAssurance actively discusses this exact category and consistently lands on "Percy/BrowserStack, or just use Playwright's built-in snapshots for free". That is our thread, and we're not in it.

### Listing / "exchange" sites — zero footprint

Not on AlternativeTo, not on SaaSHub, not in `mojoaxel/awesome-regression-testing` (the canonical curated list for this category, which we appear in search results *next to* but not *in*). No Product Hunt launch, no Show HN found. These are the cheapest, highest-intent distribution surfaces in the category and we occupy none of them.

Our own **Lastest Launch** (`/launch/<slug>`, backed by `src/lib/db/queries/launch.ts` — cohorts, profiles, votes, featured winners) is an attempt to *build* one of these surfaces rather than list on them. Notable inversion, discussed in §6.

### GitHub — the tell

**10 stars, 0 forks, 2 issues ever from outside contributors** on a repo public since April 2026, in a category where the pitch is "free and open source". One of those two issues is a broken-Docker-setup report from a stranger who tried to self-host and hit a build error (#8). That is the single most valuable piece of customer feedback in the repo: someone wanted it enough to try, and the front door was broken.

For calibration: OSS visual-testing projects that convert (Argos CI, Lost Pixel, Pixeleye) sit in the thousands of stars. Stars aren't revenue, but for an OSS-led motion they're the top of the only funnel we have, and ours is flat.

---

## 2. Diagnosis: five problems, in order of how much they cost

### P1 — We are marketing to the segment least able to pay

`/for/solo-founders`, the Discord, the free tier (500 runs/mo), €29 Starter, and the teardown-a-founder's-landing-page motion all converge on **indie hackers and solo founders**. This segment:

- has no QA budget and no QA pain (one person, ships to few users, notices breakage manually),
- treats visual regression testing as a nice-to-have,
- churns at the highest rate in SaaS,
- and is the most saturated audience in all of dev-tool marketing.

Meanwhile the people who *pay* for this category — Chromatic ($149–$400+/mo), Percy ($199+/mo), Applitools (enterprise) — are teams with a **design system, a CI pipeline, a review process, and someone whose job is quality**. We are not currently speaking to them anywhere. The comparison blog posts are the only asset aimed at them, and they're the only asset producing inbound.

**This is the PMF question, not a channel question.** Everything else in this document is downstream of it.

### P2 — Unsolicited teardowns produce goodwill, not purchase intent

The cold-audit motion ("we tested your site, here's a free report") is a well-documented lead-gen tactic, but it converts when the recipient *already has the problem and a budget* — agencies use it to sell retainers to companies with marketing budgets. A solo founder who receives a free audit of their landing page gets a dopamine hit, maybe a "this is cool, thanks", and no purchase, because the audit does not create the underlying need. 308 of them is 308 nice moments.

The teardown's real value is as **public content**, not as outbound — which is exactly what the playbook §B2 recommended and which does not appear to have happened (no X account, nothing on Reddit).

### P3 — The funnel is unmeasurable, so we cannot learn from 308 attempts

Still true, one month after being flagged as P0:

- `incrementPublicShareView` (`src/lib/db/queries/public-shares.ts:283`) is defined and **never called** — view counts are always 0.
- **Zero `trackEvent` calls in `src/app/(public)`** — no CTA clicks, no video plays, no scroll depth.
- No email capture anywhere in the app (`waitlist|newsletter|email capture` → no matches).
- The only funnel signal that exists is `claimedAt`.

So the honest state is: we ran 308 experiments and recorded one bit of output per experiment. We cannot answer "does the demo motion work?" — not because the answer is bad, but because we didn't write it down.

### P4 — Two products, one founder's attention

Lastest (the testing platform) and Lastest Launch (a Product-Hunt-style directory with cohorts and voting) are separate products with separate audiences and separate cold-start problems. Directories are the hardest possible thing to bootstrap: they need both sides before either side shows up. Every hour spent on Launch is an hour not spent on the thing people might pay for.

### P5 — Distribution basics are unclaimed

No PH, no Show HN, no awesome-list PR, no AlternativeTo/SaaSHub entry, no Reddit participation, no X account. Each of these is between 20 minutes and one day of work and each puts us in front of people searching with intent. This is the cheapest gap in the whole analysis.

---

## 3. Who actually pays: three ICP candidates

Score each on **(a) has the pain, (b) has budget, (c) is reachable, (d) we're differentiated**.

### ICP-A — Digital agencies & dev shops (10–60 client sites) ★ recommended

- **Pain:** a client's site breaks after a CMS/plugin/deploy change, the client notices first, the agency eats the reputational hit. Agencies have this pain weekly and it's *commercially* painful.
- **Budget:** yes — it's billable. Agencies resell QA to clients and put it in the retainer.
- **Reachable:** yes — agency Slack/Discord communities, r/webdev, r/agency, Webflow/WordPress/Shopify partner ecosystems, LinkedIn, and cold outreach that actually lands because you can lead with *their client's* site.
- **Differentiated:** strongly. Multi-project (Growth = 10 projects, Pro = unlimited), no per-screenshot pricing, self-host option for client-data sensitivity, and record-don't-code suits agencies without a QA engineer. Chromatic/Percy are per-project-expensive and Storybook-shaped; agencies don't have Storybooks, they have live sites.
- **Our teardown machine is a perfect fit here** — but pointed at *the agency's client roster*, not at random founders.

### ICP-B — Teams whose AI coding agents ship UI ★ recommended (timely, most differentiated)

- **Pain:** Claude Code / Cursor / Copilot agents now write and merge front-end changes faster than humans can eyeball them. Nobody has a good answer for "did the agent break the UI?" This pain is new, growing fast, and acutely felt by exactly the teams with tooling budget.
- **Budget:** yes — the same teams already pay for AI tooling and have proven willingness to pay for anything that makes agents safer to merge.
- **Reachable:** yes — the AI-dev-tools conversation is loud and public (X, r/ClaudeAI, r/cursor, HN, Discords).
- **Differentiated:** uniquely. We already ship `@lastest/mcp-server` with `lastest_validate_diff` ("diff-scoped one-shot verdict for a coding-agent loop"), `lastest_heal_test`, and `lastest_suggest_app_fix`. **That is a product wedge nobody in the visual-testing category has, and our marketing does not mention it.** The README's headline is still "visual regression testing with AI-generated tests" — the AI is framed as a feature of testing, when the sellable story in 2026 is "visual verification for agent-written code".

### ICP-C — Solo founders / indie hackers ✗ deprioritize as a *paying* segment

Keep them as the OSS/community/top-of-funnel audience (they star repos, they write about tools, they become buyers at their next job). Stop treating them as the revenue path. Concretely: stop spending demo compute on them, keep `/for/solo-founders` as an SEO page, keep the free tier.

**Recommendation: run A and B in parallel for six weeks with explicit kill criteria (§4). Do not run three.**

---

## 4. The six-week PMF test

The goal is not "get customers". The goal is **to learn which segment converts, at what price, with statistical honesty**, and to have that written down.

### Week 0 — make learning possible (2–3 days, blocking)

1. Wire `incrementPublicShareView` on `/r/[slug]` load (fire-and-forget, basic bot filter).
2. Add Umami `trackEvent` to `src/app/(public)`: `share_view`, `cta_click` (per CTA name), `video_play`, `diff_slider_used`, `visit_site_click`.
3. Attribution join: carry `?claim=<slug>` through registration → `share_claim_signup` event with the slug. `claimedAt` already exists; this connects it to the top of the funnel.
4. UTM discipline on every posted link (`?utm_source=…&utm_campaign=…`).
5. Build one internal page: **shares → views → CTA clicks → signups → claims → paid**, on top of `getPublicShareStats()`. Look at it every Monday.

Without this, week 6 produces opinions instead of evidence.

### Weeks 1–2 — 20 conversations before 20 more demos

Book **10 agency calls and 10 AI-heavy-team calls**. Not demos — problem interviews. Script:

> "Tell me about the last time a UI change broke something you didn't notice until someone else did. What happened? What did you do about it afterwards? What do you pay for today to stop it happening again — and what's that costing you?"

Then the price question, asked as a commitment, not a survey:
> "If I set this up for your five biggest client sites this week and it runs on every deploy, would €X/mo be an obvious yes, a maybe, or a no?"

Sourcing: existing Discord members, the two GitHub issue authors, anyone who ever claimed a share, agency communities, and — the highest-yield list — **the founders/teams behind the 308 demos we already built**. Those are warm; nobody has followed up with them.

**Kill criterion:** if fewer than 3 of 20 describe the pain unprompted and with feeling, the ICP is wrong — go back to §3 and pick another.

### Weeks 3–4 — sell before you scale

- Offer a **paid pilot** in every conversation that showed pain: "**€500 one-time: I set up a 20-test suite across your five client sites, wired to your CI, and it runs on every deploy. If it doesn't catch anything real in 30 days, I refund it.**" Concierge delivery — you do the work by hand.
- Charging is the only honest PMF signal. Free claims measure politeness; €500 measures need.
- **Target: 3 paid pilots.** Three people paying real money for a hand-delivered version tells you more than 1,000 free signups.
- Instrument what you had to do by hand — that's the product roadmap.

### Weeks 5–6 — convert pilots to subscriptions, then productize

- Move pilots onto Growth/Pro (or a new agency tier, §8).
- Write up the first pilot as a **named case study with real numbers** ("caught 4 regressions on client sites in 3 weeks, one before the client saw it"). The site has zero social proof today; one real case study outperforms 308 anonymous demo reports.
- **Kill criterion:** if 0 of 3 pilots convert to a paid subscription, the pain is real but the *product* isn't the solution — find out which part they wouldn't pay to keep.

---

## 5. Channel plan (specific, in priority order)

### 5.1 Claim the free distribution surfaces — week 1, one day total

| Surface | Action | Why |
|---|---|---|
| `mojoaxel/awesome-regression-testing` | Open a PR adding Lastest | Canonical list; permanent high-authority backlink; developers actually read it |
| AlternativeTo | Create entry as alternative to **Percy, Chromatic, Applitools, Argos CI** | High-intent "cheaper alternative to Percy" traffic |
| SaaSHub | Same, with the open-source + self-host angle | Ranks for "best visual regression testing software" |
| OpenAlternative / awesome-selfhosted / Playwright community lists | Submit | "Open source alternative to Chromatic" is our single best positioning phrase — own it everywhere |
| G2 / Capterra | Create a free listing; ask pilot customers for reviews once they exist | Where teams with budget shortlist tools |

These are the "test-exchange / listing sites" gap, and it's pure upside: they cost hours, they compound, and every one is a backlink to a site that already has decent content.

### 5.2 Reddit — participate, don't announce

r/QualityAssurance is having our conversation weekly and defaults to "Percy or free Playwright snapshots". Rules:

- **20 genuinely useful comments before one link.** Answer visual-testing questions with real technical depth and no pitch. Build comment karma and recognition first; subs ban tool-shilling instantly.
- Target subs: r/QualityAssurance, r/QAEngineering, r/webdev, r/agency, r/SaaS (build-in-public threads only), r/ClaudeAI + r/cursor (for ICP-B).
- When you do post, post an **artifact, not an ad**: "I ran a WCAG 2.2 + visual regression pass on the top 20 YC W26 landing pages — here's the data" with the methodology and the raw numbers in the post itself. Link last.
- One high-quality "we open-sourced our Chromatic alternative, here's the architecture" post in r/opensource / r/selfhosted.

### 5.3 Hacker News — one shot, prepared

**Show HN: Lastest – Open-source visual regression testing you can self-host**. Prepare properly, because you get roughly one good shot:

- Fix `README` Docker instructions first (issue #8 — a broken quickstart on a Show HN day is fatal; HN readers will `docker compose up` within 90 seconds of reading).
- Have a **60-second demo GIF** above the fold and a **live public demo** requiring no signup (the `/demos` gallery is perfect for this — link it directly).
- The post should be technical and honest: what it does, what it doesn't, why you built it, what the diff engines are (pixelmatch/SSIM/Butteraugli is a genuinely interesting HN detail), and the business model (FSL license, free self-host, paid cloud) stated plainly. HN punishes coyness about monetization and rewards clarity.
- Be online all day to answer every comment.
- Best day: Tue–Thu, ~8–10am ET.

### 5.4 The AI-agent wedge — the highest-leverage new story

This is the one thing we have that competitors structurally don't, and it's invisible in our marketing.

- Rewrite the top of `README.md` and the site hero to lead with it: **"Your AI agent ships UI changes. Lastest tells it what it broke — before you merge."**
- Ship a **Claude Code / Cursor quickstart**: `npx @lastest/mcp-server`, agent writes code → runs `lastest_validate_diff` → gets a verdict → self-heals. Record it as a 90-second screen capture. That video is the single most shareable asset we could make this quarter.
- Publish it where that audience lives: r/ClaudeAI, r/cursor, X (the AI-dev-tools timeline is the most active reach surface that exists right now), the MCP server directories and awesome-mcp lists (another zero-cost listing surface we haven't claimed).
- Write the comparison post that doesn't exist yet: **"How to stop your coding agent from silently breaking your UI"**. That's a 2026 query with rising volume and no good answer ranking for it.

### 5.5 X — start the account, but as a content channel

An account with zero followers cannot do outbound. It can do content. Minimum viable version: post the weekly teardown thread (§6), the agent-verification demo video, and the data posts from §5.2. Reply-first engagement 20 min/day with mid-tier builders per the playbook §A3. Expect nothing for 8 weeks; it compounds or it doesn't, and it's cheap to find out.

### 5.6 SEO — double down, it's already working

The comparison posts are the only inbound asset producing anything. Extend deliberately:
- `lastest-vs-percy`, `lastest-vs-applitools`, `lastest-vs-argos`, `open-source-alternative-to-chromatic`
- **`/for/agencies`** (new — ICP-A landing page, replacing solo-founders as the featured segment)
- **`/for/ai-coding-agents`** (new — ICP-B)
- "Chromatic pricing explained" / "Percy pricing alternatives" — bottom-of-funnel, buyer-intent queries by people already experiencing price shock.

---

## 6. Fix the demo machine (don't scale it — aim it)

The machine is good. Its targeting is wrong and its follow-through is missing.

1. **Stop cold teardowns of random founders.** Redirect that compute.
2. **Point it at ICP-A:** pick 20 agencies, run tests on **three of each agency's client sites**, and lead the outreach with "your client's checkout shifts 14px on mobile Safari" — a finding about *their client*, which is a commercial problem for them, not a vanity problem.
3. **Publish teardowns as content instead of DMs** (playbook §B2, still not executed): one weekly thread — "we ran visual + WCAG 2.2 tests on the 10 top Product Hunt launches this week" — ending with "reply with your URL and we'll run yours". That converts outbound into inbound and every reply is a self-selected lead.
4. **Add a follow-up sequence.** Today a share is sent and then... nothing. Minimum: day 0 report → day 3 "want this on every deploy? I'll set it up free" → day 10 "here's what changed on your site since we tested it" (**re-run the same test and show the drift — this is the killer follow-up and we already have the infrastructure for it**).
5. **Add the low-commitment ask** the playbook called for: "email me this report + the test code" (email-only, no account). There is currently no way for an interested visitor to give us anything short of full registration + team creation.
6. **Go back to the 308.** They are a warm list nobody has touched. Re-run 30 of them, find the ones where something actually changed, and send that. "Your pricing page shifted since we tested it in June" is a real reason to reopen a conversation.

### On Lastest Launch

Either kill it or make it serve the main product. If it stays, it must earn its keep as **distribution**: every featured product gets an embeddable "Tested by Lastest — Visual A / WCAG B" badge (playbook §B5), each badge is a backlink and an impression loop, and every cohort is a batch of warm leads who just watched us test their product. If it can't be that within a month, it's a second cold-start problem competing with the first one — shut it down.

---

## 7. Instrumentation backlog (concrete tickets)

| # | Ticket | Where |
|---|---|---|
| 1 | Call `incrementPublicShareView` on share page load, with bot filtering | `src/app/(public)/r/[slug]/page.tsx`, `src/lib/db/queries/public-shares.ts:283` |
| 2 | Umami events on public pages: `share_view`, `cta_click`, `video_play`, `diff_slider_used`, `visit_site_click` | `src/app/(public)/**`, `src/lib/analytics/events.ts` |
| 3 | `share_claim_signup` event carrying the slug through `?claim=` → registration | `src/app/(auth)/register`, share CTA links |
| 4 | Email-only capture ("email me this report + test code") — no account required | share page + new action |
| 5 | Playwright-code teaser: show first ~10 lines, blur the rest, gate the remainder | share page claim block |
| 6 | Internal funnel dashboard: share → view → CTA → signup → claim → paid | on `getPublicShareStats()` |
| 7 | Fix `README` Docker quickstart (issue #8) before any launch push | `README.md`, `Dockerfile` |
| 8 | Social proof strip on share pages: real counts + first testimonial + recent teardown cards | share page |

Items 1–3 are prerequisites for the six-week test being worth running at all.

---

## 8. Pricing & packaging

Current: Free (500 runs) · Starter €29 (5k runs, 3 projects) · Growth €99 (30k, 10 projects) · Pro €299 (120k, unlimited).

Observations:

- Against Chromatic ($149–$400+) and Percy ($199+), we are priced **3–10× below the category**. For a buyer with budget, that reads as "hobby tool" rather than "bargain" — under-pricing costs credibility with exactly the segment that can pay.
- The €29 tier is aimed at ICP-C, the segment we're deprioritizing. It will produce the most support load per euro of any tier.
- **Add a services-heavy top tier now:** "**Managed QA — €1,500/mo**: we build and maintain your suite, you get a weekly report." Nobody has to buy it for it to work — it anchors the ladder and makes €299 look like the sensible middle. And if someone *does* buy it, that's revenue plus the deepest possible PMF signal.
- **Add an agency tier** built on projects rather than runs (agencies think in client sites, not run-minutes): "€199/mo, 25 client projects, white-label reports". White-label PDF/report export is a small feature with disproportionate agency pull, and we already generate the report.
- Keep the free self-host tier untouched. It's the top of the OSS funnel and the credibility story.
- **Don't raise prices before the 20 conversations in §4** — ask what they'd pay first, then price.

---

## 9. Metrics & cadence

North star for the next quarter: **paying customers**, not signups, not stars, not shares published.

Weekly review, five numbers:
1. Problem interviews booked / completed
2. Paid pilots proposed / accepted
3. Share funnel: views → CTA clicks → signups → claims (needs §7 items 1–3)
4. Inbound: GitHub stars, Discord joins, organic blog sessions, demo-gallery views
5. MRR

Guardrail: if a week passes with zero conversations with a potential buyer, the week was spent on the wrong thing regardless of what shipped.

---

## 10. The uncomfortable summary

We have built a technically impressive product, a genuinely good demo machine, and a decent SEO base — and pointed all of it at the audience with the least money and the least pain. The 308 demos, the launch directory, and the blog are all *supply*. There is no evidence in the codebase, on GitHub, on Reddit, or on X of sustained contact with anyone who has a budget for this.

The three highest-leverage actions, in order:

1. **Talk to 20 agencies and AI-heavy dev teams in the next two weeks, and try to charge 3 of them €500 for a hand-built pilot.** Everything else is downstream of what those conversations say.
2. **Re-lead the entire product story with the AI-agent wedge** ("your agent broke the UI — we catch it before merge"), because it's the only story in this category we can tell and Percy/Chromatic can't.
3. **Wire the funnel instrumentation and claim the free listing surfaces** (awesome-list PR, AlternativeTo, SaaSHub, MCP directories, Show HN) — days of work, permanent compounding return, and it makes every later experiment measurable.

---

## 11. Open questions that would change these recommendations

1. How many paying customers and how much MRR today? (Zero vs. five changes everything below §3.)
2. Of the 308 demo reports — how many were claimed, and did any claimer become a paying customer?
3. What's monthly organic traffic to the blog, and which posts convert to signups?
4. Is there an X account that simply isn't discoverable by search?
5. How much operator time does one demo cost end-to-end? (Determines whether §6 is worth doing at all.)
