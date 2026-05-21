# Twenty CRM — Workflow Email Copy

Paste these into the SEND_EMAIL nodes of the 5 workflows in Twenty. All bodies use Twenty's variable syntax (`{{trigger.record.name.firstName}}`, `{{trigger.record.jobTitle}}`, `{{trigger.record.emails.primaryEmail}}`).

Every body ends with a GDPR footer (one for transactional, one for cold outreach). Don't remove it.

---

## 1) Customer — Welcome (T+0)

**To:** `{{trigger.record.emails.primaryEmail}}`

**Subject:** `Welcome to Lastest — 60-second tour inside`

**Body:**

```
Hi {{trigger.record.name.firstName}},

Thanks for signing up at app.lastest.cloud. Lastest catches visual regressions on every deploy with one Playwright test.

60-second tour:
  1) Create a repo: app.lastest.cloud/repos/new
  2) Record a flow in the in-browser recorder, or paste an existing Playwright test
  3) Run it once: that's your baseline
  4) Re-run after every change. Pixel diffs surface as "Review required" builds.
  5) Wire `pnpm dlx @lastest/runner` into CI so it triggers itself on each PR.

Useful links:
  - Docs / quickstart: https://lastest.cloud/docs
  - 3-min walkthrough: https://lastest.cloud/docs/quickstart
  - MCP for AI agents: https://lastest.cloud/docs/mcp
  - Join the Discord (live help, demos, releases): https://discord.gg/nAHuGsNzS

Stuck on a step? Reply and you'll hit me directly, or drop into the Discord.

— Viktor (founder, Lastest)

---
You're getting this email because you registered for a Lastest account at app.lastest.cloud and ticked the marketing-consent box. Reply STOP and we'll never email you again, or unsubscribe in your account settings. Data controller: Lastest. We process your email solely for onboarding messages; full policy at lastest.cloud/privacy.
```

**After-send action:** `UPDATE_RECORD` Person `lifecycleStage=WELCOMED`.

---

## 2) Customer — Week-1 Followup (T+7)

CRON-triggered daily at 09:00 UTC. Add a `FIND_RECORDS` step before SEND_EMAIL with the filter from `twenty-crm-setup.md` so the email only fires for people who were welcomed exactly 7 days ago and haven't opted out.

**To:** `{{actionInput.emails.primaryEmail}}` (binds from FIND_RECORDS output)

**Subject:** `How's Lastest treating you? Want to book a 15-min call?`

**Body:**

```
Hi {{actionInput.name.firstName}},

It's been a week since you signed up for Lastest. Quick check-in: did the baseline-on-every-deploy flow click, or is there a step that didn't quite work?

If you want help wiring it into CI, or want to ask anything specific about visual-regression workflow, grab 15 min:

  https://cal.com/viktor-lastest/15min   (no agenda needed)

If Lastest isn't the right fit, hit reply with one word and I'll stop. Either way, thanks for trying it.

— Viktor

---
You're getting this email because you registered for a Lastest account at app.lastest.cloud and ticked the marketing-consent box. Reply STOP and we'll never email you again, or unsubscribe in your account settings. Data controller: Lastest. We process your email solely for onboarding messages; full policy at lastest.cloud/privacy.
```

**After-send action:** `UPDATE_RECORD` Person `lifecycleStage=WEEK1_FOLLOWUP`.

---

## 3) Outreach — Meetup Organisers

**To:** `{{trigger.record.emails.primaryEmail}}`

**Subject:** `Free visual-regression tool for your meetup demos?`

**Body:**

```
Hi {{trigger.record.name.firstName}},

Saw you run {{trigger.record.jobTitle}} — really respect the work you do for the QA/testing community.

I'm building Lastest (free, OSS, MIT-licensed): visual-regression on Playwright. The pitch that might be interesting for a meetup demo: one Playwright test, baseline screenshots, pixel diffs on every deploy, AI failure-triage. No infra, no card, runs locally.

Two ways this might be useful:
  1) A 20-min demo slot in a future meetup. I can record async if scheduling is tricky.
  2) A free workspace for any of your members who want to test their own projects.

Try it: https://app.lastest.cloud  •  Source: https://github.com/lastesthero/lastest

Happy to chat or just leave it with you. Either way, cheering for the community.

— Viktor (founder, Lastest)

---
You're getting a one-off email because you publicly run/curate a community we admire (meetup / podcast / YouTube / newsletter). We won't follow up unless you reply. Reply STOP and we'll never email you again. Data controller: Lastest, lastest.cloud/privacy.
```

