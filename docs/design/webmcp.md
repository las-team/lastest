# Exposing Lastest over WebMCP

Status: slices 1-4 implemented (2026-08-27). Slices 5-7 outstanding — see §10.
Scope: **make the Lastest web app itself agent-callable**, reusing the existing MCP tool surface.
Explicitly **out of scope**: consuming/analyzing WebMCP tools on pages under test.

## 1. WebMCP in one screen

W3C Web Machine Learning CG draft (Google + Microsoft; Mozilla/Apple participating). A page declares
typed tools; the browser hands them to whatever agent the user is running, speaking MCP
`tools/list` / `tools/call` underneath.

- Entry point `document.modelContext` — moved off `Navigator` in the spec on 2026-05-27;
  `navigator.modelContext` is deprecated in Chromium 150. Secure context, `Exposed=Window`, top-level only.
- `registerTool(descriptor)`, `unregisterTool(name)`, `requestUserInteraction()`.
  `provideContext()`/`clearContext()` were removed in March 2026 precisely because they left tools
  callable after their UI unmounted — **registration is now tied to component lifecycle**.
- Descriptor: `{ name, title, description, inputSchema (JSON Schema), annotations: { readOnlyHint }, execute(input, client) }`.
- Also a declarative form (`<form toolname tooldescription toolautosubmit>`) — not useful for us; our
  operations are not form posts.
- Shipping: Chrome 146 Canary native, developer trial 2026-05-18, public origin trial in Chrome 149,
  local testing behind `chrome://flags/#enable-webmcp-testing`. Gated by a `tools` Permissions Policy
  that defaults to `self`. Nothing in Safari/Firefox/Edge stable.
- **OpenAI now consumes it too — see §1b.** That is the change that makes this worth building now.
- Lighthouse has an informational "Registered WebMCP tools" audit — free verification of our surface.

## 1b. The OpenAI announcements (2026-08-25/26)

- OpenAI added WebMCP support to the **ChatGPT desktop app's built-in browser**, **ChatGPT Work**,
  **Codex**, and **ChatGPT Sites**. They call the feature **"site tools"** — explicitly "ChatGPT's
  implementation of the proposed WebMCP standard". Visiting a compatible site surfaces an
  **"Available site tools"** picker; tools vanish on navigation; a **"Recently used"** list under
  *Sources* shows recent tool calls (that is our debugging surface).
- Their stated motivation is ours in reverse: Codex could already browse, but driving a UI is slow.
  Tools make it fast and deterministic.
- Docs: `learn.chatgpt.com/docs/webmcp` and `developer.chrome.com/docs/ai/webmcp`.
- Confirmed API in OpenAI's own docs: feature-detect
  `typeof document.modelContext?.registerTool === "function"`; descriptor
  `{ name, description, inputSchema, annotations: { readOnlyHint }, execute }`; `execute` may return a
  **plain object** (their example returns `{ title: document.title }`) — no MCP content-block wrapper
  required, though results should carry enough for the agent to verify the outcome.
- Their guidance: keep inputs narrow, describe side effects, reuse the site's existing auth and the
  signed-in session. Their showcase example ("Margin") ships **10 tools — 3 read, 7 write**, which is a
  useful sizing signal: ~10, not 29.
- Safety: "each tool invocation receives a safety review before it runs", and normal confirmation
  policies still apply for consequential actions. That is *their* layer, not a substitute for ours.

### The hackathon

**The WebMCP Challenge** — 10 days, opened 2026-08-25, run on Devpost with Chrome, Cloudflare,
Shopify, Vercel, Render and Netlify; $35k cash plus Codex Micros / ChatGPT Pro. Submissions due
**2026-09-03 (Devpost rules say 1pm PT; the OpenAI community post says 5pm PT — trust Devpost)**,
winners 2026-09-23. Judged on WebMCP leverage, execution, potential impact, creativity.

