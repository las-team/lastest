import type {
  ApiTestDefinition,
  QaDiscovery,
  QaGeneratedTest,
  QaPageSnapshot,
  QaPlanItem,
  QaPlanJourney,
  QaPriority,
  QaSummaryData,
  QaTestGroup,
  QaTestPlan,
  TestPlaywrightOverrides,
} from "@/lib/db/schema";

/**
 * QA Agent — pure planning helpers. Everything here is deterministic and
 * side-effect free so it can be unit-tested without a DB, browser, or AI
 * provider. The orchestrator (src/server/actions/qa-agent.ts) wires these
 * into the step machine.
 */

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const QA_GROUPS: Array<{
  id: QaTestGroup;
  label: string;
  description: string;
  /** journey is always planned; the user cannot deselect it. */
  locked?: boolean;
}> = [
  {
    id: "journey",
    label: "Business journeys",
    description:
      "Critical user journeys with verified business outcomes (e.g. order placed)",
    locked: true,
  },
  {
    id: "smoke",
    label: "Smoke",
    description: "Fast, read-mostly checks of critical paths — the PR gate",
  },
  {
    id: "api",
    label: "API",
    description: "Headless HTTP tests against observed API endpoints",
  },
  {
    id: "ui",
    label: "UI",
    description: "User-visible flows and interactions per page",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    description: "API-seeded state exercised and verified through the UI",
  },
  {
    id: "a11y",
    label: "Accessibility",
    description: "WCAG 2.2 AA checks (axe) on key pages and interaction states",
  },
  {
    id: "perf",
    label: "Performance",
    description: "Core Web Vitals budgets (LCP/CLS/TTFB) on key pages",
  },
  {
    id: "resilience",
    label: "Resilience",
    description: "Network failure injection and error-path behavior",
  },
  {
    id: "negative",
    label: "Negative",
    description: "Input validation matrices, boundaries, and abuse strings",
  },
];

export const QA_GROUP_IDS = QA_GROUPS.map((g) => g.id);

export function normalizeQaGroups(groups: QaTestGroup[]): QaTestGroup[] {
  const valid = groups.filter((g): g is QaTestGroup =>
    QA_GROUP_IDS.includes(g),
  );
  const set = new Set<QaTestGroup>(valid);
  set.add("journey");
  // Keep canonical order for stable UI/prompt output.
  return QA_GROUP_IDS.filter((g) => set.has(g));
}

/**
 * Per-group check-layer overrides applied to generated tests. Sparse — absent
 * keys fall through to repo defaults (see TestPlaywrightOverrides). a11y and
 * perf tests enforce their layer so the suite actually gates on them; for
 * resilience/negative tests console+network noise is expected (we
 * deliberately break the network), so those layers only log.
 */
