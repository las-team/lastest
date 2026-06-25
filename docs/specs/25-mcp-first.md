# Feature Spec: MCP-First (deprecate in-product AI + BYOK promotion)

> **Status:** Phase 1 — Mapping. This document is the thorough inventory and
> decision table. No code changes are made by this phase. Implementation phases
> are sketched at the end.

## Goal

Shift the product's center of gravity from **running LLM inference inside the
product** (which forces BYOK / hosted-key economics, key storage, provider
routing, and in-product AI promotion) to **exposing the product as an MCP
server** that the user's *own* AI agent (Claude Code, Claude Desktop, Cursor,
Windsurf, Cline, etc.) drives with the user's *own* model subscription.

In short: **the AI lives in the user's client, not in our backend.** We provide
tools, prompts, and resources; the user's agent provides the inference.

### Hard constraints from the request

1. **Stop promoting direct in-product AI.** Onboarding and Settings should steer
   users to connect their own agent over MCP, not to paste API keys or enable a
   hosted model.
2. **Quickstart is the deliberate exception.** Quickstart keeps using AI
   server-side, silently, *without the user's knowledge*. This means the
   server-side AI provider plumbing must **not** be ripped out — only its
   promotion/UI surface is removed. Quickstart continues to depend on it.
3. **MCP-first comparison.** For every place AI is used today, decide whether it
   can be replaced by *the user's agent calling MCP* (a tool and/or a surfaced
   MCP **prompt**), and what MCP improvements make that ergonomic and effective.

---

## Part A — Where AI is used today (inventory)

All in-product inference routes through one abstraction:

- **Dispatcher:** `src/lib/ai/index.ts` — `getAIProvider()` (`:29-84`) +
  `generateWithAI()` (`:107-230`), which also writes `ai_prompt_logs` and bridges
  MCP tool-calling (`src/lib/ai/mcp-bridge.ts`).
- **Providers:** `src/lib/ai/{claude-cli,claude-agent-sdk,openrouter,anthropic-direct,openai,ollama}.ts`
- **Config source:** `getAISettings(repositoryId)` → `ai_settings` table.

### A.1 User-triggered AI features

| # | Feature | File:entry | What the AI does | Uses MCP today |
|---|---------|-----------|------------------|----------------|
| 1 | **Test generation** (Generator agent) | `src/lib/playwright/generator-agent.ts:101` `agentCreateTest()` | Generate Playwright test code from spec/plan; verifies selectors against live page | Yes (Playwright MCP) |
| 2 | **Test healing** (Healer agent) | `src/lib/playwright/healer-agent.ts:74` `agentHealTestCore()` | Auto-fix failing test by inspecting live UI, rewriting selectors/assertions | Yes |
| 3 | **Test enhancement** (Enhancer) | `src/lib/playwright/enhancer-agent.ts:73` `agentEnhanceTest()` | Add assertions / edge cases / better selectors to an existing test | Yes |
| 4 | **Area discovery / planning** (Planner) | `src/lib/playwright/planner-agent.ts:135` `agentDiscoverAreas()` | Explore live app, identify functional areas, produce test plans | Yes |
| 5 | **One-off AI fix** | `src/server/actions/ai.ts:125` `aiFixTest()` (+ bulk `aiFixAllFailedTests`, `aiFixTests`) | Single-pass fix of a failing test (no MCP loop) | No |
| 6 | **Route scan / explore** | `src/server/actions/ai-routes.ts:268` `aiScanRoutes()`, `:394` `mcpExploreRoutes()`, `:663` `scanBranchDiff()` | Find testable routes from source or live exploration | Explore variant: yes |
| 7 | **Spec → test / plan / drift** | `src/server/actions/specs.ts` (`generateTestFromSpec` `:146`, `convertPlanToSpecs` `:252`, `generatePlanFromSpecs` `:404`, `detectSpecDrift` `:624`, …) | Generate tests/plans from specs and vice-versa; detect drift | No |
| 8 | **Spec import** | `src/server/actions/spec-import.ts` (`:666`, `:1122`, `:1494`) | Process imported specs → tests; route extraction (MCP) | Mixed |
| 9 | **AI variable values** | `src/server/actions/tests.ts:223` `generateAIVarValuePreview()` | Generate realistic test-data values for AI vars | No |
| 10 | **Play agent** | `src/server/actions/play-agent.ts:2908` `startPlayAgent()` → `agentCreateTest` | Record interactions + generate test code | Yes |
| 11 | **Placeholder test scaffold** | `src/server/actions/ai.ts:453` `startGeneratePlaceholderTestAgent()` | Build scenario-placeholder scaffold before full gen | Yes (downstream) |