**Adding WebMCP to a site you already run is an explicitly eligible entry**, provided pre-existing work
is distinguished from new work with dated commit history. Lastest qualifies, and the slice-1-to-3
scope below is a week of work at most. Judge access needs a public live URL reachable from ChatGPT's
in-app browser or Chrome with WebMCP enabled — which for us means a **demo/logged-out surface**, since
our tools sit behind auth (see §7, slice 7).

## 2. The shape that fits us

We already have the whole tool surface twice-deployed and once-defined:

- `packages/mcp-server/src/server.ts` — 29 `server.tool(...)` definitions with zod schemas, over
  `LastestClient` → REST API v1 (`Authorization: Bearer`).
- `src/app/api/mcp/route.ts` — Streamable HTTP MCP endpoint reusing `createServer()`, Bearer-authed.

So WebMCP should be **a bridge, not a third definition**:

```
page (client component)
  └─ document.modelContext.registerTool(descriptor)   ← descriptors fetched, not hand-written
        execute(input) ──► POST /api/mcp/session  {"method":"tools/call"}  (cookie session)
                                └─ createServer(LastestClient) ──► /api/v1/*  ──► existing guards
```

- Tool **descriptors** come from a `tools/list` against our own endpoint. The MCP SDK already derives
  JSON Schema from the zod shapes, so schemas stay generated, never copied.
- Tool **execution** proxies `tools/call` to the same endpoint. Auth, capability checks, team scoping,
  activity reporting (`withActivityReporting`) and redaction (`redact.ts`) all apply unchanged.
- **No MCP SDK in the browser bundle.** The client side is ~120 lines of `fetch` + JSON-RPC framing.
  (`@mcp-b/global` would do this too, but it pulls a browser MCP server + transports we don't need,
  and it replaces `navigator.modelContext` wholesale. Consider it only for the polyfill, §6.)

## 3. Auth — the one real design decision

The browser has a better-auth **session cookie**; `/api/mcp` demands a **Bearer API key**. Options:

| Option | Notes |
|---|---|
| **A. Cookie-authed sibling route** `/api/mcp/session` (recommended) | `getCurrentSession()` (already the cookie-first helper `verifyBearerToken` falls back from). Same `createServer()`. Zero user setup. CSRF: JSON-RPC POST with `content-type: application/json` + a required `x-lastest-webmcp: 1` header is never a simple request → always preflighted; additionally reject unless `Origin` is same-origin (`sec-fetch-site: same-origin`). |
| B. Mint a short-lived Bearer from a server action, call `/api/mcp` | No new route, but puts a live API token in JS memory and adds DB token rows per page load. Worse. |
| C. Make the agent bring its own API key | Kills the entire "it just works while I'm logged in" value. |

Go with **A**, and have `LastestClient` reach v1 with the session's own token rather than re-deriving
auth in a second place — the route already knows how to build a client per request.

Capability gating is free: v1 routes call `requireRepoAccess()` / `requireTeamAccess()`, and
`isReadOnlySession()` already exists — a read-only member's agent gets 403s, not silent success.

## 4. Which tools to register (curation matters)

Registering all 29 is the wrong default: agents pick tools by matching intent against descriptions,
and a 29-tool blob with multi-action params ("action: create|update|delete") degrades selection.
OpenAI's own showcase site ships 10 (3 read / 7 write) — that is the target size per page.

Proposed tiers:

- **Global (always registered, read-only):** `lastest_list_repos`, `lastest_list_failing_tests`,
  `lastest_get_build_status`, `lastest_qa_summary`, `lastest_health_check`.
- **Route-scoped (registered by the page that has the context, with ids prefilled from the URL):**
  on a repo/build page — `lastest_list_builds`, `lastest_review_build`, `lastest_get_change_map`,
  `lastest_get_coverage`; on a diff/review page — `lastest_get_visual_diff`, `lastest_approve_diff`,
  `lastest_reject_diff`, `lastest_approve_all_diffs`; on a test page — `lastest_get_test`,
  `lastest_run_tests`, `lastest_heal_test`.
- **Never registered:** destructive/admin surface (`lastest_delete_*`, storage-state and credential
  tools). A browser agent, potentially reading attacker-controlled pages, is not who should hold these.

