# Feature Specs — Branch `claude/collect-unmerged-branches-RNo5r`

This directory contains detailed specifications for every feature added, modified, or removed in this branch compared to `master`. These specs serve as re-implementation guides if any feature needs to be re-developed.

## Features Added

| # | Spec | Summary |
|---|------|---------|
| 01 | [Multi-Engine Diffing](./01-multi-engine-diffing.md) | Pluggable diff engines: pixelmatch, SSIM, Butteraugli |
| 02 | [Text-Region-Aware Diffing](./02-text-region-aware-diffing.md) | OCR-based two-pass diffing with separate text/non-text thresholds |
| 03 | [Cross-OS Stabilization](./03-cross-os-stabilization.md) | Freeze timestamps, seed random, normalize fonts, hide spinners |
| 04 | [Debug Runner](./04-debug-runner.md) | Step-by-step interactive test execution for debugging |
| 05 | [Code Transformer](./05-code-transformer.md) | Playwright codegen → runner format transformation |
| 06 | [Page Shift Detection](./06-page-shift-detection.md) | LCS row-alignment for content shift detection |
| 07 | [Selector Recommendations](./07-selector-recommendations.md) | Data-driven disable/enable/reorder recommendations |
| 08 | [Review Todos](./08-review-todos.md) | Per-diff review task tracking |
| 09 | [Build Composition](./09-build-composition.md) | Per-branch test selection and version overrides |
| 10 | [Auth System](./10-auth-system.md) | Custom auth: Argon2id, OAuth, password reset, sessions |
| 11 | [SSRF Protection](./11-ssrf-protection.md) | URL validation blocking private networks and metadata |
| 12 | [Early Adopter Mode](./12-early-adopter-mode.md) | Feature flag gating experimental features |
| 13 | [Async Background Jobs](./13-async-background-jobs.md) | Fire-and-forget pattern with parallel AI execution |
| 14 | [AI Prompts](./14-ai-prompts.md) | Simplified prompts, code diff scanning, MCP fix |
| 20 | [Diff Benchmark Framework](./20-diff-benchmark-framework.md) | 13-scenario benchmark harness for engine comparison |
| 21 | [Gamification](./21-gamification.md) | Beat the Bot scoring, leaderboard, achievements, Bug Blitz |
| 22 | [Test Migration](./22-test-migration.md) | Cross-instance test export/import via REST API |
| 23 | [API Tokens](./23-api-tokens.md) | Long-lived Bearer tokens for MCP, VS Code, CI |

## Features Modified

| # | Spec | Summary |
|---|------|---------|
| 15 | [Runner Simplification](./15-runner-simplification.md) | Concurrent → sequential execution, in-memory queues |
| 17 | [Runner Exported Functions](./17-runner-exported-functions.md) | createAppState, createExpect, stripTypeAnnotations |
| 18 | [Docker & CI/CD](./18-docker-ci-changes.md) | Alpine image, simplified volumes, local CI mode |
| 19 | [Setup Orchestration](./19-setup-orchestration-changes.md) | Extended helpers, teardown removal, explicit failures |

## Features Removed

| # | Spec | Summary |
|---|------|---------|
| 16 | [Schema Removals](./16-schema-removals.md) | Teardowns, soft deletes, video, bug reports, dual comparison |

## Branch Origin

This branch merges 7 feature branches:
1. `claude/async-background-optimization` — Background job processing
2. `claude/test-accessibility-functions` — Accessibility audit integration
3. `claude/text-region-aware-diffing` — OCR-based text diffing
4. `claude/early-adopter-mode-setting` — Feature flag system
5. `claude/test-traffic-upload-functions` — File upload/download helpers
6. `claude/security-review-admin` — Security hardening (SSRF, auth)
7. Plus: diff engine benchmarks, selector recommendations, code transformer

## Test Coverage

367 unit tests across 14 test files. See [CLAUDE.md](../../CLAUDE.md) for the full test file listing.
