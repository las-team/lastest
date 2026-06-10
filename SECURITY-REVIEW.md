# Security Review — lastest

**Date:** 2026-06-10
**Scope:** Full application (not a diff) — the review branch matched `origin/main`, so the entire app was audited across six areas: auth/authz, HTTP API surface, code execution, SSRF, billing/secrets, and injection/XSS/traversal.
**Method:** Six parallel auditors; every reported finding below was re-confirmed by reading the cited code.

---

## Summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **CRITICAL** | Host-process eval of customer/AI code (setup-script test + QuickStart) → cross-tenant RCE | `setup-scripts.ts`, `script-runner.ts:524`, `quickstart/storage-capture.ts:75` |
| 2 | **HIGH** | AI provider API keys serialized to the browser in plaintext | `settings/page.tsx:110,553` → `ai-settings-card.tsx:113-138` |
| 3 | **HIGH** | Invitations consumed by raw email match + no email verification → team/role takeover | `auth.ts:230-241`, `queries/auth.ts:531` |
| 4 | **HIGH** | `getStreamUrlForRunner` leaks live CDP stream URL + shared `STREAM_AUTH_TOKEN` to any user | `embedded-sessions.ts:378-392` |
| 5 | **HIGH** | "Analyze URL" SSRF — unguarded `fetch` with `redirect: follow` | `recording.ts:343` |
| 6 | **HIGH** | Notification-webhook SSRF with response reflection (metadata-cred read primitive) | `settings.ts:236`, `integrations/custom-webhook.ts:155` |
| 7 | **MEDIUM** | Unguarded `"use server"` IDOR: `computeChangeMap` | `change-map.ts:50` |
| 8 | **MEDIUM** | Unguarded `"use server"` IDOR: `autoApproveZeroDiffCases` | `layer-feedback-auto.ts:22` |
| 9 | **MEDIUM** | Unguarded `"use server"` IDOR: `triggerAIDiffAnalysis` | `ai-diffs.ts:34` |
| 10 | **MEDIUM** | Hardcoded live Discord webhook URL+token committed | `public-shares.ts:14-16` |
| 11 | **MEDIUM** | Run-minute quota & project limits not enforced server-side | `runs.ts:91`, `repos.ts:229` |
| 12 | **MEDIUM** | DNS-rebinding TOCTOU on URL-diff capture path | `url-diff/capture.ts` |
| 13 | **LOW** | Session/API tokens stored plaintext at rest | `queries/auth.ts:246` |
| 14 | **LOW** | Admins can mint `owner`-role invitations | `users.ts:18` |
| 15 | **LOW** | CSV formula injection in violation exports | `builds.ts:2598`, `design-system-violations/route.ts:27` |
| 16 | **LOW** | `getAISettingsRaw` unmasked action, team-member callable | `ai-settings.ts:50` |
| 17 | **LOW** | `/api/stats` non-constant-time key compare + key in query string | `api/stats/route.ts:10` |

---

## Critical

### 1. Host-process eval of customer/AI code → cross-tenant RCE
The build/run pipeline correctly evals user Playwright code **off-host** in disposable EB pods / remote runners. But two auxiliary paths eval customer (and partly AI-generated) code with `new AsyncFunction(...)` **inside the host Next.js process**:

- **Setup-script test:** `src/server/actions/setup-scripts.ts` (`testSetupScript`) → `src/lib/setup/script-runner.ts:524` (`runPlaywrightSetup`) launches host `chromium` and evals the setup body. Also reachable via `play-agent.ts` (`startPlayAgent`/`resumePlayAgent`).
- **QuickStart auth capture:** `src/lib/quickstart/storage-capture.ts:75` evals AI/user-derived auth-setup code in the host process (`storage-capture.ts:64` launches `chromium`, line 75 builds the `AsyncFunction`).

Both are reachable by **any authenticated team member with repo access** (guarded only by `requireRepoAccess`/ownership). The evaluated code runs as plain Node with full `process.env` — `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SYSTEM_EB_TOKEN`, OAuth secrets — plus filesystem, `require()`, and internal network. A setup script of `process.env.STRIPE_SECRET_KEY` or a DB connect-and-dump exfiltrates **every tenant's** secrets and data. On multi-tenant SaaS this is full host RCE / cross-tenant compromise.

For the QuickStart path the body is partly AI-generated from user prompts, so prompt injection also lands as host RCE.

**Fix:** Re-route both through the existing runner/EB-pod path (as `executeSetupViaRunner` already does). If a host-local path must remain, run it in a separate process/container with a scrubbed env (no `DATABASE_URL`/`STRIPE_*`/`SYSTEM_EB_TOKEN`), dropped FS, restricted egress. `vm` is **not** sufficient for untrusted code.

---

## High