export function groupPlaywrightOverrides(
  group: QaTestGroup,
): TestPlaywrightOverrides | undefined {
  switch (group) {
    case "a11y":
      return { a11yMode: "enforce" };
    case "perf":
      return { perfMode: "enforce" };
    case "resilience":
    case "negative":
      return { networkMode: "log", consoleMode: "log" };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Plan validation (parseAiJson predicate)
// ---------------------------------------------------------------------------

const PRIORITIES: QaPriority[] = ["P1", "P2", "P3"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function isJourney(v: unknown): v is QaPlanJourney {
  if (!v || typeof v !== "object") return false;
  const j = v as Record<string, unknown>;
  return (
    typeof j.id === "string" &&
    typeof j.title === "string" &&
    PRIORITIES.includes(j.priority as QaPriority) &&
    isStringArray(j.steps) &&
    typeof j.businessOutcome === "string" &&
    typeof j.endStateVerification === "string" &&
    (j.businessArea === undefined || typeof j.businessArea === "string")
  );
}

function isPlanItem(v: unknown): v is QaPlanItem {
  if (!v || typeof v !== "object") return false;
  const i = v as Record<string, unknown>;
  if (
    typeof i.id !== "string" ||
    !QA_GROUP_IDS.includes(i.group as QaTestGroup) ||
    typeof i.title !== "string" ||
    !PRIORITIES.includes(i.priority as QaPriority) ||
    typeof i.scenario !== "string" ||
    (i.businessArea !== undefined && typeof i.businessArea !== "string")
  ) {
    return false;
  }
  if (i.api !== undefined) {
    const a = i.api as Record<string, unknown>;
    if (
      !a ||
      typeof a !== "object" ||
      typeof a.path !== "string" ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(a.method as string)
    ) {
      return false;
    }
  }
  return true;
}

export function isQaTestPlan(v: unknown): v is QaTestPlan {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const profile = p.appProfile as Record<string, unknown> | undefined;
  if (!profile || typeof profile.summary !== "string") return false;
  if (!Array.isArray(p.journeys) || !p.journeys.every(isJourney)) return false;
  if (!Array.isArray(p.items) || !p.items.every(isPlanItem)) return false;
  return p.items.length > 0;
}

/** Drop plan items in groups the user did not select, and orphaned journey
 *  references. Keeps the plan internally consistent after AI generation. */
export function sanitizeQaPlan(
  plan: QaTestPlan,
  groups: QaTestGroup[],
): QaTestPlan {
  const allowed = new Set(groups);
  const journeyIds = new Set(plan.journeys.map((j) => j.id));
  return {
    ...plan,
    items: plan.items
      .filter((i) => allowed.has(i.group))
      .map((i) =>
        i.journeyId && !journeyIds.has(i.journeyId)
          ? { ...i, journeyId: undefined }
          : i,
      ),
  };
}

export function enabledPlanItems(plan: QaTestPlan): QaPlanItem[] {
  return plan.items.filter((i) => i.enabled !== false);
}

// ---------------------------------------------------------------------------
// Discovery digest — condensed, deterministic, capped
// ---------------------------------------------------------------------------

const MAX_DIGEST_CHARS = 24_000;

function pageDigest(p: QaPageSnapshot): string {
  const lines: string[] = [];
  lines.push(`### Page: ${p.finalUrl}${p.title ? ` — "${p.title}"` : ""}`);
  if (p.headings.length) {
    lines.push(
      `Headings: ${p.headings
        .slice(0, 10)
        .map((h) => `h${h.level} "${h.text}"`)
        .join("; ")}`,
    );
  }
  for (const f of p.forms.slice(0, 5)) {
    const inputs = f.inputs
      .slice(0, 12)
      .map((i) => {
        const label = i.label || i.name || i.id || i.type || i.tag;
        return `${i.tag}${i.type ? `[${i.type}]` : ""} "${label}"`;
      })
      .join(", ");
    lines.push(
      `Form${f.name ? ` "${f.name}"` : ""} (${f.method.toUpperCase()}${f.action ? ` → ${f.action}` : ""}): ${inputs}`,
    );
  }
  if (p.buttons.length) {
    lines.push(`Buttons: ${p.buttons.slice(0, 20).join(" | ")}`);
  }
  if (p.links.length) {
    lines.push(
      `Links: ${p.links
        .slice(0, 25)
        .map((l) => `"${l.text || "(icon)"}" → ${l.href}`)
        .join("; ")}`,
    );
  }
  if (p.testIds.length) {
    lines.push(`data-testid: ${p.testIds.slice(0, 30).join(", ")}`);
  }
  if (p.candidateSelectors.length) {
    lines.push(
      `Verified selectors: ${p.candidateSelectors.slice(0, 20).join(" ; ")}`,
    );
  }
  if (p.apiEndpoints.length) {
    lines.push(
      `API calls observed: ${p.apiEndpoints
        .slice(0, 20)
        .map((e) => `${e.method} ${e.path} → ${e.status}`)
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

export function buildDiscoveryDigest(discovery: QaDiscovery): string {
  const sections: string[] = [];
  sections.push(`Target URL: ${discovery.targetUrl}`);
  if (discovery.staticRoutes?.length) {
    sections.push(
      `## Routes from source code (${discovery.framework ?? "unknown framework"})\n` +
        discovery.staticRoutes
          .slice(0, 80)
          .map((r) => `- ${r.path} (${r.type})`)
          .join("\n"),
    );
  } else if (discovery.githubConnected) {
    sections.push("## Routes from source code\n(none found by static scan)");
  }
  sections.push("## Live crawl (rendered DOM — authoritative for selectors)");
  for (const page of discovery.crawledPages) {
    sections.push(pageDigest(page));
  }
  const digest = sections.join("\n\n");
  return digest.length > MAX_DIGEST_CHARS
    ? digest.slice(0, MAX_DIGEST_CHARS) + "\n…(truncated)"
    : digest;
}

// ---------------------------------------------------------------------------
// Planner prompts
// ---------------------------------------------------------------------------

/** Distilled 2025/2026 web-app test-design best practices (playwright.dev,
 *  web.dev CWV, Deque/axe, testing-trophy, IEEE-829-derived planning). The
 *  planner must ground every item in the discovery digest, not this text. */
const BEST_PRACTICES = `TEST DESIGN PRINCIPLES (follow strictly):
- Risk-based prioritization: P1 = revenue/universal-gateway/critical-consequence flows, P2 = important features, P3 = nice-to-have. Score by business impact × likelihood of breakage.
- Smoke tier: read-mostly checks of critical paths (page loads, login form present, core nav works). Production-safe — no data mutation.
- Business journeys: identify the app's PRIMARY business outcome (a bank transfer completed, an order placed, a signup finished) and plan complete end-to-end journeys that PROVE the outcome — a success toast is not proof; specify end-state verification (balance changed, record visible in a list, API returns the created resource).
- API tests: exercise observed API endpoints headlessly (status, response shape). Prefer endpoints seen during the live crawl.
- Hybrid tests: seed or verify state via API where endpoints exist, exercise the behavior via UI. Never build test state through long UI click chains.
- UI tests: user-visible flows per page. Assert user-visible outcomes with web-first assertions; never implementation details.
- Accessibility: key pages AND post-interaction states (open modal, error state). WCAG 2.2 AA via axe.
- Performance: Core Web Vitals budgets on key pages — LCP ≤ 2.5s, CLS ≤ 0.1, TTFB ≤ 800ms.
- Resilience: abort/fail API calls, offline mode, 500/429 responses — assert graceful error UI, no blank screens, no data loss.
- Negative: per-form input matrices — empty, whitespace, boundary lengths (min−1/min/max/max+1), wrong type, unicode/emoji, inert XSS payload strings, oversized input, double-submit.
- Selector strategy for scenarios: reference elements by role+name or data-testid exactly as they appear in the discovery digest. NEVER invent selectors.
- Every test must be independent and idempotent where possible.`;

export function buildPlannerSystemPrompt(): string {
  return `You are a principal QA architect designing a comprehensive automated test suite for a web application. You are given real discovery data: rendered-DOM page maps, verified selectors, observed API endpoints, and (when available) routes from the app's source code.

${BEST_PRACTICES}

OUTPUT: a single JSON object, no markdown fences, no commentary, matching exactly:
{
  "appProfile": { "summary": string, "businessDomain": string, "primaryOutcome": string },
  "journeys": [ { "id": "J1", "title": string, "priority": "P1"|"P2"|"P3", "businessArea": string, "steps": [string], "businessOutcome": string, "endStateVerification": string } ],
  "items": [ { "id": "T1", "group": <group>, "title": string, "priority": "P1"|"P2"|"P3", "journeyId": string?, "businessArea": string, "pagePath": string?, "rationale": string, "scenario": string, "selectorHints": [string]?, "api": { "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "path": string, "expectedStatus": number }? } ],
  "entryCriteria": [string],
  "exitCriteria": [string],
  "risks": [string]
}

RULES:
- "scenario" must be generator-ready: numbered concrete steps with expected results, grounded in the discovery digest (real button labels, real form fields, real paths).
- Every journey needs at least one covering item with group "journey" and journeyId set (traceability).
- Items in group "api" MUST include the "api" object using an endpoint observed in discovery. Do not plan api items for endpoints you did not observe.
- selectorHints must be copied from the digest's verified selectors / data-testid lists — never invented.
- pagePath is relative to the target URL (e.g. "/login").
- "businessArea" is REQUIRED on every item and journey: a short, consistent functional-domain name (e.g. "Authentication", "Accounts", "Checkout", "Marketing"). Use 2-5 distinct areas total and reuse the exact same spelling across items — they become the rows of a coverage matrix.
- 2-4 items per selected group, 1-3 journeys. Quality over quantity: every item must be executable against the discovered pages.
- If credentials are provided, journeys may include login; if not, plan public-surface coverage only.`;
}

export function buildPlannerUserPrompt(opts: {
  digest: string;
  groups: QaTestGroup[];
  credsProvided: boolean;
  feedback?: string;
  /** Digest of tests that already exist in the repo (see
   *  buildExistingCoverageDigest). Present on refresh/spec runs so the
   *  planner designs against the CURRENT suite instead of a blank slate. */
  existingCoverage?: string;
}): string {
  const groupList = opts.groups
    .map((g) => {
      const meta = QA_GROUPS.find((m) => m.id === g);
      return `- ${g}: ${meta?.description ?? ""}`;
    })
    .join("\n");
  const parts = [
    `Design the test plan for the application described below.`,
    `Selected coverage groups:\n${groupList}`,
    `Login credentials available: ${opts.credsProvided ? "YES — journeys may authenticate" : "NO — public surface only"}`,
  ];
  if (opts.existingCoverage) {
    parts.push(
      `The repository ALREADY CONTAINS the automated tests listed below (created by earlier runs or by hand). Design the plan for the application as it is NOW: keep the plan complete (every journey and coverage angle listed, so traceability stays whole), and when a scenario is already well covered by an existing test, reuse that test's exact name as the item title so it can be matched — do not invent a variation of it. Focus new/changed scenarios on what the existing suite does NOT cover.\n\n--- EXISTING TESTS ---\n${opts.existingCoverage}`,
    );
  }
  if (opts.feedback) {
    parts.push(
      `The previous plan was rejected by the human reviewer with this feedback — address it:\n${opts.feedback}`,
    );
  }
  parts.push(`--- DISCOVERY DIGEST ---\n${opts.digest}`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Existing-coverage matching (segmented re-runs)
// ---------------------------------------------------------------------------

/** The slice of a repo test the matcher/planner needs. */
export interface ExistingTestSummary {
  id: string;
  name: string;
  testType?: string | null;
  functionalAreaName?: string | null;
}

const MAX_EXISTING_DIGEST_TESTS = 120;

export function buildExistingCoverageDigest(
  tests: ExistingTestSummary[],
): string {
  return tests
    .slice(0, MAX_EXISTING_DIGEST_TESTS)
    .map(
      (t) =>
        `- "${t.name}"${t.functionalAreaName ? ` (area: ${t.functionalAreaName})` : ""}${t.testType === "api" ? " [api]" : ""}`,
    )
    .join("\n");
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Deterministically match plan items to tests that already exist. Two
 * signals, strongest first:
 *  1. A prior run's ledger linked the same plan-item id to a test that still
 *     exists (fill_gaps reuses the source session's plan, so ids are stable).
 *  2. Normalized-title equality with an existing test's name (covers manual
 *     tests and the planner echoing an existing test's exact name).
 * Returns planItemId → existing testId.
 */
export function matchPlanToExistingTests(
  items: QaPlanItem[],
  existingTests: ExistingTestSummary[],
  priorLedger?: QaGeneratedTest[],
): Map<string, string> {
  const liveIds = new Set(existingTests.map((t) => t.id));
  const byTitle = new Map<string, string>();
  for (const t of existingTests) {
    const key = normalizeTitle(t.name);
    if (key && !byTitle.has(key)) byTitle.set(key, t.id);
  }
  const priorByItem = new Map<string, string>();
  for (const entry of priorLedger ?? []) {
    if (entry.testId && liveIds.has(entry.testId)) {
      priorByItem.set(entry.planItemId, entry.testId);
    }
  }
  const matches = new Map<string, string>();
  for (const item of items) {
    const prior = priorByItem.get(item.id);
    if (prior) {
      matches.set(item.id, prior);
      continue;
    }
    const byName = byTitle.get(normalizeTitle(item.title));
    if (byName) matches.set(item.id, byName);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Generator prompt per plan item
// ---------------------------------------------------------------------------

const GROUP_GENERATION_GUIDANCE: Partial<Record<QaTestGroup, string>> = {
  smoke:
    "This is a SMOKE test: read-only, fast, production-safe. No data mutation. Assert the page renders its critical content and key controls are visible.",
  a11y: "This is an ACCESSIBILITY test. After reaching each state described in the scenario, take a screenshot checkpoint. Structure interactions so key states (initial page, opened dialogs, error states) are each reached and captured — the platform runs axe automatically on captured states.",
  perf: "This is a PERFORMANCE test. Navigate to the target page(s) with a plain page.goto and take a screenshot checkpoint per page — the platform captures Core Web Vitals automatically. Do not add artificial waits.",
  resilience:
    "This is a RESILIENCE test. Use page.route() to inject failures BEFORE the interaction (e.g. await page.route('**/api/**', route => route.abort('failed')) or route.fulfill({ status: 500, body: '{}' })). Then perform the interaction and assert graceful error UI: an error message is visible, the page did not blank, and data was not silently lost. Unroute afterwards if the scenario continues.",
  negative:
    "This is a NEGATIVE test. Drive the form(s) through the invalid-input matrix in the scenario (empty, boundary, wrong type, XSS-payload-as-inert-text). Assert validation feedback appears and no invalid submission succeeds.",
  hybrid:
    "This is a HYBRID test. Where the scenario says to verify via API, use the page's fetch from the browser context (const res = await page.evaluate(...fetch...)) against the same origin and assert on the JSON, in addition to UI assertions.",
  journey:
    "This is a BUSINESS-OUTCOME JOURNEY. Complete the full flow and then PROVE the outcome per the end-state verification (assert the persisted result is visible: updated balance, created record in a list, confirmation with a real identifier). A success toast alone is insufficient.",
};

export function buildGeneratorPrompt(opts: {
  item: QaPlanItem;
  plan: QaTestPlan;
  targetUrl: string;
  credentials?: { email: string; password: string };
}): string {
  const { item, plan } = opts;
  const journey = item.journeyId
    ? plan.journeys.find((j) => j.id === item.journeyId)
    : undefined;
  const parts: string[] = [];
  parts.push(`Test: ${item.title}`);
  parts.push(`Coverage group: ${item.group} · Priority: ${item.priority}`);
  if (item.pagePath) parts.push(`Page under test: ${item.pagePath}`);
  const guidance = GROUP_GENERATION_GUIDANCE[item.group];
  if (guidance) parts.push(guidance);
  parts.push(`Scenario:\n${item.scenario}`);
  if (journey) {
    parts.push(
      `Journey context: "${journey.title}" — business outcome: ${journey.businessOutcome}. End-state verification requirement: ${journey.endStateVerification}`,
    );
  }
  if (item.selectorHints?.length) {
    parts.push(
      `Verified selectors from discovery (prefer these):\n${item.selectorHints
        .map((s) => `- ${s}`)
        .join("\n")}`,
    );
  }
  if (opts.credentials) {
    parts.push(
      `If the scenario requires authentication, log in first with email "${opts.credentials.email}" and password "${opts.credentials.password}".`,
    );
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// API-group item → headless ApiTestDefinition
// ---------------------------------------------------------------------------

export function buildApiDefinition(
  item: QaPlanItem,
  targetUrl: string,
): ApiTestDefinition | null {
  if (!item.api) return null;
  const base = targetUrl.replace(/\/+$/, "");
  const path = item.api.path.startsWith("/")
    ? item.api.path
    : `/${item.api.path}`;
  const isAbsolute = /^https?:\/\//i.test(item.api.path);
  return {
    method: item.api.method,
    url: isAbsolute ? item.api.path : `${base}${path}`,
    ...(item.api.body !== undefined ? { body: item.api.body } : {}),
    assertions: [
      {
        kind: "status",
        equals: item.api.expectedStatus ?? 200,
        description:
          item.api.description ?? `${item.title} returns expected status`,
      },
      {
        kind: "latencyMs",
        maxMs: 5000,
        description: "responds within 5s",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Summary / traceability
// ---------------------------------------------------------------------------

export function computeQaSummary(
  plan: QaTestPlan,
  generated: QaGeneratedTest[],
): QaSummaryData {
  const items = enabledPlanItems(plan);
  const byGroup: QaSummaryData["byGroup"] = {};
  const emptyBucket = () => ({
    planned: 0,
    generated: 0,
    covered: 0,
    passed: 0,
  });
  for (const item of items) {
    const bucket = (byGroup[item.group] ??= emptyBucket());
    bucket.planned += 1;
  }
  let generatedCount = 0;
  let covered = 0;
  let passed = 0;
  let failed = 0;
  let healed = 0;
  for (const g of generated) {
    const bucket = (byGroup[g.group] ??= emptyBucket());
    if (g.status === "covered") {
      covered += 1;
      bucket.covered += 1;
      continue;
    }
    if (g.status !== "generation_failed" && g.status !== "generating") {
      generatedCount += 1;
      bucket.generated += 1;
    }
    if (g.status === "passed" || g.status === "healed") {
      passed += 1;
      bucket.passed += 1;
    }
    if (g.status === "healed") healed += 1;
    if (g.status === "failed") failed += 1;
  }
  const journeyCoverage: Record<string, string[]> = {};
  for (const journey of plan.journeys) {
    const coveringItems = new Set(
      items.filter((i) => i.journeyId === journey.id).map((i) => i.id),
    );
    journeyCoverage[journey.id] = generated
      .filter((g) => g.testId && coveringItems.has(g.planItemId))
      .map((g) => g.testId!) as string[];
  }

  // Coverage matrix: business area × test group. Rows come from the plan's
  // businessArea labels ("General" when the planner omitted one).
  const ledgerByItem = new Map(generated.map((g) => [g.planItemId, g]));
  const matrix: NonNullable<QaSummaryData["matrix"]> = {};
  for (const item of items) {
    const area = item.businessArea?.trim() || "General";
    const row = (matrix[area] ??= {});
    const cell = (row[item.group] ??= {
      planned: 0,
      covered: 0,
      generated: 0,
      passed: 0,
    });
    cell.planned += 1;
    const entry = ledgerByItem.get(item.id);
    if (!entry) continue;
    if (entry.status === "covered") {
      cell.covered += 1;
    } else if (entry.status !== "generating" && entry.testId) {
      cell.generated += 1;
      if (entry.status === "passed" || entry.status === "healed") {
        cell.passed += 1;
      }
    }
  }

  return {
    planned: items.length,
    generated: generatedCount,
    covered,
    passed,
    failed,
    healed,
    byGroup,
    matrix,
    journeyCoverage,
  };
}
