# Twenty CRM — GTM Setup

Twenty CRM is live at `https://ab389eda.ewyctorlab.olares.com` (Olares). API creds in `.env.local` as `TWENTY_API_URL` / `TWENTY_API_KEY` / `TWENTY_COMPANY_ID`.

Workspace owner: V V (wyctor@yahoo.com). Two companies bootstrap the data model:

| Company | ID | Purpose |
|---|---|---|
| Lastest | `2cb1a389-0279-4252-afb6-78dd7a0a038d` | App registrants (`syncUserToTwentyCRM` puts users here) |
| Presentation | `96e76a96-f0cb-4f32-a208-4b972e351f29` | GTM outreach targets (meetup orgs, podcast hosts, demo founders) |

## Person — custom fields

Added on top of Twenty's stock Person object so the workflows can filter cleanly:

| Field | Type | Values | Purpose |
|---|---|---|---|
| `outreachSegment` | SELECT | `APP_USER`, `MEETUP_ORG`, `PODCAST_YOUTUBE`, `NEWSLETTER`, `DEMO_TARGET`, `OTHER` | What kind of contact this is |
| `lifecycleStage` | SELECT | `NEW`, `WELCOMED`, `WEEK1_FOLLOWUP`, `OUTREACH_SENT`, `REPLIED`, `CUSTOMER`, `OPTED_OUT` | GTM funnel position |
| `gdprConsent` | BOOLEAN | true / false | Did this person opt in to marketing email? |
| `gdprConsentSource` | TEXT | freeform | Where consent was captured (e.g. "signup_form_v1") |
| `gdprConsentAt` | DATE_TIME | timestamp | When consent was recorded |
| `marketingOptOutAt` | DATE_TIME | timestamp | If set, suppress all marketing email |

App-registrant rule: `syncUserToTwentyCRM` already sets `companyId=Lastest`. The signup form needs to also POST `gdprConsent` / `gdprConsentSource` / `gdprConsentAt` (see "Wire signup form" below).

## DemoRun — custom object

Replaces `docs/gtm/saas-demo-log.md`. Object id `7e3bdae0-c42b-44cd-9cce-335f6dc95d4e`.

Fields: `name`, `site`, `repoId`, `testId`, `buildId`, `demoUrl` (LINKS — Lastest /r/ share), `sourceUrl` (LINKS — the discovery URL on Reddit / BetaList / PeerPush / PH / X / ...), `scenarioCount`, `source` (SELECT — discovery platform), `status`, `channel`, `runDate`, `sentAt`, `repliedAt`, `blocker`, `notesMd`, `personId` (RELATION→Person), `companyId` (RELATION→Company).

39 records backfilled from `saas-demo-log.md` on 2026-05-16 covering every demo from 2026-05-12 through 2026-05-16. New runs should be inserted by `/gtm-lastest-saas-demo` directly via `POST /rest/demoRuns`.

Status values: `PLANNED`, `CAPTURED`, `BASELINES_APPROVED`, `SHARE_PUBLISHED`, `DM_SENT`, `REPLIED`, `BLOCKED`, `ABANDONED`.

Channel values: `BETALIST_COMMENT`, `FEEDBACKQUEUE_COMMENT`, `REDDIT_DM`, `REDDIT_COMMENT`, `X_DM`, `X_REPLY`, `LINKEDIN_DM`, `EMAIL`, `PEERPUSH_COMMENT`, `INDIEAPPCIRCLE_COMMENT`, `HN_SHOWHN_COMMENT`, `PRODUCTHUNT_COMMENT`, `NONE`.

## Workflows (5)

