# Explorer Agent — Implementation Plan

Adding explorbot-style autonomous exploratory testing ([testomatio/explorbot](https://github.com/testomatio/explorbot)) as a new agent kind alongside the existing QA Agent.

## Context

The QA Agent is a **suite builder**: it discovers routes, drafts a plan (with a human review gate), generates test code, executes it, and heals failures. Explorbot represents a different capability: an **exploratory tester** that autonomously drives a live browser in an iterative loop — research the current page, plan scenarios in rotating styles, execute them adaptively step-by-step, record defects/UX findings, learn from experience, and only *then* optionally keep passing flows as real tests. It finds bugs before any test code exists and accumulates memory across runs.

**Feasibility verdict: yes — roughly 70% of the required infrastructure already exists.** The platform already has multi-step agent sessions, an embedded-browser (EB) pool with CDP + live streaming, AI-over-Playwright-MCP navigation, deterministic crawlers/page-mappers, an activity/SSE feed, and an AI-driven test generation path. What's genuinely new is the iterative loop orchestration, planning styles, the two memory systems (knowledge + experience), page-state hashing/stuck detection, and clustered findings.

### Explorbot capability → what we have / what's new

| Explorbot capability | Existing analog | Gap |
|---|---|---|
| Research (map page: forms, buttons, links) | `browsePageMap()` (`src/lib/playwright/ranger.ts`), `crawlTargetApp()` (`src/lib/qa-agent/crawl.ts`) | None — reuse as-is |
| AI drives browser step-by-step | `generateWithAI()` + Playwright MCP over EB CDP (`src/lib/ai/index.ts`, `mcp-bridge.ts`) | None — reuse as-is |
| Live watchable session | EB `streamUrl` + `BrowserViewer` (ranger/QA pattern) | None — reuse as-is |
| Multi-step agent w/ pause/resume/cancel | `agent_sessions` + `executeQaPipeline` pattern (`src/server/actions/qa-agent.ts`) | Extend for iterative loop |
| Planning styles (normal/curious/psycho) | — | **New**: style prompt fragments + rotation |
| Knowledge (human hints per URL pattern) | — | **New**: `agent_knowledge` table + matcher + prompt injection |
| Experience (learned notes per page state) | — | **New**: `agent_experience` table keyed by state hash |
| Page state = URL + h1/h2 (loop detection) | — | **New**: `hashState()` + stuck heuristics |
| Findings clustered by root cause, severity | `bug_reports` (user-scoped, wrong shape) | **New**: `agent_findings` table + AI analyst step |
| Keep passing flows as tests | `agentCreateTest()` (`src/lib/playwright/generator-agent.ts`) | Wire action log → generator, create quarantined |
| Autonomous scheduling / MCP control | `qa_agent_triggers`, `qa_tasks`, `packages/mcp-server` | Clone patterns (deferred milestone) |

## Key design decisions

1. **New `AgentSessionKind = "explorer"`**, cloning the QA-agent orchestration skeleton (detached fire-and-forget pipeline, AbortController registry, step-state array, poll route). Ranger (`src/server/actions/ranger-agent.ts`) is the provision→stream→observe→release template.
2. **Iterative loop as repeated step entries.** `buildExplorerSteps(maxIterations)` emits `[setup, login]`, then per iteration a block of `research → plan → act → analyze` entries (new optional `iteration?: number` on `AgentStepState`), then `[keep, summary]`. The loop is linear in the array, so QA's `pipeline.indexOf(fromStep)` driver, pause/resume via `currentStepId`, and the timeline UI all work unchanged. Early exit (stuck / budget) marks remaining loop steps `skipped`.
3. **Findings get a new `agent_findings` table**, not `bug_reports`. Bug reports are user-scoped (`reportedById` NOT NULL, no `repositoryId`, extension-shaped `context`); explorer findings need `sessionId`, `pageStateHash`, `rootCauseCluster`, `scenario`, evidence refs, and a `defect | ux` kind. A later "promote to bug report" action bridges the two.
4. **Knowledge & experience are DB-backed** (explorbot uses filesystem markdown). Required for repo scoping, multi-tenancy, and credential encryption via the existing `crypto-fields` pattern. Markdown body is preserved as a text column; URL matching is a column (`exact | prefix | regex`).
5. **Keep-as-test uses `agentCreateTest`** (semantic scenario in → MCP-verified selectors → `export async function test(page, baseUrl, screenshotPath, stepLogger)` out), not `event-to-code` (which needs raw recorded DOM events the explorer doesn't produce). Kept tests are created **quarantined** and linked to a functional area.
6. **Cost control is structural**: hard iteration budget, per-scenario step budget, heuristic stuck-detection first (state-hash repetition) with an optional AI "pilot" second opinion off by default, planner skips already-covered scenarios via a coverage digest, JSON response format everywhere.

## Schema changes (`src/lib/db/schema.ts`)

Per CLAUDE.md: edit schema → update `DEFAULT_*` constants → `pnpm db:push` → update query modules.

### Extend shared unions (highest-touch change — see Risks)

- `AgentSessionKind` (~line 2580): add `"explorer"`.
- `AgentStepId` (~line 2582): add `explorer_setup | explorer_login | explorer_research | explorer_plan | explorer_act | explorer_analyze | explorer_keep | explorer_summary`.
- `PwAgentType` (~line 2627): add `"explorer"`; `ActivitySourceType` (~line 3811): add `"explorer_agent"`.
- `AgentStepState`: add optional `iteration?: number`.
- `AgentSessionMetadata` (~line 3129): add explorer block — `explorerTargetUrl`, `explorerMaxIterations`, `explorerIteration` (resume cursor), `explorerStyleRotation`, `explorerVisitedStates`/`explorerStateHistory` (hashes), `explorerPageMap`, `explorerCurrentPlan: ExplorerScenario[]`, `explorerActionLogs`, `explorerFindingIds`, `explorerReport`, `explorerKeptTestIds`, `explorerAuth` (reuse `QaAuthState`). Credentials reuse the existing encrypted `quickstartEmail`/`quickstartPassword` fields (already covered by `encrypt/decryptSessionMetadata` in `src/lib/crypto-fields.ts` — no new encrypted metadata field).

New supporting types: `ExplorerStyle = "normal" | "curious" | "psycho"`, `ExplorerScenario` (id, title, style, steps, rationale, skipped/skipReason), `ExplorerActionStep`/`ExplorerActionLog` (per-step intent/action/selector/result, console errors, failed requests, final state hash), `ExplorerReport` (root-cause clusters with severity + finding ids), `ExplorerFindingKind = "defect" | "ux"`, `ExplorerSeverity`.

### New tables

**`agent_knowledge`** — human hints (explorbot `knowledge/`): `repositoryId` (FK cascade), `teamId`, `title`, `urlPattern`, `matchKind: exact|prefix|regex`, `body` (markdown), optional `credEmail`/`credPassword` (**encrypted**), optional `pageAutomation` jsonb (deterministic pre-steps, e.g. dismiss cookie banner), `enabled`, audit columns. Index on `repositoryId`.

**`agent_experience`** — agent-learned notes (explorbot `experience/`): `repositoryId`, `teamId`, `stateHash` (unique per repo), `normalizedUrl`, `headingsDigest`, `notes` jsonb array (`{kind: resolution|failure|observation, text, scenarioStyle?, sessionId?, at}`), `timesVisited`, `lastSessionId`.

**`agent_findings`**: `repositoryId`, `teamId`, `sessionId`, `kind`, `severity`, `title`, `description`, `rootCauseCluster` (set by analyst), `pageStateHash`, `url`, `scenario` jsonb, `evidence` jsonb (screenshot paths, console errors, failed requests, step-comparison ids), `status: open|triaged|dismissed|kept`, `bugReportId` (promotion link). Index on `sessionId`.

### Crypto + settings

- Extend `src/lib/crypto-fields.ts` with `encryptKnowledgeRow`/`decryptKnowledgeRow` for `agent_knowledge.credPassword` (same `ENC_PREFIX` primitives), applied in the knowledge query layer.
- Extend `DEFAULT_AI_SETTINGS` + `getAISettings` fallback with `explorerMaxIterations: 8`, `explorerStyleRotation: "normal,curious,psycho"`, `explorerModelTier: ""` (empty = default model). Per CLAUDE.md, every new field must be in the default.

## Query modules (`src/lib/db/queries/`, barrel-exported)

- `explorer.ts` — findings CRUD: `createAgentFinding`, `listFindingsBySession`, `updateFindingCluster`, `updateFindingStatus`, `promoteFindingToBugReport`. Session queries in `integrations.ts` are kind-generic and reused unchanged.
- `agent-knowledge.ts` — CRUD + `matchKnowledgeForUrl(repoId, url)` (enabled rows whose pattern matches, decrypted).
- `agent-experience.ts` — `getExperience(repoId, stateHash)`, `upsertExperience` (increments `timesVisited`), `appendExperienceNote`, `listExperienceForUrls`.

## New library: `src/lib/explorer/` (mirrors `src/lib/qa-agent/`)

| File | Contents |
|---|---|
| `state.ts` (+test) | `normalizeUrl()` (strip query/hash noise, ids → `:id`), `hashState(url, headings)` — sha256 over normalized URL + lowercased h1/h2. The explorbot "state" concept: keys experience rows + drives loop detection. |
| `url-match.ts` (+test) | `matchUrlPattern(pattern, matchKind, url)` — exact / `*` prefix wildcard / safe regex. |
| `styles.ts` (+test) | `STYLE_FRAGMENTS: Record<ExplorerStyle, string>` (normal = happy-path CRUD flows; curious = coverage gaps/less-obvious paths; psycho = empty/invalid/extreme inputs then commit) + `nextStyle(rotation, iteration)`. |
| `research.ts` | `researchPage(cdpUrl, url, viewport)` → wraps `browsePageMap` + screenshot → `{pageMap, stateHash, screenshotPath}`. |
| `planner.ts` | `planScenarios(config, {pageMap, style, knowledge, experience, existingCoverage})` → `ExplorerScenario[]` via `generateWithAI` (JSON, no MCP). Instructed to skip covered scenarios. |
| `tester.ts` | `runScenario(config, cdpEndpoint, scenario, {knowledge, signal})` → `ExplorerActionLog`. Applies knowledge `pageAutomation` deterministically, then AI drives the EB via `generateWithAI` + Playwright MCP over CDP (same mechanism as generator/healer agents). Captures per-step results, screenshots, console/network anomalies. |
| `supervisor.ts` (+test) | `isStuck(stateHistory)` (repeated state hash), per-scenario step budget; optional AI pilot behind a flag. |
| `analyst.ts` | `clusterFindings(config, findings)` → `ExplorerReport` — one AI call clustering by root cause, assigning severity + defect/ux. |
| `coverage.ts` | `buildCoverageDigest(repoId)` from existing tests + prior findings + `functional_areas.agentPlan`. |

## Orchestrator: `src/server/actions/explorer-agent.ts`

Clone the QA-agent structure; reuse verbatim: AbortController registry, `emitActivity` (with `sourceType: "explorer_agent"`), step patch helpers, `assertSafeOutboundUrl` SSRF guard, `claimEmbeddedBrowserForAgent`/`releasePoolEB`, one-active-session-per-repo via `getActiveAgentSession(repoId, "explorer")`.

Pipeline driver `executeExplorerPipeline(sessionId, teamId, repoId, fromStep)` — same control structure as `executeQaPipeline` (qa-agent.ts:2313). Per-step runners (`(sessionId, teamId, repoId, signal) => Promise<boolean>`):

- `runExplorerSetup` — SSRF check, AI-provider + EB-pool validation (mirror `runQaSetup`).
- `runExplorerLogin` — reuse QA login resolution / `QaAuthState` + storage-state injection; writes `explorerAuth`.
- `runExplorerResearch(i)` — claim EB (persist proxied `streamUrl` + `queuedForBrowser` for the live viewer), `researchPage`, push state hash. **Exit check:** stuck or budget reached → skip remaining loop steps, jump to `explorer_keep`.
- `runExplorerPlan(i)` — `nextStyle`, gather matched knowledge + experience + coverage digest, `planScenarios`.
- `runExplorerAct(i)` — hold the same EB from research (release between iterations to limit pool contention); run each scenario via `runScenario`; create `agent_findings` for failures/anomalies.
- `runExplorerAnalyze(i)` — experience write-back (`upsertExperience` + `appendExperienceNote`), advance `explorerIteration`.
- `runExplorerKeep` — each passing action log → `agentCreateTest` → quarantined test linked to a functional area; findings for kept scenarios → `kept`.
- `runExplorerSummary` — `clusterFindings`, persist `explorerReport`, back-fill finding clusters/severity, `session:complete`.

Public actions (mirroring QA-agent exports, all `"use server"` + `requireRepoAccess` + `revalidatePath`): `startExplorerAgent({repositoryId, targetUrl?, maxIterations?, styleRotation?, email?, password?}) → {sessionId}`, `getExplorerSession`, `pauseExplorerAgent` / `resumeExplorerAgent` / `cancelExplorerAgent`, `listExplorerFindings`, `updateFindingStatus`, plus knowledge CRUD (`listExplorerKnowledge` / `upsertExplorerKnowledge` / `deleteExplorerKnowledge`).

## API + UI

- `src/app/api/explorer-agent/[sessionId]/route.ts` — clone QA poll route (404 unless `kind === "explorer"`, strip `quickstartPassword`).
- `src/app/(app)/explorer/page.tsx` + sidebar entry (Compass icon) next to QA Agent.
- `src/components/explorer/`: `explorer-client.tsx`, `use-explorer-agent.ts` (polling hook, clone of `use-qa-agent.ts`), `explorer-timeline.tsx` (steps grouped by `iteration`, collapsible loop blocks), `explorer-live-view.tsx` (existing `BrowserViewer` on `metadata.streamUrl`), `explorer-findings-panel.tsx` (cluster/severity grouping, evidence thumbnails, promote-to-bug-report, keep-as-test), `knowledge-editor.tsx` (CRUD: pattern, match kind, markdown, creds, page automation), `experience-viewer.tsx` (read-only).

## MCP tools (`packages/mcp-server/src/server.ts`)

Clone the `lastest_ranger`/`lastest_qa_agent` blocks (wrapped in `withActivityReporting`): `lastest_explorer` (start), `lastest_explorer_status` (poll: iteration, streamUrl, findings summary), `lastest_explorer_findings`, `lastest_explorer_learn` (write a knowledge note — the explorbot `/learn` equivalent).

## Milestones

- **M1 — Core loop + findings (read-only).** Union extensions + metadata + `agent_findings`; `src/lib/explorer/` (state, styles, research, planner, tester, supervisor, coverage + unit tests); orchestrator (setup→login→loop→summary, keep stubbed); poll route; minimal UI (timeline, live view, findings panel); sidebar entry. Planner runs with empty memory.
- **M2 — Knowledge & experience.** `agent_knowledge` + `agent_experience` tables; crypto-fields extension; `url-match.ts`; planner/tester prompt injection; analyze write-back; knowledge editor + experience viewer UI.
- **M3 — Keep-as-test + settings.** `runExplorerKeep` via `agentCreateTest` (quarantined, area-linked); findings→bug-report promotion; `DEFAULT_AI_SETTINGS` fields + settings UI (max iterations, style rotation, model tier).
- **M4 — MCP + scheduling.** `lastest_explorer*` tools; `explorer_triggers` (clone `qa_agent_triggers`) for cron/PR runs; optional `explorer_tasks` direction queue (clone `qa_tasks`).

Recommended first pass: **M1 + M2** — the loop plus the memory system is what makes this explorbot-like rather than a rerun of the QA agent's discover phase.

## Verification

- **Unit (vitest):** `state.test.ts` (normalization, hash stability), `url-match.test.ts` (exact/wildcard/regex incl. malformed regex), `styles.test.ts` (rotation wrap), `supervisor.test.ts` (stuck detection, budgets).
- **E2E local (per CLAUDE.md):** `docker compose up -d` + `pnpm stack` + `pnpm dev`; start an explorer run against a demo app; watch the live BrowserViewer; confirm iterations advance, findings populate and cluster in the summary, experience `timesVisited` increments on re-run, a `/login`-pattern knowledge note appears in the planner prompt (verify via `aiPromptLogs` through `substep.promptLogId`), and (M3) "keep" yields a quarantined test that runs green.
- **Controls:** pause mid-loop → `currentStepId` persists → resume continues same iteration; cancel aborts via controller registry.

## Risks & mitigations

- **Shared-union coordination:** `AgentStepId`/`AgentSessionMetadata`/`PwAgentType`/`ActivitySourceType` are global unions consumed by exhaustive switches and label maps across the app. After extending, grep all switches/maps over these types and add explorer arms — this is the highest-touch change and the main merge-conflict surface with concurrent agent work.
- **EB pool contention:** one EB held per iteration (research + act share it, released between iterations); `queuedForBrowser` surfaces waits in the UI; one active explorer session per repo caps concurrency.
- **Token cost:** iteration budget × scenario step budget × heuristic-first supervision × coverage-based skipping × JSON outputs; model-tier override lets cheap models drive the loop (explorbot's "cheap workers, smart managers" — smart model only for the analyst/planner if desired).
- **SSRF:** every entry point (action, MCP tool, future trigger) calls `assertSafeOutboundUrl` before claiming an EB, same as ranger/QA.
- **Credential leakage:** `credPassword` encrypted at the query layer and stripped from client responses; interpolated creds must never be echoed into `aiPromptLogs`.
- **Non-termination:** state-hash stuck detection + hard iteration budget + per-scenario step budget guarantee the loop ends.

## Critical files

| File | Role |
|---|---|
| `src/lib/db/schema.ts` | Unions, metadata, 3 new tables, defaults |
| `src/server/actions/qa-agent.ts` | Orchestrator pattern to clone |
| `src/server/actions/ranger-agent.ts` | Provision→stream→observe→release skeleton |
| `src/lib/playwright/ranger.ts` | `browsePageMap` for research |
| `src/lib/qa-agent/crawl.ts` | Login helper + DOM extraction reference |
| `src/lib/ai/index.ts` / `mcp-bridge.ts` | `generateWithAI` + MCP-over-CDP for act phase |
| `src/lib/playwright/generator-agent.ts` | `agentCreateTest` for keep-as-test |
| `src/lib/db/queries/integrations.ts` | Agent-session queries (reused unchanged) |
| `src/lib/crypto-fields.ts` | Credential encryption to extend |
