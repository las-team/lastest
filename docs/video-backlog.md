# Feature video backlog

Short narrated feature videos (about 2 to 3 minutes, 1080p, subtitled) for the Lastest YouTube channel
(@lastestcloud). Produced with the `demo-video` skill: Playwright screenshot frames, edge-tts voice-over,
SRT captions, published to YouTube. Sources for this list: `README.md` (Features), lastest.cloud/features,
app.lastest.cloud surfaces, and pharma.lastest.cloud (Lastest for Pharma).

Status legend: `todo` · `scripted` (narration + record script exist) · `recorded` · `published`.

Recording conventions (from the first video):

- Record against prod (`https://app.lastest.cloud`) on a data-rich repo; account footer (name/email) is blurred by the script.
- One idea per scene, 6 scenes, name the exact UI element on screen, end with "Thanks for watching".
- Keep the scratch dir (frames) until the video is confirmed; a re-render means a new YouTube upload.

## Core

| #   | Feature                                                                                                      | Surface                                        | Status    | Video                        |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------- | ---------------------------- |
| 1   | Verify Board: one board per build, 9 check layers per step, Focus mode diff slider, per-layer verdicts, History drawer, Review todos | `/verify/<repo>` (Board + Focus)               | published | https://youtu.be/lpHGr0qtB5M |
| 2   | Record a test: recorder entry screen, Analyze URL + selector priority, generated Playwright with locateWithFallback, Steps / Criteria / Versions / History (no live EB session shown) | `/record`, `/tests?test=<id>`                  | published | https://youtu.be/rM5z83Qdf38 |
| 3   | Check Modes: enforce / log / disable per layer per repo (visual, text, DOM, network, console, a11y, design, perf, URL, API, state) | Verify Focus mode → cogwheel "Configure check modes" dialog (not /settings) | published | https://youtu.be/dd2XWIlSOHw |
| 4   | Three diff engines (pixelmatch, SSIM, Butteraugli) + diff sensitivity + ignore regions / Draw Focus / Draw Ignore | Focus mode, `/settings#testing`                | published | https://youtu.be/yk__jDiDTow |
| 5   | Environments: PROD / UAT / prerelease as first-class objects, per-environment variables and baselines, promote baselines | `/settings#integrations` (Environments card)   | published | https://youtu.be/OqySUGrEzSk |
| 6   | Per-repo credential store (AES-256-GCM, injected at run time, never in codeHash)                             | `/setup` (Credentials)                         | published | https://youtu.be/GpUFa8qSRhA |
| 7   | Setup & teardown orchestration (Playwright / API / test-as-setup steps, per-test overrides)                  | `/setup`                                       | published | https://youtu.be/43QS51wVAmM |
| 8   | App Map + Explore: multi-EB swarm crawler, screens gallery, flow playback                                    | `/coverage` (App Map)                          | published | https://youtu.be/zdSJmUhzxTo |
| 9   | Coverage + route discovery + Analyze URL (selector strategy coverage)                                        | `/coverage` (Data / Gaps tabs)                 | published | https://youtu.be/-w82-KZu1WY |
| 10  | Run Results (Triage): failures clustered by root cause, run narrative, suggested verdicts                    | `/verify` (Board, Focus, Review), `/triage-agent` | published | https://youtu.be/siKWMkkeu_w |
| 11  | Interactive test playback: step-synced session video, network / perf / URL panes follow the scrubber         | Focus mode, `/tests/<id>`                      | todo      |                              |
| 12  | GitHub issues with full evidence, assign an AI engineer, auto-close when green                               | Verify (Show issue / Report all)               | todo      |                              |
| 13  | Public share links (`/r/<slug>`): watermarked report, AI demo notes, session video, social cards             | `/r/<slug>`, share dialog                      | todo      |                              |
| 14  | API tests as a first-class test type + burst/load runner                                                     | `/tests` (API test)                            | todo      |                              |
| 15  | Test versioning, composition (pin versions per build) and branch comparison                                  | `/tests/<id>` versions, Compose, Compare       | todo      |                              |
| 16  | Functional area hierarchy + test suites                                                                      | `/tests`                                       | todo      |                              |
| 17  | Scheduled runs (cron presets, auto-disable after failures)                                                   | `/settings`                                    | todo      |                              |
| 18  | WCAG 2.2 AA scoring with trend sparklines and per-test violations                                            | Dashboard, Focus mode A11y tab                 | todo      |                              |
| 19  | Guided onboarding (8-step setup guide) + testing templates                                                   | `/onboarding`, `/settings`                     | todo      |                              |
| 20  | Test migration between instances (export / import)                                                          | `/settings`                                    | todo      |                              |
| 21  | API tokens for MCP, VS Code extension and CI                                                                 | `/settings#account`                            | todo      |                              |
| 22  | Gamification: Beat the Bot, seasons, leaderboard                                                             | `/leaderboard`, `/settings`                    | todo      |                              |

## AI and agents