**After-send action:** `UPDATE_RECORD` Person `lifecycleStage=OUTREACH_SENT`.

---

## 4) Outreach — Podcasts / YouTube

**To:** `{{trigger.record.emails.primaryEmail}}`

**Subject:** `Lastest — visual-regression on Playwright, would love to send a demo`

**Body:**

```
Hi {{trigger.record.name.firstName}},

Long-time listener / viewer of {{trigger.record.jobTitle}}: the depth you bring to QA conversations is rare.

I'm the founder of Lastest, a free / OSS visual-regression tool on top of Playwright. Pitch: one test file, baseline-on-record, pixel diffs on every deploy, AI failure-triage, MCP server so AI agents can drive QA. Apache-2 stack, MIT runner.

I'd love to:
  - Send a 60-second async demo (screen recording). Zero commitment.
  - Be a guest if you ever cover indie devtool builders, founder-led QA, or visual testing.
  - Or just answer any technical question.

Try it: https://app.lastest.cloud  •  Source: https://github.com/lastesthero/lastest

If none of this lands, hit reply with 'no' and I'll never bother you again.

— Viktor

---
You're getting a one-off email because you publicly run/curate a community we admire (meetup / podcast / YouTube / newsletter). We won't follow up unless you reply. Reply STOP and we'll never email you again. Data controller: Lastest, lastest.cloud/privacy.
```

**After-send action:** `UPDATE_RECORD` Person `lifecycleStage=OUTREACH_SENT`.

---

## 5) Outreach — Newsletters

**To:** `{{trigger.record.emails.primaryEmail}}`

**Subject:** `Lastest for {{trigger.record.jobTitle}}`

**Body:**

```
Hi {{trigger.record.name.firstName}},

Reader of {{trigger.record.jobTitle}}: thanks for the consistent signal-to-noise.

I run Lastest, free / OSS visual-regression on Playwright. The 'beat' your readers might care about: baseline-on-record + AI failure-triage + an MCP server so coding agents can drive their own QA loop. Apache-2 stack, MIT runner.

A few framings if any fit an upcoming issue:
  - 'Visual regression is finally as cheap as a unit test': UX of the recorder + baseline approval flow.
  - 'MCP for QA: when the coding agent runs its own visual diffs'.
  - 'OSS devtool deep dive': happy to share build / cost / architecture numbers.

Try it: https://app.lastest.cloud  •  Source: https://github.com/lastesthero/lastest

Hit reply if any angle works (or any custom angle); ignore otherwise, no follow-up.

— Viktor

---
You're getting a one-off email because you publicly run/curate a community we admire (meetup / podcast / YouTube / newsletter). We won't follow up unless you reply. Reply STOP and we'll never email you again. Data controller: Lastest, lastest.cloud/privacy.
```

**After-send action:** `UPDATE_RECORD` Person `lifecycleStage=OUTREACH_SENT`.

---

## GDPR / CAN-SPAM compliance checklist

- [x] Lawful basis declared in footer (consent for transactional, legitimate-interest for cold outreach).
- [x] Identifier of data controller (Lastest) + privacy-policy link.
- [x] Easy unsubscribe (reply STOP).
- [x] Purpose-limited processing (onboarding only).
- [ ] Make `marketingOptOutAt` writable from the app's settings page.
- [ ] Honour STOP replies: implement an inbox-polling job that flips `marketingOptOutAt` when a reply contains STOP / UNSUBSCRIBE.
- [ ] Suppress all 5 workflows when `marketingOptOutAt IS NOT NULL` (add to every FILTER step).
