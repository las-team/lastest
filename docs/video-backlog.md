# Feature video backlog

Short narrated feature videos (about 2 to 3 minutes, 1080p, subtitled) for the Lastest YouTube channel
(@lastestcloud). Produced with the `demo-video` skill: Playwright screenshot frames, edge-tts voice-over,
SRT captions, published to YouTube. Sources for this list: `README.md` (Features), lastest.cloud/features,
app.lastest.cloud surfaces, and pharma.lastest.cloud (Lastest for Pharma).

Status legend: `todo` · `scripted` (narration + record script exist) · `recorded` · `scheduled` (uploaded, YouTube
Scheduled visibility, goes public at the noted date, 15:00 Europe/Budapest, one per day) · `published`.

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
| 11 | Interactive test playback: step-synced session video, network / perf / URL panes follow the scrubber | Focus mode, `/tests/<id>` | scheduled | https://youtu.be/K70UAlyBBzw (public 2026-09-05 15:00) |
| 12 | GitHub issues with full evidence, assign an AI engineer, auto-close when green | Verify (Show issue / Report all) | scheduled | https://youtu.be/c5Xk0CeebWA (public 2026-09-06 15:00) |
| 13 | Public share links (`/r/<slug>`): watermarked report, AI demo notes, session video, social cards | `/r/<slug>`, share dialog | scheduled | https://youtu.be/1MNPQVhHKAs (public 2026-09-07 15:00) |
| 14 | API tests as a first-class test type + burst/load runner | `/tests` (API test) | scheduled | https://youtu.be/WB5E3IgCY7o (public 2026-09-08 15:00) |
| 15 | Test versioning, composition (pin versions per build) and branch comparison | `/tests/<id>` versions, Compose, Compare | scheduled | https://youtu.be/pfWP64DRwJQ (public 2026-09-09 15:00) |
| 16 | Functional area hierarchy + test suites | `/tests` | scheduled | https://youtu.be/xVhwEVyI_ac (public 2026-09-10 15:00) |
| 17 | Scheduled runs (cron presets, auto-disable after failures) | `/settings` | scheduled | https://youtu.be/BO4baLLF-wQ (public 2026-09-11 15:00) |
| 18 | WCAG 2.2 AA scoring with trend sparklines and per-test violations | Dashboard, Focus mode A11y tab | scheduled | https://youtu.be/UA5qJ7oINh0 (public 2026-09-12 15:00) |
| 19 | Guided onboarding (8-step setup guide) + testing templates | `/onboarding`, `/settings` | scheduled | https://youtu.be/qQMZ2BLdQ1U (public 2026-09-13 15:00) |
| 20 | Test migration between instances (export / import) | `/settings` | scheduled | https://youtu.be/u-Fo85hLY4A (public 2026-09-14 15:00) |
| 21 | API tokens for MCP, VS Code extension and CI | `/settings#account` | scheduled | https://youtu.be/wmM_UG_1KZI (public 2026-09-15 15:00) |
| 22 | Gamification: Beat the Bot, seasons, leaderboard | `/leaderboard`, `/settings` | scheduled | https://youtu.be/cj08HO8cO2c (public 2026-09-16 15:00) |

## AI and agents