### 2. AI provider API keys serialized to the browser
`src/app/(app)/settings/page.tsx:110` fetches `queries.getAISettings(...)` — the **raw, unmasked** DB query — and passes the whole object as `settings={aiSettings}` into the `"use client"` `AISettingsCard`, which seeds `useState` from `settings.anthropicApiKey`/`openaiApiKey`/`aiDiffingApiKey` (`ai-settings-card.tsx:113-138`). Next.js serializes those plaintext keys into the RSC/HTML payload of every `/settings` load. A masking server action `getAISettings()` (`src/server/actions/ai-settings.ts:27`, `maskSecret` + `_hasXKey` booleans) exists for exactly this purpose but is bypassed. Keys are also plaintext at rest (`schema.ts:1551+`).
**Fix:** Fetch via the masking server action; never pass raw secret columns into a client component.

### 3. Invitation/email-verification takeover
Email/password sign-up has no `requireEmailVerification`, and the better-auth `user.create` hook (`auth.ts:230-241`) consumes any pending invitation by **email string match** (`getInvitationByEmail`), assigning `teamId` + invited `role`. The invite token is only a UI gate, never validated server-side. An attacker who registers a victim's invited email before they do silently lands in the team with the granted role.
**Fix:** Enable `requireEmailVerification` and bind invite acceptance to the token (`getInvitationByToken`) on the signed-in verified email.

### 4. Live stream URL + shared token leaked to any user
`getStreamUrlForRunner(runnerId)` (`embedded-sessions.ts:378`) and its helper `getEmbeddedSessionForRunner` do no ownership check (comment waives it "by design" for the executor). Any authenticated user passes another team's `runnerId` and receives the proxied live CDP `streamUrl`, `sessionId`, and `process.env.STREAM_AUTH_TOKEN` — letting them watch another team's live browser session (their authenticated app, on-screen secrets).
**Fix:** Split the internal executor path from the user-facing accessor; require the caller's team to own the runner/session before returning URL/token.

### 5. "Analyze URL" SSRF
`analyzeUrlForSelectors` (`recording.ts:343`) does `fetch(url, { redirect: "follow" })` with only `new URL(url)` validation — no `assertSafeOutboundUrl`. Any team member (`recording:write`) submits `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (or a public URL that 302-redirects there) and the server fetches it; status/failure is reflected back as a semi-blind oracle, and metadata echoed in HTML leaks fully.
**Fix:** Call `assertSafeOutboundUrl(url)` before the fetch, use `redirect: "manual"`, and re-validate every redirect `Location` against the guard.

### 6. Notification-webhook SSRF with response reflection
User-configured Slack/Discord/custom webhook URLs are fetched with no SSRF guard at save, send, or test (`integrations/custom-webhook.ts:104,155`, `slack.ts:86`, `discord.ts:67`). The worst is `testCustomWebhookAction` (`settings.ts:236`, `requireTeamAccess` only): the caller supplies arbitrary `url` + method + **arbitrary headers**, the request fires immediately, and the **HTTP status + full response body are reflected back** (`custom-webhook.ts:166`). That's a near-full SSRF read primitive — custom headers forge `Metadata-Flavor: Google` / metadata-token requests, reaching cloud-metadata creds and internal APIs.
**Fix:** `assertSafeOutboundUrl` in each sender + the test action, validating at **send** time (DNS can rebind after save); host-allowlist Slack/Discord.

**Note — the central guard is sound.** `src/lib/security/outbound-url.ts` (`assertSafeOutboundUrl`) correctly handles decimal/octal/IPv6/IPv4-mapped literals, metadata/RFC1918/loopback/link-local/CGN ranges, and resolves DNS pre-flight. The bug is that findings 5–6 don't call it. Ollama (the one configurable AI base URL) **does** call it at runtime and save — good.

---

## Medium

### 7–9. Unguarded `"use server"` IDOR actions
All three are exported server actions individually invocable via the action RPC endpoint with no auth check inside:
- **`computeChangeMap(buildId)`** (`change-map.ts:50`) — loads any build, spends the victim team's GitHub token + AI budget, returns changed file paths / AI change narrative, and overwrites their stored change map. (Sibling `setBuildManualScope` *does* guard — this one doesn't.)
- **`autoApproveZeroDiffCases(buildId)`** (`layer-feedback-auto.ts:22`) — writes `status='auto_approved'` feedback for any build's steps, masking real regressions on another team's board.
- **`triggerAIDiffAnalysis(diffId)`** (`ai-diffs.ts:34`) — runs vision analysis on another team's diff, consuming AI budget and overwriting their verdicts.
**Fix:** Add `requireRepoAccess`/`requireBuildOwnership`/`requireDiffOwnership` at the top of each; derive repo/team from the owned entity, never from caller-supplied secondary IDs.

### 10. Hardcoded live Discord webhook
`public-shares.ts:14-16` hardcodes a real Discord webhook URL+token as a fallback. It's a bearer credential (anyone with repo read can spam/abuse the channel) and it receives every share's team name, publisher email, repo, and target domain.
**Fix:** Remove the fallback, require env, no-op when unset. **Rotate the leaked webhook in Discord now.**

### 11. Quota/project limits not enforced server-side
`monthlyRunQuota` and `projectLimit` are sold as paid entitlements but never gate run creation (`runTestsCore` `runs.ts:91`) or repo creation (`createLocalRepo` `repos.ts:229`). `ENFORCE_RUN_LIMITS` only toggles a UI banner. Storage limits *are* gated; runs/projects are not. Free-tier teams can run unlimited minutes / create unlimited projects.
**Fix:** Add a server-side precondition comparing usage to plan quota (data already in `getTeamRunUsage`/`getRepositoriesByTeam`), behind `ENFORCE_RUN_LIMITS`.

### 12. DNS-rebinding TOCTOU on URL-diff capture
`validateTargetUrl` resolves DNS in the app process, then the URL is re-resolved and navigated by the embedded browser (`url-diff/capture.ts`). A short-TTL domain can answer public during validation and private (`169.254.169.254`, `host.k3d.internal`, cluster services) at navigation. Blast radius is the EB pod's network position, not the app's.
**Fix:** Best addressed with an EB-pod `NetworkPolicy` blocking private/metadata egress, or pinning the validated IP into the `page.goto` (host-resolver-rules).

---

## Low

- **13. Plaintext tokens at rest** (`queries/auth.ts:246`) — API tokens (`lastest_api_<hex>`, 10-yr expiry) and session tokens stored cleartext, looked up by equality. Entropy is 256-bit so brute-force isn't practical, but any DB/backup/log leak yields usable creds. Fix: store SHA-256 hash, look up by hash; shorten API-token expiry.
- **14. Admin can mint owner invites** (`users.ts:18`) — `inviteUser` accepts `role='owner'` under `requireTeamAdmin`. `updateUserRole` correctly blocks owner changes, but the invite path can introduce a new owner. Fix: restrict assignable invite roles to non-owner.
- **15. CSV formula injection** (`builds.ts:2598`, `design-system-violations/route.ts:27`) — exporters quote-escape but don't neutralize leading `= + - @`. A test named `=HYPERLINK(...)` executes when a teammate opens the CSV. Fix: prefix such cells with `'`.
- **16. `getAISettingsRaw`** (`ai-settings.ts:50`) — unmasked exported action, callable by any team member, currently no in-app caller. Fix: remove if unused, else restrict to `team:admin`.
- **17. `/api/stats`** (`api/stats/route.ts:10`) — `===` key compare (not timing-safe) + accepts secret via `?key=` (lands in logs). Low impact (returns aggregate count, unset by default). Fix: `timingSafeEqual`, header-only.