### A.2 Background / automatic AI features

| # | Feature | File:entry | What the AI does | Trigger |
|---|---------|-----------|------------------|---------|
| 12 | **Failure triage** | `src/lib/ai/failure-triage.ts:51` `triageTestFailure()` (+ `triageBuildFailures`) | Classify failures: regression / flaky / env / maintenance | After failed tests (auto) |
| 13 | **Change-map analysis** | `src/lib/ai/change-map-analyzer.ts:144` `analyzeChangeMap()` | Per-area risk + intent narrative from changed files | Build verify (auto) |
| 14 | **Visual diff analysis** | `src/lib/ai/diff-analyzer.ts:113` `analyzeDiff()` | Vision classify pixel diffs: insignificant / meaningful / noise | After diffs detected (auto) |
| 15 | **Template classification** | `src/lib/templates/classifier.ts:27` `classifyTemplate()` | Classify repo into a testing template | Repo setup (auto) |
| 16 | **Quickstart demo notes** | `src/lib/quickstart/quickstart-notes.ts` `generateDemoNotes()` | Write presentation demo notes from run facts | Quickstart only |
| 17 | **Quickstart scouts** | `src/lib/playwright/quickstart-scout/*` (via `src/server/actions/quickstart-agent.ts`) | Classify signup/auth, walk authed surface | Quickstart only |

> `actionType` taxonomy logged to `ai_prompt_logs`: `agent_generate`, `agent_heal`,
> `enhance_test`, `planner`, `triage`, `scan_routes`, `discover_routes`,
> `fix_test`, `generate_var_value`, `generate_spec`/`generate_test`/`plan_generation`/`drift_detection`,
> `generate_demo_notes`.

### A.3 BYOK / provider configuration surface (to be de-promoted)

- **Schema:** `src/lib/db/schema.ts:1537-1599` (`aiSettings`), `DEFAULT_AI_SETTINGS:1583`.
  ~20 fields incl. `provider`, `openrouterApiKey/Model`, `anthropicApiKey/Model`,
  `openaiApiKey/Model`, `ollamaBaseUrl/Model`, `agentSdk*`, `customInstructions`,
  `aiDiffing*`, `pwAgent*`.
- **Crypto:** `src/lib/crypto.ts` (AES-256-GCM, `enc:v1:`) encrypts the 4 key fields.
- **Queries:** `src/lib/db/queries/settings.ts:408-530` (`getAISettings`, `upsertAISettings`, …).
- **Server actions:** `src/server/actions/ai-settings.ts` (`getAISettings` masked,
  `saveAISettings`, `testAIConnection`, `resetAISettings`).
- **UI (the BYOK card):** `src/components/settings/ai-settings-card.tsx` (985 lines):
  provider dropdown (6 providers), per-provider key + model inputs, custom
  instructions, Playwright-agent settings, visual-diff analysis config, Test
  Connection, Reset. Mounted in `src/app/(app)/settings/page.tsx:528-567` ("AI" tab).
- **Team kill-switch:** `teams.ban_ai_mode` (`schema.ts:1855`) + `ban-ai-mode-toggle.tsx`.

### A.4 Existing MCP server (`packages/mcp-server/`, npm `@lastest/mcp-server` v0.3.7)

- **51 tools**, all `lastest_*`, over `/api/v1/*` with a Bearer API key
  (`lastest_api_…`, `sessions.kind='api'`, verified by `src/lib/auth/api-key.ts`).
  Stdio **and** HTTP transport (`/api/mcp` route, shared `createServer()`).
- Covers: repos, areas, tests CRUD + **`lastest_create_test`** (direct *or* AI
  gen via url/prompt) + **`lastest_heal_test`**, builds/runs, diffs
  approve/reject (single + batch), storage states, setup scripts, sharing,
  coverage, change-map + verify + per-layer feedback, QA summary / review build,
  **`lastest_quickstart` / `lastest_quickstart_status`**, job polling, activity log.