| #   | Feature                                                                                          | Surface                     | Status | Video |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------- | ------ | ----- |
| 23 | Play Agent: 11-step autonomous pipeline with pause / approve / skip | `/agents`, onboarding | scheduled | https://youtu.be/W4Hyk8GqZwU (public 2026-09-17 15:00) |
| 24 | Agents Console: roster, blocked-on-human vs paused, escalation queue | `/agents` | scheduled | https://youtu.be/Us7EAQw9MNE (public 2026-09-18 15:00) |
| 25 | QA Agent: eight-phase suite builder with coverage matrix and plan review | `/agents` (QA) | scheduled | https://youtu.be/fq5XOzYQuWU (public 2026-09-19 15:00) |
| 26 | Triage Agent: one build-scoped classifier, grouped by root cause | `/results` | scheduled | https://youtu.be/RznTL4_s3ts (public 2026-09-20 15:00) |
| 27 | Healer Agent: heal → verify loop, attempt budgets, versioned `ai_fix` edits, Stop button | `/healer-agent` | scheduled | https://youtu.be/MWF546fg7RY (public 2026-09-21 15:00) |
| 28 | Fix-the-App Advisor (`suggest_app_fix`) and AI diff analysis (`validate_diff` / `decide_diff`) | Focus mode, MCP | scheduled | https://youtu.be/FsO-1Vm2iDg (public 2026-09-22 15:00) |
| 29 | Spec-driven testing: OpenAPI / user stories / markdown → tests | `/tests` (Import) | scheduled | https://youtu.be/c7TaQWc3yGE (public 2026-09-23 15:00) |
| 30 | Bring your own AI: Claude CLI, OpenRouter, Anthropic, OpenAI, Ollama; separate diff provider | `/settings#ai` | scheduled | https://youtu.be/9969XjOWwTg (public 2026-09-24 15:00) |
| 31 | MCP server (29 tools) + remote MCP with OAuth 2.1 and tool-access policy | `npx @lastest/mcp-server`, `/api/mcp` | scheduled | https://youtu.be/1RHDyZTPfJo (public 2026-09-25 15:00) |
| 32  | WebMCP: page-registered site tools, consent dialog, public-share tools                            | any page, `/r/<slug>`       | published | https://youtu.be/DcLVj_-ORQ4 (WebMCP Challenge cut) |

## Stabilization

| #   | Feature                                                                                                              | Surface            | Status | Video |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------ | ------ | ----- |
| 33 | 12 flaky-test guards: text-region OCR diffing, timestamp freeze, random seeding, burst capture, auto-mask, network idle, DOM stability, font wait, spinner hiding, page-shift detection | `/settings#testing` | scheduled | https://youtu.be/Qb4n4b_tI-s (public 2026-09-26 15:00) |
| 34 | Third-party blocking and console error mode | `/settings#testing` | scheduled | https://youtu.be/YDm5x9Ixuhs (public 2026-09-27 15:00) |

## Integrations and infrastructure

| #   | Feature                                                                                         | Surface                    | Status | Video |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------- | ------ | ----- |
| 35 | GitHub / GitLab: OAuth, PR / MR comments, webhook builds, reusable Action, `@lastest/runner` CLI | `/settings#integrations` | scheduled | https://youtu.be/B9qFanT4qlw (public 2026-09-28 15:00) |
| 36 | SUT connectors: Veeva Vault and Salesforce profiling over the real REST API | `/setup` (Connectors) | scheduled | https://youtu.be/YhoARTK3zSs (public 2026-09-29 15:00) |
| 37 | Google Sheets as a test data source | `/setup` (Data sources) | scheduled | https://youtu.be/SYqvzPo7LkU (public 2026-09-30 15:00) |
| 38 | Notifications: Slack, Discord, webhooks | `/settings#integrations` | scheduled | https://youtu.be/PqBxbjqO8vQ (public 2026-10-01 15:00) |
| 39 | Embedded Browser pool: live CDP streaming during a build, system-managed vs BYO | Verify (live stream), `/settings` | scheduled | https://youtu.be/Em2xXJ-DWu4 (public 2026-10-02 15:00) |
| 40 | Smart Run (git-diff-scoped runs) and parallel execution | Verify Run split-button | scheduled | https://youtu.be/rzwe5Ld5hFw (public 2026-10-03 15:00) |
| 41 | Self-host in Docker in five minutes | terminal + `/onboarding` | recorded | mp4 in .playwright-mcp/videos/ (upload blocked by YouTube daily limit on 2026-09-05) |
| 42 | VS Code extension | IDE | recorded | mp4 in .playwright-mcp/videos/ (upload blocked by YouTube daily limit on 2026-09-05) |

