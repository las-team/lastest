# Salesforce AgentExchange listing plan (Lastest)

Researched 2026-08-27. Sources at bottom.

## Can we register today?

No — not without a human doing the legal/corporate steps, and not with the MCP server as it exists.

- Registration is `partnersignup.salesforce.com` → **AgentExchange ISV Program Track**. Corporate application approval takes 1–3 weeks and requires a signed Partner Distribution Agreement (a legal signature, not something I can do).
- A Partner Business Org is provisioned after approval (1–3 business days, free for year 1).
- ~~Our `@lastest/mcp-server` is stdio-only.~~ **Resolved** — `/api/mcp` now speaks Streamable HTTP with OAuth 2.1 and dynamic client registration, and the CLI has `--transport http`. See Phase 1 below and `remote-mcp-oauth.md`.

## Listing surface options

AgentExchange accepts: Actions (Apex / Flow / external API), Topics, Prompt Templates, **MCP Servers**, and Agent/Sub-Agent Templates.

| Option | Build cost | Fit for Lastest |
|---|---|---|
| **A. Remote MCP server** | Low–medium | Best. We already have 50+ tools; needs an HTTP transport + OAuth. |
| B. External Service / API action pack | Medium | Needs an OpenAPI spec + Named Credential setup guide; no Apex. |
| C. 2GP managed package (Apex/Flow actions + topic) | High | Only if we want "Lastest QA" objects living inside Salesforce. Not our product. |

Recommend **A, then B as a companion** so a listing can show both an MCP server and a couple of turnkey agent actions. Skip C.

## Criteria we must satisfy

- Active Salesforce Partner Network member, ISV track, approved business plan.
- Solution must be **action-oriented and composable** — an agent triggers it; a passive UI does not qualify.
- Pass AgentExchange Security Review (annual, not per-version):
  - Static scan output (`sfdx-scanner` / Code Analyzer; Checkmarx report where external components exist).
  - **DAST report** on our external endpoints — OWASP ZAP, Burp Suite, or Qualys. Chimera was retired 2025-06-16.
  - Auth via Named Credentials / External Credentials — no secrets in config.
  - Documented data flows, external endpoints, permission scoping, data handling.
  - A test org with pre-loaded data and login steps, plus URLs+credentials for external components.
- **Connected App / External Client App hardening** became mandatory 2026-05-11; non-compliance risks delisting.
- Listing assets: title, tagline, description written for semantic/intent search, input/output schemas per tool, install guide, screenshots, <3-min demo video.

## Costs

- Partner Community signup + Partner Business Org: free.
- Security review: **$999** one-time per paid listing, **~$150/yr** renewal.
- Revenue share (ISVforce): **15%** of net subscription revenue, dropping to 10% past $20M cumulative. Free listings: no rev share.
- Realistic timeline: ~5 months clean, ~7 months with one resubmission. ~50% of first submissions fail review.

## Implementation plan

### Phase 0 — Business gate (blocks everything, human-only)
1. Sign up at partnersignup.salesforce.com under the AgentExchange ISV track; submit the business plan.
2. Sign the Partner Distribution Agreement.
3. Decide free vs paid listing (free avoids the $999 fee and the 15% rev share; paid gets Checkout billing). Recommend **listing free / bring-your-own Lastest account** for v1 — we bill outside Salesforce and dodge rev share on existing customers.
4. Request the Partner Business Org.

### Phase 1 — Remote MCP transport (`packages/mcp-server`) — **shipped**

Built on `feat/mcp-oauth-remote`. Design notes: `remote-mcp-oauth.md`.

1. ✅ Streamable HTTP alongside stdio. Two of them, in fact: `--transport http`
   for a standalone process, and the app's own `/api/mcp` route (which already
   existed, API-key only). Both share `createServer()`.
2. ✅ Hosted as a route behind the front proxy. `/api/mcp` and `/.well-known/`
   added to `PUBLIC_PATHS` — `/api/mcp` was missing, so bearer-only clients were
   being 307'd to `/login` before ever seeing a 401.
3. ✅ Accepts API keys *and* OAuth 2.1. better-auth's `mcp` plugin provides the
   authorization server (RFC 8414 metadata, RFC 7591 dynamic client
   registration, PKCE S256); `/.well-known/oauth-*` re-serve discovery at the
   paths clients actually probe, and a 401 carries RFC 9728
   `WWW-Authenticate`. Team scoping is unchanged — every tool still reaches
   `/api/v1`, which runs `requireTeamAccess()` / `requireRepoAccess()` per
   resource.