Prefilling ids from the route is the main quality win: the agent asks "approve the failing diff" and
does not first have to guess a repo id.

## 5. Consent + long-running work

- Read tools: `annotations.readOnlyHint: true`. ChatGPT runs its own safety review per invocation and
  confirms consequential actions, but that is one client's policy — we still gate ourselves.
- Mutations (`approve_diff`, `run_tests`, `heal_test`, …): `readOnlyHint: false` **and** gated behind
  `requestUserInteraction()` before the call is dispatched. Non-negotiable — prompt injection from a
  page the agent read elsewhere is the realistic attack, and "approve all diffs" is exactly the
  irreversible action it would aim at.
- `run_tests` must return promptly: return the job id and point the agent at `lastest_get_job_status`
  (the MCP tools already have this shape). Never block `execute` on a build.

## 6. Browser compatibility

```ts
const mc = (document as any).modelContext ?? (navigator as any).modelContext;
if (!mc?.registerTool) return; // no-op
```

Consumers, in priority order:

1. **ChatGPT desktop built-in browser / ChatGPT Work / Codex** — shipping now, no origin-trial token on
   our side (it is their browser). This is the channel to target and to demo against.
2. **Chrome 149+ origin trial / 146 Canary** — native. Our origin can carry a token via
   `<meta http-equiv="origin-trial">` in the root layout to run unflagged on `app.lastest.cloud`;
   locally, `chrome://flags/#enable-webmcp-testing`.
3. **Everything else** — optional `@mcp-b/webmcp-polyfill`, dynamically imported only when the native
   API is absent **and** the flag is on, which keeps the MCP-B extension path working. Now a
   nice-to-have rather than the whole distribution story.

Also: the `tools` Permissions Policy defaults to `self`. Check `next.config.ts` headers do not send a
`Permissions-Policy` that omits `tools`, and remember any iframe-embedded surface needs it delegated.

## 7. Implementation slices

1. **Route** — `src/app/api/mcp/session/route.ts`: cookie-session MCP endpoint (same-origin + custom
   header guard), reusing `createServer()`/`LastestClient`. ~80 LOC + tests for the CSRF guard
   (cross-origin `Origin` → 403, missing header → 403, no session → 401).
2. **Client bridge** — `src/lib/webmcp/client.ts`: JSON-RPC over `fetch` (`tools/list`, `tools/call`),
   no SDK. Plus `src/lib/webmcp/registry.ts`: the tier/allowlist table from §4 with per-tool
   `readOnlyHint` and prefill rules.
3. **Provider** — `src/components/webmcp/webmcp-provider-client.tsx` mounted in
   `src/app/(app)/layout.tsx` next to the existing providers: registers the global tier on mount,
   unregisters on unmount, feature-flagged (`NEXT_PUBLIC_WEBMCP=1` initially, then a team setting).
4. **Hook** — `useWebMcpTools(names, prefill)` for route-scoped registration; used by the repo, build,
   diff and test pages. Registration keyed by route so navigation swaps the set cleanly.
5. **Consent** — `requestUserInteraction()` wrapper + a small in-app confirm dialog fallback for the
   polyfill path (the polyfill cannot show browser-native UI).
6. **Polish** — a settings toggle ("Let browser AI agents control Lastest"), a
   `docs/` page, and a Lighthouse check that all registered tools show up with correct schemas.
7. **Public demo surface (needed for the Challenge, useful regardless)** — register a read-only tool
   set on the existing public share pages (`/r/<slug>`, already unauthenticated and already backed by
   `public-shares.ts`): `get_share_summary`, `list_failing_steps`, `get_visual_diff`. No session, no
   mutations, judge-accessible from a plain URL. This is also the honest demo of the pitch: an agent
   reads a Lastest report without a login.

Suggested first PR: slices 1–3 (global read-only tier only). That is demonstrable end-to-end in
Chrome and in ChatGPT desktop, and carries no mutation risk.

