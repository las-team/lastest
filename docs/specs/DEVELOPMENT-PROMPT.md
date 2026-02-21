# Development Prompt: New Features To Implement

This document lists all new features to be developed on a clean branch. Each feature is independent and can be implemented in any order. The existing codebase uses **better-auth** for authentication (do NOT replace it), **Playwright** for browser automation, **pixelmatch** + **pngjs** for image diffing, **Drizzle ORM** with **SQLite**, and **Next.js App Router**.

Refer to the individual spec files in `docs/specs/` for full implementation details.

---

## 1. Multi-Engine Visual Diffing
**Spec**: [01-multi-engine-diffing.md](./01-multi-engine-diffing.md)

Add pluggable diff engine support beyond the existing pixelmatch. Implement three engines:

- **pixelmatch** (existing) — pixel-perfect comparison, fastest
- **SSIM** — structural similarity index, better perceptual matching
- **Butteraugli** — human-perception-aligned via CIELAB color space, most advanced

**What to build:**
- `src/lib/diff/engines.ts` — Engine interface + implementations for all three
- Add `diffEngine` field to `diffSensitivitySettings` schema (`"pixelmatch" | "ssim" | "butteraugli"`, default `"pixelmatch"`)
- Update `src/lib/diff/generator.ts` to dispatch to selected engine
- UI dropdown in diff sensitivity settings to choose engine
- Unit tests for each engine

---

## 2. Text-Region-Aware Diffing
**Spec**: [02-text-region-aware-diffing.md](./02-text-region-aware-diffing.md)

OCR-based two-pass diffing that detects text regions and applies separate thresholds, reducing false positives from font rendering and dynamic text.

**What to build:**
- `src/lib/diff/text-regions.ts` — Tesseract.js OCR detection, rectangle operations, mask generation
- Two-pass diff: first pass masks text regions with higher tolerance, second pass diffs non-text normally
- Schema additions to `diffSensitivitySettings`: `textRegionAwareDiffing` (boolean), `textRegionThreshold`, `textRegionPadding`, `textDetectionGranularity` (`"word" | "line" | "block"`)
- `DiffMetadata` additions: `textRegions` array, `textRegionDiffPixels`, `nonTextRegionDiffPixels`
- Settings UI toggle + threshold controls
- Unit tests

---

## 3. SSRF Protection
**Spec**: [11-ssrf-protection.md](./11-ssrf-protection.md)

Prevent server-side request forgery in user-provided URLs.

**What to build:**
- `src/lib/security/url-validation.ts` — `validateUrl(url: string): { valid: boolean, reason?: string }`
- Block: RFC1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.x), link-local (169.254.x), IPv6 private (::1, fc00::/7, fe80::/10), cloud metadata (169.254.169.254), non-HTTP protocols
- Apply to all user-provided URLs in server actions (target URLs, webhook URLs, etc.)
- Unit tests covering all blocked ranges

---

## 4. Async Background Jobs
**Spec**: [13-async-background-jobs.md](./13-async-background-jobs.md)

Fire-and-forget pattern for long-running operations with parallel AI execution.

**What to build:**
- `src/lib/ai/parallel.ts` — `runParallel<T>(items, fn, { concurrency, onProgress })` with semaphore-based concurrency (default 5)
- Convert these operations to async fire-and-forget:
  1. Route scanning
  2. Spec analysis
  3. AI test generation
  4. AI test fixing
  5. AI test enhancement
  6. AI validation
  7. Code diff scanning
  8. Build execution
- Pattern: validate inputs → create `backgroundJobs` row → return jobId → launch async
- Add `metadata` JSON field to `backgroundJobs` if not present
- Add job types: `ai_fix`, `ai_validate` to `BackgroundJobType`

---

## 5. AI Prompt Improvements
**Spec**: [14-ai-prompts.md](./14-ai-prompts.md)

New AI prompt functions and simplification of existing ones.

**What to build:**
- `createCodeDiffScanPrompt(diff, tests)` — analyzes git diffs to identify which visual tests may be affected
- `createMcpFixPrompt(test, error, selectors)` — MCP-based selector discovery for fixing failing tests
- `src/lib/ai/diff-analyzer.ts` — AI-powered visual diff classification with JSON extraction from LLM responses
- Simplify existing prompts (30-40% more concise — remove repetitive matcher lists, selector rules, import examples)

---

## 6. Diff Engine Benchmark Framework
**Spec**: [20-diff-benchmark-framework.md](./20-diff-benchmark-framework.md)

Data-driven benchmark for comparing diff engine performance.

**What to build:**
- `src/lib/diff/benchmark-comparison.ts` — Image generation helpers + benchmark scenarios
- 13 synthetic test scenarios: identical images, controlled jitter (15/30/50px), AA fringe, 1px layout shifts, text-heavy UIs, mixed content, edge cases
- Success criteria: ≥50% text jitter reduction, ≥95% non-text retention, 0% false positives on identical, <100ms OCR overhead
- Vitest integration: `src/lib/diff/generator.benchmark.test.ts` (runs each scenario against all 3 engines)

---

## Implementation Order (Suggested)

**Foundation (do first):**
1. SSRF Protection (#3) — security foundation

**Core Diffing (high value):**
2. Multi-Engine Diffing (#1)
3. Text-Region-Aware Diffing (#2)
4. Diff Benchmark Framework (#6)

**Workflow:**
5. Async Background Jobs (#4)
6. AI Prompt Improvements (#5)
