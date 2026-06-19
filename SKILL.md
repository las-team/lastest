# Lastest — Visual Regression Testing Agent

## Discovery (100 tokens)

Lastest is a visual regression testing platform. It records browser tests, runs them via Playwright, diffs screenshots, and uses AI to classify changes. Available as an MCP server for AI agent integration.

## Activation (1000 tokens)

### Install

```bash
npx @lastest/mcp-server --url http://localhost:3000 --api-key YOUR_KEY
```

### Core Tools

- `lastest_run_tests` — trigger test build, returns build ID
- `lastest_build` `action:"get"` — poll for results (status, pass/fail, diffs); `action:"review"` for diffs + failures + action items
- `lastest_test` `action:"list"` `filter:"failing"` — failing tests with errors
- `lastest_get_diffs` `scope:"build"` — diff details with AI classification
- `lastest_decide_diff` `action:"approve"|"reject"` — act on diffs/baselines
- `lastest_create_test` — create a test (browser direct/AI, or `testType:"api"` for backend tests)
- `lastest_heal_test` — AI auto-fixes a failing test; `lastest_suggest_app_fix` — advisory app-code fix
- `lastest_validate_diff` — diff-scoped one-shot verdict for a coding-agent loop
- `lastest_insights` `action:"coverage"` — coverage by area and route

### Workflow

1. `lastest_run_tests` → 2. `lastest_build action:"get"` → 3. `lastest_get_diffs scope:"build"` → 4. `lastest_decide_diff` → 5. `lastest_heal_test`

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

Lastest runs on your infrastructure. PostgreSQL database, Docker Compose included.