**If we enter the Challenge** (deadline 2026-09-03), the shippable cut is 1–3 + 7 + one write tool
(`run_tests` behind `requestUserInteraction()`), with commits dated inside the submission window and a
README separating prior work from new. Verification path: ChatGPT desktop → "Available site tools"
picker → run a task → check *Sources → Recently used*.

## 8. Verifying it works

- Chrome: `chrome://flags/#enable-webmcp-testing`, then the Model Context Tool Inspector / Lighthouse
  "Registered WebMCP tools" audit to confirm names + schemas.
- ChatGPT desktop: the **Available site tools** picker lists them; **Sources → Recently used** shows
  each call for inspection.
- Automated: a vitest that asserts every name in our allowlist still exists in `tools/list`, plus route
  tests for the CSRF guard.

## 9. Risks

- **Spec churn.** `navigator` → `document` already happened; more will. Confine every API touch to
  `src/lib/webmcp/` and one feature-detect helper.
- **Prompt injection → destructive action.** Mitigated by the never-register list, `requestUserInteraction()`
  on all mutations, and the existing capability guards. Write this down in the route header comment,
  the way `api/mcp/route.ts` and `mcp-server/src/server.ts` already document their auth posture.
- **CSRF on a cookie-authed JSON-RPC endpoint.** Preflight-forcing header + same-origin check; test it.
- **Loopback overhead.** Browser → `/api/mcp/session` → `/api/v1/*` is two hops. Same trade the
  existing HTTP route already accepted for single-source-of-truth; fine.
- **Tool-surface drift.** The bridge is descriptor-driven, so new MCP tools appear automatically —
  but the allowlist in §4 must be updated deliberately, and a test should fail when a tool name in the
  allowlist no longer exists in `tools/list`.

## 10. Implementation status

Shipped:

- `src/app/api/mcp/session/route.ts` — cookie-authed bridge (`{op:"list"|"call"}`), same-origin +
  `x-lastest-webmcp` CSRF gate, `createServer()` driven over `InMemoryTransport`.
- `packages/mcp-server/src/client.ts` — `apiKey` is now optional and `extraHeaders` forwards the
  caller's session cookie to `/api/v1/*`.
- `src/lib/webmcp/` — `types.ts`, `registry.ts` (16 narrowed tools + the forbidden lists),
  `arguments.ts` (context/bind merging), `bridge-client.ts`, `model-context.ts` (feature detect,
  registration, consent, result shaping).
- `src/components/webmcp/` — `WebMcpProvider` (mounted in `src/app/(app)/layout.tsx`, seeded with the
  user's selected project) and `WebMcpRouteContext`; build pages (`/builds/[buildId]`,
  `/verify/[buildId]`) and the tests screen contribute their ids.
- Tests: `registry.test.ts` (drift + safety guard against the live MCP surface), `arguments.test.ts`,
  `model-context.test.ts`, `src/app/api/mcp/session/route.test.ts` — 30 assertions.

Enable with `WEBMCP_ENABLED=1` (server-side env, not `NEXT_PUBLIC_*`, so it is not baked into the
client bundle at build time). Off by default; inert without `document.modelContext` regardless.

Not done yet: the `@mcp-b` polyfill path (slice 5's fallback beyond `window.confirm`), the settings
toggle (slice 6), and the public `/r/<slug>` tool surface (slice 7).

## Sources

- https://learn.chatgpt.com/docs/webmcp
- https://developer.chrome.com/docs/ai/webmcp
- https://openai.com/webmcp-challenge/ + https://webmcp.devpost.com/rules
- https://community.openai.com/t/build-agent-ready-websites-with-chatgpt/1392588
- https://googlechromelabs.github.io/webmcp-tools/demos/explainer/
- https://webmcp-checker.com/blog/navigator-modelcontext-api-reference
- https://deepwiki.com/webmachinelearning/webmcp/3.1-navigator.modelcontext-interface
- https://developer.chrome.com/docs/lighthouse/agentic-browsing/registered-webmcp-tools
- https://github.com/WebMCP-org/npm-packages