| #   | Feature                                                                                          | Surface                     | Status | Video |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------- | ------ | ----- |
| 23  | Play Agent: 11-step autonomous pipeline with pause / approve / skip                              | `/agents`, onboarding       | todo   |       |
| 24  | Agents Console: roster, blocked-on-human vs paused, escalation queue                              | `/agents`                   | todo   |       |
| 25  | QA Agent: eight-phase suite builder with coverage matrix and plan review                          | `/agents` (QA)              | todo   |       |
| 26  | Triage Agent: one build-scoped classifier, grouped by root cause                                  | `/results`                  | todo   |       |
| 27  | Healer Agent: heal → verify loop, attempt budgets, versioned `ai_fix` edits, Stop button          | `/healer-agent`             | todo   |       |
| 28  | Fix-the-App Advisor (`suggest_app_fix`) and AI diff analysis (`validate_diff` / `decide_diff`)   | Focus mode, MCP             | todo   |       |
| 29  | Spec-driven testing: OpenAPI / user stories / markdown → tests                                    | `/tests` (Import)           | todo   |       |
| 30  | Bring your own AI: Claude CLI, OpenRouter, Anthropic, OpenAI, Ollama; separate diff provider      | `/settings#ai`              | todo   |       |
| 31  | MCP server (29 tools) + remote MCP with OAuth 2.1 and tool-access policy                         | `npx @lastest/mcp-server`, `/api/mcp` | todo |     |
| 32  | WebMCP: page-registered site tools, consent dialog, public-share tools                            | any page, `/r/<slug>`       | published | https://youtu.be/DcLVj_-ORQ4 (WebMCP Challenge cut) |

## Stabilization

| #   | Feature                                                                                                              | Surface            | Status | Video |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------ | ------ | ----- |
| 33  | 12 flaky-test guards: text-region OCR diffing, timestamp freeze, random seeding, burst capture, auto-mask, network idle, DOM stability, font wait, spinner hiding, page-shift detection | `/settings#testing` | todo | |
| 34  | Third-party blocking and console error mode                                                                          | `/settings#testing` | todo   |       |

## Integrations and infrastructure

| #   | Feature                                                                                         | Surface                    | Status | Video |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------- | ------ | ----- |
| 35  | GitHub / GitLab: OAuth, PR / MR comments, webhook builds, reusable Action, `@lastest/runner` CLI | `/settings#integrations`   | todo   |       |
| 36  | SUT connectors: Veeva Vault and Salesforce profiling over the real REST API                      | `/setup` (Connectors)      | todo   |       |
| 37  | Google Sheets as a test data source                                                              | `/setup` (Data sources)    | todo   |       |
| 38  | Notifications: Slack, Discord, webhooks                                                          | `/settings#integrations`   | todo   |       |
| 39  | Embedded Browser pool: live CDP streaming during a build, system-managed vs BYO                  | Verify (live stream), `/settings` | todo |     |
| 40  | Smart Run (git-diff-scoped runs) and parallel execution                                          | Verify Run split-button    | todo   |       |
| 41  | Self-host in Docker in five minutes                                                              | terminal + `/onboarding`   | todo   |       |
| 42  | VS Code extension                                                                                | IDE                        | todo   |       |

## Pharma (pharma.lastest.cloud, Lastest for Pharma)

Source: pharma.lastest.cloud home + /pharma/features + the four Vault blog posts. Record against a repo in
Regulated mode (Settings → Features → Regulated mode) so the UI matches the pitch (no leaderboard, no agents,
no public shares).

| #   | Feature                                                                                                                 | Surface                                    | Status | Video |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ | ----- |
| P1  | Regulated profile: one toggle sets GxP defaults (text + DOM layers enforce, gamification off, public shares refused, identity on every action) | `/settings` (Regulated mode), `/onboarding` pharma segment | todo | |
| P2  | Veeva Vault suites: Vault CRM first (auth bridge, object pages, call reporting, samples, consent), then PromoMats, Clinical, RIM | repo `lastest-veeva-starter`, `/tests`  | todo   |       |
| P3  | Scenario data, one column per country: the same flow replays per market from a spreadsheet you own                     | `/setup` (Data sources, Google Sheets)     | todo   |       |
| P4  | Coverage matrix flow × layer × market computed from run artifacts, gaps visible before general release                  | `/coverage`                                | todo   |       |
| P5  | Health score 0–100 per repository (pass 60% / non-flaky 20% / route coverage 20%)                                       | Dashboard                                  | todo   |       |
| P6  | Deterministic replay, nine layers deep: per-layer approve / reject / snooze on every step                               | Verify Focus mode                          | todo   |       |
| P7  | Evidence-grade issues: baseline + actual + diff + step context filed on a confirmed regression, auto-closed when green  | Verify (Show issue)                        | todo   |       |
| P8  | Interactive playback as audit evidence: session video on a step-synced clock                                            | Focus mode playback                        | todo   |       |
| P9  | Every change carries a reason: test version history, reconstruct the exact suite behind a piece of evidence            | `/tests/<id>` versions, Compose            | todo   |       |
| P10 | Environments for prerelease Vault: run one suite against UAT and PROD, promote baselines, survive a sandbox refresh      | `/setup` (Environments)                    | todo   |       |
| P11 | Vault connector: profile the live Vault configuration over its REST API to ground test generation                       | `/setup` (Connectors → Veeva Vault)        | todo   |       |
| P12 | Bring your own model inside the network + air-gapped self-host (data never leaves the tenant)                          | `/settings#ai`, Docker install             | todo   |       |
| P13 | Ownership: suites, spreadsheet, baselines and reports as files in your repo; run without Lastest installed              | repo export, `/settings`                   | todo   |       |