---

## Verified sound (no action needed)

- **HTTP API surface (45 routes):** consistent authorization — webhook HMAC-SHA256 over raw body with `timingSafeEqual` (GitHub/GitLab), runner-token IDOR re-checks (`teamId` match), file-serving path-traversal defense (`realpath` containment, `..` rejection, per-slug allow-lists), SSE team-scoping, 128-bit unguessable share slugs.
- **Core auth guards & ownership helpers** — `requireRepoAccess` verifies `repo.teamId === session.team.id`; ownership helpers walk entity→repo→team and refuse null-repo rows. Used correctly by the bulk of actions.
- **`SYSTEM_EB_TOKEN`** — `crypto.timingSafeEqual`, full-list iteration, no early-exit; token randomness `crypto.randomBytes(32)`.
- **Stripe billing integrity** — signature + idempotency via `@better-auth/stripe` plugin on raw body + app-side dedup log; plan flips only via webhook re-resolving live price IDs; no client-controlled price IDs; cross-team subscription blocked by `authorizeReference`. (The gap is quota *enforcement*, #11 — not forgeable upgrades.)
- **SQL injection** — no `sql.raw()` anywhere; all `drizzle sql\`\`` interpolations parameterized.
- **XSS** — only safe `dangerouslySetInnerHTML` (static literal + escaped JSON-LD); markdown rendered without raw HTML; AI/diff content rendered as escaped JSX.
- **Zip-slip / unsafe deserialization** — only in-memory JSZip reads; no `eval`/YAML-load of untrusted data.
- **EB provisioner** — `execFileSync("kubectl", [array])`, no shell, server-generated names, JSON Job specs (no YAML templating).
- **Secrets sweep** — no `sk_*`/`ghp_`/`glpat-`/`AKIA`/`whsec_` in tree; pre-commit hook blocks Stripe keys; only `.env.example` committed. The Discord webhook (#10) is the one embedded credential.

---

## Recommended priority

1. **#1** (host-process eval — cross-tenant RCE) — fix before any untrusted tenant onboarding.
2. **#10** (rotate Discord webhook) — quick, do immediately.
3. **#2, #4** (secret/token exposure to clients) — high impact, contained fixes.
4. **#3** (email verification + token-bound invites).
5. **#5, #6** (call the existing SSRF guard on the two unguarded fetch paths).
6. **#7–#9** (add guards to the three IDOR actions — one-line each).
7. Remainder as hardening.