## Pharma (pharma.lastest.cloud, Lastest for Pharma)

Source: pharma.lastest.cloud home + /pharma/features + the four Vault blog posts. Record against a repo in
Regulated mode (Settings → Features → Regulated mode) so the UI matches the pitch (no leaderboard, no agents,
no public shares).

| #   | Feature                                                                                                                 | Surface                                    | Status | Video |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ | ----- |
| P1 | Regulated profile: one toggle sets GxP defaults (text + DOM layers enforce, gamification off, public shares refused, identity on every action) | `/settings` (Regulated mode), `/onboarding` pharma segment | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P2 | Veeva Vault suites: Vault CRM first (auth bridge, object pages, call reporting, samples, consent), then PromoMats, Clinical, RIM | repo `lastest-veeva-starter`, `/tests` | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P3 | Scenario data, one column per country: the same flow replays per market from a spreadsheet you own | `/setup` (Data sources, Google Sheets) | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P4 | Coverage matrix flow × layer × market computed from run artifacts, gaps visible before general release | `/coverage` | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P5 | Health score 0–100 per repository (pass 60% / non-flaky 20% / route coverage 20%) | Dashboard | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P6 | Deterministic replay, nine layers deep: per-layer approve / reject / snooze on every step | Verify Focus mode | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P7 | Evidence-grade issues: baseline + actual + diff + step context filed on a confirmed regression, auto-closed when green | Verify (Show issue) | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P8 | Interactive playback as audit evidence: session video on a step-synced clock | Focus mode playback | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P9 | Every change carries a reason: test version history, reconstruct the exact suite behind a piece of evidence | `/tests/<id>` versions, Compose | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P10 | Environments for prerelease Vault: run one suite against UAT and PROD, promote baselines, survive a sandbox refresh | `/setup` (Environments) | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P11 | Vault connector: profile the live Vault configuration over its REST API to ground test generation | `/setup` (Connectors → Veeva Vault) | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P12 | Bring your own model inside the network + air-gapped self-host (data never leaves the tenant) | `/settings#ai`, Docker install | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |
| P13 | Ownership: suites, spreadsheet, baselines and reports as files in your repo; run without Lastest installed | repo export, `/settings` | recorded | mp4 in .playwright-mcp/videos/ (upload pending, YouTube daily limit) |

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
(5-10) and yt-dlp downloads of 1-4 + 32. Uploads stopped at 3 on 2026-09-03 (YouTube daily upload limit for unverified channels); the remaining 8 were
uploaded on 2026-09-04 once the limit reset.

| #   | Short                          | Status    | URL                                        |
| --- | ------------------------------ | --------- | ------------------------------------------ |
| 1   | Verify Board                   | published | https://youtube.com/shorts/NRgxrIiAgBA     |
| 2   | Record a Test                  | published | https://youtube.com/shorts/LS4IR6rmxQ0     |
| 3   | Check Modes                    | published | https://youtube.com/shorts/nyymrEzS2_I     |
| 4   | Diff Engines                   | published | https://youtube.com/shorts/QSfgB89BGu8     |
| 5   | Environments                   | published | https://youtube.com/shorts/rwPz_lSKwQM     |
| 6   | Credential Store               | published | https://youtube.com/shorts/zkXums2Tefk     |
| 7   | Setup and Teardown             | published | https://youtube.com/shorts/s5bteLZx748     |
| 8   | App Map and Explore            | published | https://youtube.com/shorts/prRMTJP1dWg     |
| 9   | Data Coverage                  | published | https://youtube.com/shorts/lEeHjUokEAQ     |
| 10  | Run Results and Triage         | published | https://youtube.com/shorts/WzszUM0RfCI     |
| 32  | WebMCP Site Tools              | published | https://youtube.com/shorts/eKlisuWuxGE     |