## Published

| #   | Title                                   | URL                          | Recorded against                                  | Assets                              |
| --- | --------------------------------------- | ---------------------------- | ------------------------------------------------- | ----------------------------------- |
| 32  | Lastest WebMCP: site tools for browser agents | https://youtu.be/DcLVj_-ORQ4 | prod share + app (WebMCP judge account)         | WebMCP Challenge scratch dir        |
| 1   | Lastest Verify Board                    | https://youtu.be/lpHGr0qtB5M | prod, repo las-team/lastest build #2c4b78d0       | scratch dir `verify-board/`         |
| 3   | Lastest Check Modes                     | https://youtu.be/dd2XWIlSOHw | prod, excalidraw build #c23fde32 + las-team/lastest | scratch dir `v03-check-modes/`      |
| 4   | Lastest Diff Engines                    | https://youtu.be/yk__jDiDTow | prod, las-team/lastest Focus mode + Settings/Testing | scratch dir `v04-diff-engines/`     |
| 2   | Lastest Record a Test                   | https://youtu.be/rM5z83Qdf38 | prod, las-team/lastest /record + test Recording Meta | scratch dir `v02-record-test/`      |
| 5   | Lastest Environments                    | https://youtu.be/OqySUGrEzSk | prod, excalidraw Settings/Integrations Environments card (UAT demo env created + deleted) | scratch dir `v05-environments/`     |
| 6   | Lastest Credential Store                | https://youtu.be/GpUFa8qSRhA | prod, excalidraw /setup Credentials + test Vars tab (demo-login created + deleted) | scratch dir `v06-credentials/`      |
| 7   | Lastest Setup and Teardown              | https://youtu.be/43QS51wVAmM | prod, las-team/lastest /setup Seed + Teardown + test Overrides tab (read-only) | scratch dir `v07-setup-teardown/`   |
| 8   | Lastest App Map and Explore             | https://youtu.be/zdSJmUhzxTo | prod, las-team/lastest /coverage Map (zoomed to the covered cluster), Screens, Flows, Explore app dialog (cancelled) | scratch dir `v08-app-map/`          |
| 9   | Lastest Data Coverage                   | https://youtu.be/-w82-KZu1WY | LOCAL dev (localhost:3000), throwaway team "Demo Video's Team", repo veeva-crm-demo with a synthetic Veeva CRM calls CSV (500 rows, 4 dimensions enabled); prod has no data-coverage model | scratch dir `v09-coverage/`         |
| 10  | Lastest Run Results and Triage          | https://youtu.be/siKWMkkeu_w | prod, las-team/lastest build #527a0101 Board + Focus + Review drawer + /triage-agent + /agents (no triage run exists on prod: in-product AI is off) | scratch dir `v10-run-results/`      |

## Shorts (vertical 1080x1920 cuts, under 60 s)

Built by `build-short.py` (session scratch dir 76a5f298, `shorts/`): first ~55 s of the full video cropped to the
content area, title card above, burned captions below, 2.5 s end card. Source mp4s: `.playwright-mcp/videos/`
(5-10) and yt-dlp downloads of 1-4 + 32. Uploads stopped at 3 on 2026-09-03: the channel hit YouTube's daily
upload limit for unverified channels (phone verification lifts it, or wait 24 h). Remaining 8 are rendered in
`.playwright-mcp/videos/shorts/`.

| #   | Short                          | Status    | URL                                        |
| --- | ------------------------------ | --------- | ------------------------------------------ |
| 1   | Verify Board                   | published | https://youtube.com/shorts/NRgxrIiAgBA     |
| 2   | Record a Test                  | published | https://youtube.com/shorts/LS4IR6rmxQ0     |
| 3   | Check Modes                    | published | https://youtube.com/shorts/nyymrEzS2_I     |
| 4   | Diff Engines                   | rendered  | v04-diff-engines.short.mp4                 |
| 5   | Environments                   | rendered  | v05-environments.short.mp4                 |
| 6   | Credential Store               | rendered  | v06-credentials.short.mp4                  |
| 7   | Setup and Teardown             | rendered  | v07-setup-teardown.short.mp4               |
| 8   | App Map and Explore            | rendered  | v08-app-map.short.mp4                      |
| 9   | Data Coverage                  | rendered  | v09-coverage.short.mp4                     |
| 10  | Run Results and Triage         | rendered  | v10-run-results.short.mp4                  |
| 32  | WebMCP Site Tools              | rendered  | v32-webmcp.short.mp4                       |