All created as DRAFT and have their triggers wired. The SEND_EMAIL step body has to be pasted in the UI (Twenty's API forbids step creation outside the visual editor) and Gmail/M365 has to be OAuth-connected before any of them will actually send.

| # | Name | Trigger | Workflow ID |
|---|---|---|---|
| 1 | Customer — Welcome (T+0) | DATABASE_EVENT `person.created` | `8e93eae0-baf9-406d-ba2c-df99e411e0c1` |
| 2 | Customer — Week-1 Followup (T+7) | CRON daily 09:00 UTC | `4ede49cd-16f6-4c39-a53a-c0aab5b51362` |
| 3 | Outreach — Meetup Organisers | DATABASE_EVENT `person.updated` | `36d53821-984e-47d0-85e9-0786b7068428` |
| 4 | Outreach — Podcasts / YouTube | DATABASE_EVENT `person.updated` | `66b1ae4d-5197-4b5f-b221-0e22d928571a` |
| 5 | Outreach — Newsletters | DATABASE_EVENT `person.updated` | `43016a13-b572-426d-bc12-38fc82359450` |

### Finish each workflow in the UI

For each one, open the workflow in Twenty, click the trigger node to add downstream steps:

1. **FILTER step** with the condition from the table below.
2. **SEND_EMAIL step** with the subject + body from `docs/gtm/twenty-crm-emails.md` (next section).
3. **UPDATE_RECORD step** to advance `lifecycleStage` (e.g. `NEW` → `WELCOMED`, `WELCOMED` → `WEEK1_FOLLOWUP`, `NEW` → `OUTREACH_SENT`).

### Filter conditions

| Workflow | Filter |
|---|---|
| Welcome (T+0) | `companyId == Lastest` AND `gdprConsent == true` AND `marketingOptOutAt IS NULL` |
| Week-1 Followup (T+7) | (prepend a `FIND_RECORDS` step before SEND_EMAIL) Find Person where `lifecycleStage == WELCOMED` AND `gdprConsentAt >= now() - 8 days` AND `gdprConsentAt < now() - 7 days` AND `marketingOptOutAt IS NULL` |
| Meetup | `outreachSegment == MEETUP_ORG` AND `lifecycleStage == NEW` AND `gdprConsent == true` AND `marketingOptOutAt IS NULL` |
| Podcast / YouTube | `outreachSegment == PODCAST_YOUTUBE` AND `lifecycleStage == NEW` AND `gdprConsent == true` AND `marketingOptOutAt IS NULL` |
| Newsletter | `outreachSegment == NEWSLETTER` AND `lifecycleStage == NEW` AND `gdprConsent == true` AND `marketingOptOutAt IS NULL` |

## Connect Gmail / M365 before activating

`Settings → Accounts → Connect new account` in the Twenty UI. SEND_EMAIL steps reference `connectedAccountId`; without one connected, all 5 workflows can be activated but will silently no-op.

## Wire the signup form to record consent

`src/lib/integrations/twenty-crm.ts:5` already syncs `name + email + companyId` on signup. To enable the welcome workflow's GDPR filter, extend the payload:

```ts
body: JSON.stringify({
  name: { firstName, lastName },
  emails: { primaryEmail: user.email, additionalEmails: [] },
  companyId,
  gdprConsent: user.marketingConsent,            // boolean — must be true to receive welcome email
  gdprConsentSource: 'signup_form_v1',
  gdprConsentAt: new Date().toISOString(),
}),
```

Add the consent checkbox to the signup form (separate from the ToS checkbox — required by GDPR Art. 7 for marketing). When the user later hits "unsubscribe", PATCH the person record with `marketingOptOutAt: new Date().toISOString()`.

## Adding new prospects (manual)

- **Meetup organiser:** add Person, set `companyId=Presentation`, `outreachSegment=MEETUP_ORG`, `lifecycleStage=NEW`, `gdprConsent=true` (only if you got it). Saving triggers workflow #3.
- **Podcast / YouTube host:** same but `outreachSegment=PODCAST_YOUTUBE`. Triggers workflow #4.
- **Newsletter curator:** same but `outreachSegment=NEWSLETTER`. Triggers workflow #5.

## New SaaS demo run

`/gtm-lastest-saas-demo` should POST to `/rest/demoRuns` instead of appending to `saas-demo-log.md`. Minimum fields:

```json
{
  "name": "<product name>",
  "site": "https://...",
  "source": "REDDIT|BETALIST|FEEDBACKQUEUE|INDIEAPPCIRCLE|PRODUCTHUNT|X|OTHER",
  "status": "SHARE_PUBLISHED|DM_SENT|BLOCKED|ABANDONED|...",
  "channel": "REDDIT_DM|...|NONE",
  "runDate": "2026-MM-DDT00:00:00.000Z",
  "repoId": "...", "testId": "...", "buildId": "...",
  "demoUrl":   { "primaryLinkUrl": "https://app.lastest.cloud/r/...", "primaryLinkLabel": "Demo" },
  "sourceUrl": { "primaryLinkUrl": "https://reddit.com/r/.../comments/.../", "primaryLinkLabel": "r/<sub>" },
  "scenarioCount": N,
  "blocker": "...",
  "notesMd": "1-3 sentences of the run-specific story (pivots, friction surfaced)",
  "personId": "<find-or-create-person uuid>",
  "companyId": "96e76a96-f0cb-4f32-a208-4b972e351f29"
}
```

Person find-or-create: search by `emails.primaryEmail` first, then by `name.firstName + name.lastName`. Create under `companyId=Presentation` with `outreachSegment=DEMO_TARGET`, `lifecycleStage=NEW`, `jobTitle="Founder, <product>"`.
