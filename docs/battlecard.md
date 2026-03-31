# Lastest2 - Internal Battlecard for Vibe-Coding Solo Founders

## Product Summary

**One-liner:** Free, open-source visual regression testing with AI-powered test generation—built for solo founders who ship fast.

---

## Key Features for Solo Founders

| Feature | Why It Matters |
|---------|----------------|
| **Record & Playback** | Click through your app, get Playwright tests automatically—no code writing |
| **AI Test Generation** | Describe what to test in plain English, AI writes the test (Claude/GPT-4/Gemini) |
| **AI Auto-Fix** | Broken test? AI repairs it with one click |
| **Visual Diff Approval** | Slider comparison, batch approve, no pixel-counting |
| **Smart Baseline Carry-Forward** | Same screenshot = auto-approved across runs |
| **GitHub Integration** | OAuth login, PR linking, branch-aware baselines |
| **Route Discovery** | Scans your Next.js/React app, suggests test coverage gaps |
| **PostgreSQL** | No cloud bills, no infra—runs on your machine |
| **Multi-Selector Fallback** | Tests survive minor UI changes (data-testid → id → text → OCR) |
| **MCP-Enhanced AI** | AI explores your live app before writing tests |

---

## Competitive Landscape

| Tool | Free Tier | Pricing | Best For | Weakness |
|------|-----------|---------|----------|----------|
| **Percy** | 5,000 screenshots/mo | $150+/mo team | CI/CD pipelines | Screenshot limits, no AI generation |
| **Chromatic** | 5,000 snapshots/mo | Per-snapshot | Storybook users | Storybook-only focus |
| **Applitools** | 100 checkpoints/mo | Enterprise $$$ | Large teams | Overkill complexity, cost |
| **BackstopJS** | Unlimited (OSS) | Free | Config-savvy devs | No AI, no recording, manual config |
| **Visual Regression Tracker** | Unlimited (self-hosted) | Free | Privacy-focused | Limited AI, basic UI |
| **Lastest2** | **Unlimited (OSS)** | **Free** | **Solo founders** | **New project** |
| **Cypress** | N/A (needs plugin) | Free runner + $199/mo Percy | E2E testing | No visual testing native, needs Percy for screenshots |

---

## Unique Advantages for AI-First Workflows

### 1. Build with AI, Run Traditionally
- **Pay once for generation, run free forever** — AI generates test code, then tests run as standard Playwright (no AI tokens on every run)
- **Massive token savings** vs. tools requiring AI on every execution
- Tests become deterministic code artifacts you own

### 2. Solve AI Hallucination Problem
- **Recording captures real selectors** — AI doesn't guess element paths, recorder extracts actual DOM structure
- **Multi-selector fallback** — even if one selector breaks, test uses backup (data-testid → id → role → aria-label → text → css → OCR)
- **MCP exploration** — AI can inspect live page before writing code, not hallucinate from imagination

### 3. Visual Diff Catches What AI Misses
- **Screenshot comparison = ground truth** — AI might not assert every UI element, but pixel diff catches ALL visual changes
- **No blind spots** — even if AI test ignores a button, visual diff reveals if it moved/changed
- **Safety net for AI-generated tests** — tests pass functionally but visual diff catches regressions

### 4. Organize Tests, Don't Drown in Chaos
- **Functional Areas** — group tests by feature (Auth, Checkout, Dashboard)
- **Route-based coverage tracking** — see which pages have tests, which don't
- **Version history per test** — track changes, revert when needed

---

## Why We Win vs. Competitors

### vs. Percy/Chromatic/Applitools (Paid SaaS)
- **$0 forever** vs. $150-500+/month
- **No screenshot limits** vs. metered pricing
- **Self-hosted** = your data stays local
- **AI test generation** built-in (they just diff images)

### vs. Cypress
- **Visual testing built-in** — Cypress has no native visual diff, needs Percy plugin ($199/mo)
- **AI test generation** — Cypress is write-it-yourself
- **All-in-one** — no plugin soup, single coherent experience