- **MCP Resources: NOT implemented. MCP Prompts: NOT implemented.** Only Tools.
- Notable gaps vs. in-product AI: enhancer, planner/discover-areas, route
  scan/explore, spec import, AI-var values, design-rule authoring, scheduled
  runs, runner health.

---

## Part B — Comparison table: replace with MCP?

Legend for **Replace?**:
- ✅ **Replace** — drop in-product inference; the user's agent does it via MCP.
- 🟡 **Replace, gap** — replaceable in principle, but needs a new MCP tool/prompt/resource first.
- 🔒 **Keep in-product** — must remain server-side (quickstart exception or non-LLM).

"MCP prompt for the user" = a surfaced MCP **Prompt** (slash-command-style template
that appears in the user's client) that orchestrates the relevant tools. "MCP tool
gap" = a new `lastest_*` tool the agent needs.

| # | Feature (today, in-product) | Replace? | MCP path for the user | MCP improvement needed (for the agent) |
|---|---|---|---|---|
| 1 | Test generation | ✅ | Tool `lastest_create_test` (prompt mode) already exists | Add **Prompt** `generate-tests-for-area` wrapping create+run+review; ship a Skill/README recipe |
| 2 | Test healing | ✅ | Tool `lastest_heal_test` exists | Add **Prompt** `heal-failing-tests` (list_failing_tests → heal → run → review loop) |
| 3 | Test enhancement | 🟡 | No tool yet | **New tool** `lastest_enhance_test` (or a Prompt that reads test via `get_test`, edits, `update_test`) |
| 4 | Area discovery / planning | 🟡 | No "discover" tool (only area CRUD) | **New tool** `lastest_discover_areas` (kick off live exploration) **or** a Prompt that drives Playwright-MCP + `create_area` |
| 5 | One-off AI fix | ✅ | Subsumed by `lastest_heal_test` | Deprecate the in-product one-off path; point to heal Prompt |
| 6 | Route scan / explore | 🟡 | Not exposed | **New tools** `lastest_scan_routes` / `lastest_explore_routes`; or Prompt driving Playwright-MCP + route persistence endpoint |
| 7 | Spec → test / plan / drift | 🟡 | Not exposed | **New tools** `lastest_generate_from_spec`, `lastest_detect_spec_drift`; expose specs read/write over `/api/v1` |
| 8 | Spec import | 🟡 | Not exposed | **New tool** `lastest_import_spec` (accept OpenAPI/GraphQL/text), returns created tests |
| 9 | AI variable values | 🟡 | Not exposed | Small **tool** `lastest_suggest_var_value`, or let the agent fill values directly via `update_test` (no inference needed server-side) |
| 10 | Play agent (interactive) | 🟡 | Partial — relies on in-product recorder | Keep recorder (deterministic) in-product; expose **Prompt** to turn a recording into a test via `create_test` |
| 11 | Placeholder scaffold | ✅ | Agent scaffolds directly | Prompt `scaffold-area-tests`; no server inference |
| 12 | Failure triage (auto) | 🟡 | Today automatic + server-side | Stop auto-inference; expose triage **inputs** (error/console/history) via `get_test_run` and add **Prompt** `triage-build-failures` so the agent classifies. Keep a non-AI heuristic fallback. |
| 13 | Change-map analysis (auto) | 🟡 | `lastest_get_change_map` returns the AI summary today | Make the AI narrative optional/server-light; expose raw 4-signal data so the agent writes the narrative via a **Prompt** `summarize-change-map` |
| 14 | Visual diff analysis (auto, vision) | 🟡 | `get_visual_diff` exposes classification | Stop auto vision-inference by default; the agent already gets diff images via tools → **Prompt** `review-visual-diffs` lets the user's (vision-capable) model classify + approve/reject |
| 15 | Template classification (auto) | ✅ | Low value to the user's agent | Make purely heuristic (framework/route signals) — drop LLM entirely; no MCP needed |
| 16 | **Quickstart demo notes** | 🔒 | — | Keep server-side. No promotion. |
| 17 | **Quickstart scouts/auth** | 🔒 | — | Keep server-side. No promotion. |

**Net:** of 17 features, **2 stay server-side (quickstart)**, 1 becomes pure
heuristic (template), and the remaining 14 are user-agent-drivable over MCP — with
~7 new tools and a set of MCP Prompts/Resources to make them ergonomic.

---

## Part C — MCP improvements for "easier access & effective usage"

The current server is **tools-only**. To make the user's agent effective without
in-product inference, add the two missing MCP primitives plus a few tools.

### C.1 New MCP **Prompts** (surfaced as slash-commands in the client)

These are the headline "MCP prompt for the user" deliverables — they encode the
workflows the in-product AI used to run:

1. `generate-tests-for-area` — create → run → review loop for a functional area.
2. `heal-failing-tests` — list failing → heal → re-run → report.
3. `review-build` — pull build + diffs + failures → recommend approvals.
4. `review-visual-diffs` — walk pending diffs, classify, approve/reject (vision).
5. `triage-build-failures` — classify each failure with evidence.
6. `summarize-change-map` — narrate per-area risk from raw signals.
7. `onboard-repo` — connect repo, set base URL, discover areas, scaffold first tests.

### C.2 New MCP **Tools** (fill the gaps)

`lastest_enhance_test`, `lastest_discover_areas`, `lastest_scan_routes` /
`lastest_explore_routes`, `lastest_generate_from_spec`, `lastest_detect_spec_drift`,
`lastest_import_spec`, `lastest_suggest_var_value`. Each maps to an existing
server action; mostly thin `/api/v1` wrappers.

### C.3 New MCP **Resources** (read-only context for the agent)

- `lastest://repo/{id}/conventions` — test-code signature, runner API, selector rules.
- `lastest://repo/{id}/templates` — applicable testing template + examples.
- `lastest://repo/{id}/design-system` — tokens/rules for the design layer.
- `lastest://docs/test-authoring` — the prompt guidance previously baked into in-product prompts (`docs/specs/14-ai-prompts.md`).

Exposing conventions/templates as resources is what lets the *user's* model write
runner-valid test code as well as our in-product prompts did.

### C.4 Onboarding ergonomics for MCP

- One-click **"Connect your AI agent"**: generate an API key + copy-paste
  `claude mcp add …` / JSON config (stdio) and the HTTP `/api/mcp` variant.
- Detect "no agent connected yet" and show the connect card instead of an AI CTA.

---

## Part D — Onboarding & Settings revision (map of changes)

### D.1 Onboarding (`src/app/(onboarding)/onboarding/onboarding-client.tsx`)

Today: 3 paths (manual / **AI-assisted [Recommended]** / Play agent), 5 steps, with
**Step 4** a dedicated "hosted Claude is ready / use your own key / disable AI" screen
(`:1019-1083`), shown for non-manual paths.

Proposed reframe (no in-product AI promotion):

- **Path cards (`:70-120`):** replace "AI-assisted (Recommended)" with **"Bring
  your own agent (MCP)"** as the recommended path: *"Drive Lastest from Claude
  Code / Cursor / your IDE."* Keep "Manual". Demote/rename the in-product "Play
  agent" path (it's the heaviest in-product-AI user).
- **Step 4 (`:1019-1083`):** replace the hosted-Claude/BYOK confirm with a
  **"Connect your AI agent over MCP"** step (API key + install snippet + verify).
  Remove "Lastest hosted Claude is ready… No API key needed" and "Use my own key →".
- **`setOnboardingPath` / `onboardingPath`** values updated accordingly; layout
  guard unchanged.
- **Quick start shortcut (`:233-255`)** stays (see Part E) — it must *not* mention
  AI.

### D.2 Settings (`src/app/(app)/settings/page.tsx`, "AI" tab `:528-567`)

- **Hide/retire the BYOK card** (`ai-settings-card.tsx`) from the default UI: no
  provider dropdown, no key inputs, no model pickers promoted to users.
- **Replace** the AI tab content with an **"AI Agent (MCP)"** panel: API-key
  management (reuse Runners & API Access), install snippets, link to MCP docs,
  and the list of available Prompts/tools.
- **Keep `ban_ai_mode`** as a team kill-switch (now mostly governs quickstart +
  any residual heuristics).
- **Do not delete** `ai_settings` schema/crypto/queries/`testAIConnection` — they
  remain the server-side provider config that **quickstart** depends on. Optionally
  collapse to a single hidden system/hosted provider used only by quickstart +
  any retained background heuristics. (Schema-removal decision deferred to impl.)

### D.3 In-product AI promotion to remove/soften

- Onboarding Step 1 "Recommended" badge on AI path → move to the MCP path.
- Onboarding Step 4 hosted-AI copy → removed.
- Any "Generate test" Sparkles CTAs (`ai-create-test-dialog.tsx`) — keep available
  but de-emphasize; primary guidance points to the MCP agent. (Promotion audit is
  light today per mapping; no hard paywalls exist.)

---

## Part E — Quickstart exception (explicitly preserved)

Quickstart is the one place AI keeps running **server-side and silently**:

- Orchestrator `src/server/actions/quickstart-agent.ts` (9 steps); AI in scout
  (2,4), auth setup (3), generate (5), demo notes (6).
- Gating `src/lib/quickstart/gating.ts` (repo + non-localhost baseUrl + early
  adopter + not ban-ai). UI `quickstart-panel.tsx` shows progress, **never** AI
  prompts or "approve AI" — consistent with "without the user's knowledge."

**Requirements that fall out of this:**

1. The **AI provider plumbing must stay functional** (dispatcher, at least one
   provider with a system/hosted key) even after BYOK UI is removed. Quickstart
   reads `getAISettings()` → must resolve to a working provider server-side.
2. Recommend introducing a **system-level AI config** (env-based hosted key) that
   quickstart uses, decoupled from the now-hidden per-team BYOK fields, so removing
   the BYOK UI never breaks quickstart.
3. Quickstart copy in onboarding/dashboard must continue to avoid the word "AI".

---

## Part F — Suggested phasing (post-mapping)

- **Phase 2 — MCP capability parity:** add the new tools (C.2), Prompts (C.1),
  and Resources (C.3); ship a Skill/README recipe bundle. Decouple quickstart onto
  a system AI config (E.2).
- **Phase 3 — De-promote in-product AI:** onboarding reframe (D.1), Settings AI
  tab → MCP panel (D.2), remove AI CTAs (D.3). Make template classification
  heuristic (#15). Make triage/change-map/diff analysis opt-in instead of auto
  (#12–14).
- **Phase 4 — Cleanup:** decide schema-removal scope for unused BYOK fields
  (separate spec, cf. `docs/specs/16-schema-removals.md`), keeping only what
  quickstart/system AI needs.

---

## Appendix — key file index

| Concern | Path |
|---|---|
| AI dispatcher / providers | `src/lib/ai/index.ts`, `src/lib/ai/{claude-cli,claude-agent-sdk,openrouter,anthropic-direct,openai,ollama}.ts` |
| MCP bridge (in-product) | `src/lib/ai/mcp-bridge.ts` |
| Background AI | `src/lib/ai/{failure-triage,change-map-analyzer,diff-analyzer}.ts`, `src/lib/templates/classifier.ts` |
| Agents | `src/lib/playwright/{generator,healer,enhancer,planner}-agent.ts` |
| AI server actions | `src/server/actions/{ai,ai-routes,specs,spec-import,play-agent,tests}.ts` |
| BYOK config | `src/lib/db/schema.ts:1537-1599`, `src/lib/crypto.ts`, `src/lib/db/queries/settings.ts:408-530`, `src/server/actions/ai-settings.ts`, `src/components/settings/ai-settings-card.tsx` |
| Settings page | `src/app/(app)/settings/page.tsx:528-567` |
| Onboarding | `src/app/(onboarding)/onboarding/onboarding-client.tsx` (Step 1 `:70-120`, Step 4 `:1019-1083`) |
| Quickstart | `src/server/actions/quickstart-agent.ts`, `src/lib/quickstart/{gating,quickstart-notes,storage-capture}.ts`, `src/components/quickstart/quickstart-panel.tsx` |
| MCP server | `packages/mcp-server/src/{server,client,index}.ts`, `README.md`, `skill/SKILL.md` |
