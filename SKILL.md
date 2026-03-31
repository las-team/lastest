# Lastest2 — Visual Regression Testing Agent

## Discovery (100 tokens)

Lastest2 is a visual regression testing platform. It records browser tests, runs them via Playwright, diffs screenshots, and uses AI to classify changes. Available as an MCP server for AI agent integration.

## Activation (1000 tokens)

### Install

```bash
npx @lastest/mcp-server --url http://localhost:3000 --api-key YOUR_KEY
```

### Core Tools

- `lastest2_run_tests` — trigger test build, returns build ID
- `lastest2_get_build_status` — poll for results (status, pass/fail, diffs)
- `lastest2_list_failing_tests` — failing tests with errors
- `lastest2_get_visual_diff` — diff details with AI classification
- `lastest2_approve_baseline` / `lastest2_reject_baseline` — act on diffs
- `lastest2_create_test` — AI generates test from URL or prompt
- `lastest2_heal_test` — AI auto-fixes failing test
- `lastest2_get_coverage` — coverage by area and route

### Workflow

1. Run tests → 2. Check status → 3. Review diffs → 4. Approve/reject → 5. Heal failures

### Key Concepts

- **Build**: A test execution run. Status: `safe_to_merge`, `review_required`, `blocked`, `has_todos`
- **Visual Diff**: Screenshot comparison. AI classifies as insignificant/noise/meaningful
- **Baseline**: Approved reference screenshot. Approving a diff updates the baseline
- **Functional Area**: Hierarchical test organization (e.g., "Checkout > Payment")
- **Self-healing**: Tests auto-try multiple selectors at runtime; AI healer fixes code post-failure

## Details

### Features

- 3 diff engines (Pixelmatch, SSIM, Butteraugli)
- 6 AI providers (Claude, OpenRouter, Ollama, OpenAI, Agent SDK, Anthropic Direct)
- 12 stabilization features (timestamp freeze, random seeding, auto-masking)
- Remote runners via WebSocket for distributed execution
- Smart Run: git-diff-based test selection
- Play Agent: fully autonomous 9-step test generation pipeline
- GitHub/GitLab integration with PR comments
- Setup/teardown orchestration
- Accessibility audits (axe-core)

### Self-Hosted

Lastest2 runs on your infrastructure. PostgreSQL database, Docker Compose included.