### vs. BackstopJS (Free OSS)
- **Record mode** = click to create tests vs. write JSON configs
- **AI-powered** = generate, fix, enhance tests with natural language
- **Modern UI** = visual dashboard vs. CLI-only
- **GitHub-native** = OAuth, PRs, branches out of the box

---

## Target Persona

**Vibe-coding solo founders who:**
- Ship MVPs in days/weeks, not months
- Use AI coding tools (Cursor, Claude, Copilot)
- Can't justify $150+/mo for visual testing
- Want tests without writing test code
- Need to catch UI regressions before customers do

---

## Messaging Framework

### Pain Points We Solve
1. "I broke the checkout page and didn't notice for 3 days"
2. "Visual testing tools cost more than my hosting"
3. "Writing Playwright tests takes longer than building features"
4. "BackstopJS config files are a nightmare"
5. "AI-generated tests hallucinate selectors that don't exist"
6. "AI tests pass but miss visual regressions in parts of the screen"
7. "Running AI on every test execution burns through tokens"

### Key Messages
- **"Record it. Test it. Ship it."** — Visual testing without the code
- **"AI writes your tests, AI fixes your tests"** — Focus on building, not maintaining
- **"Free forever, open source"** — No screenshot bills, no vendor lock-in
- **"Built for builders who move fast"** — Vibe-coders need vibe-testing

---

## Feature Comparison Chart

| Capability | Lastest2 | Percy | Chromatic | Cypress | BackstopJS |
|------------|----------|-------|-----------|---------|------------|
| Record & playback | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI test generation | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI auto-fix broken tests | ✅ | ❌ | ❌ | ❌ | ❌ |
| Visual diff UI | ✅ | ✅ | ✅ | ❌ (needs Percy) | ✅ |
| GitHub integration | ✅ | ✅ | ✅ | ✅ | ❌ |
| Free unlimited screenshots | ✅ | ❌ | ❌ | ❌ | ✅ |
| Self-hosted option | ✅ | ❌ | ❌ | ✅ | ✅ |
| Route auto-discovery | ✅ | ❌ | ❌ | ❌ | ❌ |
| Test organization (areas) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Build w/ AI, run traditional | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Objection Handling

| Objection | Response |
|-----------|----------|
| "Percy has BrowserStack integration" | We integrate with Playwright which supports all browsers natively |
| "Chromatic works with my Storybook" | We test full pages and flows, not just isolated components |
| "Applitools has AI diffing" | We have AI *generation*—tests write themselves |
| "BackstopJS is free too" | BackstopJS requires manual config; we have point-and-click recording + AI |
| "It's a new project" | Open source = you can contribute, and we're building for your exact use case |
| "Cypress is free" | Cypress has no visual testing—needs Percy ($199/mo) for screenshots |
| "AI tests hallucinate selectors" | Recording captures real DOM; multi-selector fallback; MCP explores live page |
| "AI ignores parts of the screen" | Visual diff catches everything—pixel comparison is the safety net |

---

## Quick Stats

- **Setup time:** < 5 min (clone, pnpm install, pnpm dev)
- **First test:** < 2 min with recorder
- **Cost:** $0 (bring your own AI API key or use Claude CLI)
- **Stack:** Next.js 16, Playwright, PostgreSQL, TypeScript

---

## Sources

- [Percy vs Chromatic comparison](https://medium.com/@crissyjoshua/percy-vs-chromatic-which-visual-regression-testing-tool-to-use-6cdce77238dc)
- [Applitools vs Chromatic](https://applitools.com/compare/chromatic/)
- [Top 15 Open Source Visual Regression Tools](https://www.browserstack.com/guide/visual-regression-testing-open-source)
- [Visual Testing Tools Overview](https://testguild.com/visual-validation-tools/)
- [Chromatic vs competitors FAQ](https://www.chromatic.com/docs/faq/chromatic-vs-applitools-percy/)
- [Cypress Visual Testing Docs](https://docs.cypress.io/app/tooling/visual-testing)
- [Percy + Cypress Integration](https://www.browserstack.com/docs/percy/cypress/getting-started/integrate-your-tests)
