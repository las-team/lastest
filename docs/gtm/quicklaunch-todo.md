# Quicklaunch TODO — to 5 paid by Aug 31, 2026

Today: 2026-05-20. T-103 days.

## Funnel target

```
500 personalised cold touches
→ 50 replies
→ 20 demos/trials
→ 8 paid trials
→ 5 paid
```

---

## PRODUCT (one-time)

### Checkout + Auth
- [x] Pricing page (3 tiers)
- [ ] Stripe Checkout integration
- [ ] Stripe customer portal (cancel, upgrade, invoices)
- [ ] Stripe webhook -> Twenty CRM (lifecycleStage = CUSTOMER on first payment)
- [x] Sign in with Discord (better-auth provider)
- [ ] Annual pre-pay discount option (2 months free)

### Onboarding + Self-serve
- [ ] Paste URL -> first baseline in 60s, no signup gate
- [ ] Pre-cache common stack baselines (Next.js, Laravel, Vite, Astro)
- [x] Activity tracking events: signup, first-baseline, first-diff, first-approve

### Demo template fixes (unblock sales pipeline)
- [ ] Confirm-password fill
- [ ] OAuth when target has Google sign-in
- [ ] Post-login real interaction (not URL-guess)
- [ ] Runtime stamp by default

### Integrations + Platform
- [i] Google verification for gsheets (OAuth consent screen + scopes review)
- [ ] MCP OAuth flow (auth handshake for `@lastest/mcp-server` connections)
- [ ] Publish GitHub Action to Actions marketplace, GH APP marketplace
- [x] "Saved demos" public gallery page

### Self-test (dogfood)
- [ ] Default AI provider self-test: run Lastest against Lastest, capture diffs
- [ ] OpenRouter self-test: switch AI provider, rerun same suite, compare healing behaviour

### Analytics + Replay
- [x] Umami replays

---

## COMMUNITY (one-time)

- [x] Create Lastest Discord server (#general, #demos, #feedback, #releases, #showoff)
- [x] Wire Discord invite link into app footer, pricing page, welcome email
- [x] Discord bot: post every public demo share link automatically
- [0] Discord role "Founding User" for first 50 paid; visible badge
- [1] Manual welcome DM to every new join until 100 members

---

## SALES (one-time)

- [x] Activate Twenty CRM Welcome workflow (Gmail OAuth + paste email body)
- [X] Activate Twenty CRM Outreach workflow (paste body, wire filter)
- [ ] Reply-triage Loom template (30s personal video per inbound reply)
- [x] Calendly "20-min walkthrough" link, embed in DM templates
- [x] Rerun 4 salvageable demo targets through patched template (FileReadyNow, HabitHeat, Causo, Trace)

## SALES (recurring)

- [2] **Daily:** 10 personalised demos built + 10 founder DMs sent
- [ ] **Daily:** triage Twenty CRM inbox; reply within 4h, send Loom for warm replies
- [ ] **Weekly:** review Twenty pipeline counts (NEW -> OUTREACH -> REPLIED -> CUSTOMER), prune stale
- [ ] **Weekly:** named-account push: 5 hand-picked targets with full baseline before DM

---

## OUTREACH PIPELINE BUILD (one-time, populate Twenty CRM)

- [ ] Source 20 dev/QA podcasts (Changelog, Software Engineering Daily, Test Guild, etc.); add as Person rows with `outreachSegment=PODCAST_YOUTUBE`
- [ ] Source 20 local + virtual JS/Playwright/QA meetup organisers; `outreachSegment=MEETUP_ORG`
- [ ] Source 20 dev/testing YouTube channels (Fireship, Theo, Web Dev Simplified, JavaScript Mastery, QA-focused); `outreachSegment=PODCAST_YOUTUBE`
- [ ] Source 10 dev newsletters (Bytes, JavaScript Weekly, Pointer, Refactoring); `outreachSegment=NEWSLETTER`
- [ ] Trigger Twenty outreach workflows by setting `lifecycleStage=OUTREACH_SENT`

---

## MARKETING (one-time)

- [ ] Kill "lastest" misspelling as SEO target in metadata/title
- [ ] Pillar page: "Visual regression testing" (1500 words, demo as hero)
- [ ] Pillar page: "Playwright screenshot diff" (1500 words)
- [ ] Pillar page: "Percy / Chromatic alternative" (1500 words, comparison table)
- [ ] Newsletter setup (Buttondown or similar), embed signup in app + site

## MARKETING (recurring)

- [ ] **Weekly:** 1 Reddit thread via `/gtm-lastest-reddit` (founder-of-the-week demo embedded)
- [ ] **Weekly:** 1 Twitter post @HeroLastest (30-sec diff clip from a real demo)
- [ ] **Weekly:** 1 newsletter issue: "this week we caught X" with real diffs
- [ ] **Monthly:** pull Olares Umami + GSC; check funnel deltas

---

## ANALYTICS / OBSERVABILITY (recurring)

- [ ] **Weekly:** review 5 PostHog session replays of new signups; log top friction in Twenty CRM Person notes
- [ ] **Weekly:** funnel drop-off (signup -> first-baseline -> first-diff -> approve)
- [ ] **Weekly:** self-test results review (default AI vs OpenRouter healing behaviour)

---

## Suggested 7-day sprint

Day 1: PostHog decision + cloud snippet live; Stripe pricing page draft
Day 2: Stripe checkout + webhook + Twenty sync
Day 3: Discord server + sign-in provider
Day 4: Demo template bug fixes (all 4)
Day 5: Twenty CRM workflow activation (Gmail OAuth + paste bodies)
Day 6: Source 60 outreach targets (podcasts/meetups/youtube), import to Twenty
Day 7: Self-test default + OpenRouter; gsheets Google verification submitted