4. ✅ Stateless: one MCP server + transport per request, no cross-tenant state.
5. ❌ **Not done: per-connection rate limiting and audit logging.** The route
   logs a debug line per authenticated request and nothing else. Needed before
   submission — the MCP registry advertises per-server rate limits.

### Phase 2 — Tool surface curation — **mostly shipped**

1. ✅ Access levels (`read` / `write` / `full`) applied at registration:
   16 / 27 / 29 tools. Destructive actions are not gated behind a confirm flag,
   they are **absent** from an OAuth caller's schema — deletes, `share.revoke`,
   `publish_share` and `quickstart` require the user's own API key. Table in
   `packages/mcp-server/src/policy.ts`, drift-guarded by `policy.test.ts`.
2. ❌ **Not done: rewriting tool descriptions for intent-based discovery.** The
   existing descriptions are action-oriented and serviceable, but they were
   written for a developer's coding agent, not for AgentExchange's semantic
   search. This is listing-copy work and belongs with Phase 5.
3. ✅ Read-only entry point: `lastest_insights { action: "qa" }` and
   `lastest_status { action: "health" }` are both `read`-level and are what a
   probing agent lands on first.
4. ❌ **Not done: response redaction.** `redactSecrets()` covers inbound tool
   *parameters* before they reach activity logs; tool *responses* are not
   filtered. Worth an audit pass before customer data flows into a third-party
   agent platform.

### Phase 3 — Companion API actions (option B)
1. Publish an OpenAPI 3.0 spec for the 5–8 highest-value endpoints (run tests, build status, failing tests, approve diff, share link).
2. Ship a setup guide: External Credential (API key) → Named Credential → External Service registration → Agent Action.
3. Package the guide + spec in the listing rather than as a managed package.

### Phase 4 — Security review prep
1. Run OWASP ZAP against the hosted MCP endpoint and the public API; fix and re-scan; keep the report.
2. Run Code Analyzer if any Apex ships (none under options A/B — note that in the submission).
3. Write the solution architecture doc: data flow Salesforce → Lastest → EB pods → screenshots, where customer data rests, retention, encryption (`ENCRYPTION_KEY`, per-repo credential store).
4. Stand up a demo Lastest team + Salesforce test org with seeded builds/diffs and hand over login steps.
5. Confirm Connected App / External Client App controls meet the 2026-05-11 baseline.

### Phase 5 — Listing + launch
1. Listing copy, logo, screenshots, <3-min demo video (reuse the existing `/r/` share flow for the demo).
2. Submit for security review; budget 4–8 weeks first pass, 2–3 weeks per resubmission.
3. Publish; plan the annual re-review.

## Status

Phases 1 and 2 are built and verified end to end against a local instance
(discovery → dynamic client registration → forced consent → PKCE exchange →
scope-limited tool list), with two gaps called out inline: no per-connection
rate limiting, and no redaction of tool responses. Phase 0 is a legal/corporate
gate no one has started, and Phases 3-5 are marketplace overhead waiting on the
business decision below.

## Go/no-go read

Worth doing only if we expect Salesforce-resident buyers — the listing math works at >$25K ACV and enterprise procurement. Phases 1–2 are worth building regardless: a remote, OAuth'd MCP server is what every MCP registry (and our own customers) will want next, so that work is not Salesforce-specific sunk cost. Phases 0, 3–5 are pure marketplace overhead and should wait on a business decision.

## Sources

- https://developer.salesforce.com/docs/platform/isvforce/guide/security-review-how-it-works.html
- https://developer.salesforce.com/docs/platform/isvforce/guide/security-review-required-materials.html
- https://developer.salesforce.com/docs/platform/isvforce/guide/security-review-guidelines.html
- https://www.salesforce.com/agentforce/agentexchange/
- https://www.salesforce.com/agentforce/mcp-support/
- https://agentexchange.salesforce.com/collections/agentforce-mcp
- https://www.concret.io/blog/requirements-for-app-listing-on-salesforce-agentexchange
- https://appnigma.ai/blogs/salesforce-appexchange-listing-guide-2026/
- https://www.salesforce.com/partners/become-an-isv-partner/
