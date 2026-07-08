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
  /** Compact label for narrow matrix column headers. */
  short: string;
  description: string;
  /** journey is always planned; the user cannot deselect it. */
  locked?: boolean;
}> = [
  {
    id: "journey",
    label: "Business journeys",
    short: "Journey",
    description:
      "Critical user journeys with verified business outcomes (e.g. order placed)",
    locked: true,
  },
  {
    id: "smoke",
    label: "Smoke",
    short: "Smoke",
    description: "Fast, read-mostly checks of critical paths — the PR gate",
  },
  {
    id: "api",
    label: "API",
    short: "API",
    description: "Headless HTTP tests against observed API endpoints",
  },
  {
    id: "ui",
    label: "UI",
    short: "UI",
    description: "User-visible flows and interactions per page",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    short: "Hybrid",
    description: "API-seeded state exercised and verified through the UI",
  },
  {
    id: "a11y",
    label: "Accessibility",
    short: "A11y",
    description: "WCAG 2.2 AA checks (axe) on key pages and interaction states",
  },
  {
    id: "perf",
    label: "Performance",
    short: "Perf",
    description: "Core Web Vitals budgets (LCP/CLS/TTFB) on key pages",
  },
  {
    id: "resilience",
    label: "Resilience",
    short: "Resil",
    description: "Network failure injection and error-path behavior",
  },
  {
    id: "negative",
    label: "Negative",
    short: "Neg",
    description: "Input validation matrices, boundaries, and abuse strings",
  },
];

export const QA_GROUP_IDS = QA_GROUPS.map((g) => g.id);

/** Defensive backstop on plan size. Browser tests generate SEQUENTIALLY on a
 *  single Embedded Browser (each with a multi-minute timeout), so an unbounded
 *  plan can run for hours. The planner prompt asks for a small set; these caps
 *  keep a runaway plan bounded even if it ignores that. Overflow trims lowest
 *  priority first (see sanitizeQaPlan). */
export const MAX_PLAN_ITEMS = 20;
export const MAX_PLAN_JOURNEYS = 5;

export function normalizeQaGroups(groups: QaTestGroup[]): QaTestGroup[] {
  const valid = groups.filter((g): g is QaTestGroup =>
    QA_GROUP_IDS.includes(g),
  );
  const set = new Set<QaTestGroup>(valid);
  set.add("journey");
  // Keep canonical order for stable UI/prompt output.
  return QA_GROUP_IDS.filter((g) => set.has(g));
}

/** All coverage groups a plan item satisfies: `groups` (deduped, primary
 *  first, rest in canonical order) or `[group]` for legacy single-group
 *  items. One generated test counts toward every group returned here. */
export function itemGroups(item: QaPlanItem): QaTestGroup[] {
  const raw = item.groups?.filter((g) => QA_GROUP_IDS.includes(g));
  if (!raw?.length) return [item.group];
  const rest = new Set(raw.filter((g) => g !== raw[0]));
  return [raw[0], ...QA_GROUP_IDS.filter((g) => rest.has(g))];
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

/** Merged check-layer overrides for a (possibly multi-group) plan item.
 *  Group override keys are disjoint (a11yMode / perfMode / networkMode+
 *  consoleMode), so a plain spread-merge is conflict-free. */
export function itemPlaywrightOverrides(
  groups: QaTestGroup[],
): TestPlaywrightOverrides | undefined {
  let merged: TestPlaywrightOverrides | undefined;
  for (const group of groups) {
    const overrides = groupPlaywrightOverrides(group);
    if (overrides) merged = { ...merged, ...overrides };
  }
  return merged;
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
  const hasGroup = QA_GROUP_IDS.includes(i.group as QaTestGroup);
  const hasGroups =
    Array.isArray(i.groups) &&
    i.groups.length > 0 &&
    i.groups.every((g) => QA_GROUP_IDS.includes(g as QaTestGroup));
  if (i.groups !== undefined && !hasGroups) return false;
  if (
    typeof i.id !== "string" ||
    (!hasGroup && !hasGroups) ||
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

/** First concrete reason a value fails isQaTestPlan, or null when it passes.
 *  Fed into the planner-retry prompt so the model gets a specific correction
 *  instead of a blind "that wasn't valid JSON". */
export function explainInvalidQaPlan(v: unknown): string | null {
  if (!v || typeof v !== "object")
    return "top-level value is not a JSON object";
  const p = v as Record<string, unknown>;
  const profile = p.appProfile as Record<string, unknown> | undefined;
  if (!profile || typeof profile.summary !== "string") {
    return 'missing "appProfile.summary" (a string)';
  }
  if (!Array.isArray(p.journeys)) return '"journeys" must be an array';
  const badJourney = p.journeys.findIndex((j) => !isJourney(j));
  if (badJourney !== -1) {
    return `journeys[${badJourney}] is malformed — each journey needs id, title, priority (P1|P2|P3), steps[], businessOutcome, endStateVerification`;
  }
  if (!Array.isArray(p.items)) return '"items" must be an array';
  if (p.items.length === 0) return '"items" is empty — plan at least one test';
  const badItem = p.items.findIndex((i) => !isPlanItem(i));
  if (badItem !== -1) {
    return `items[${badItem}] is malformed — each item needs id, group or groups[], title, priority (P1|P2|P3), scenario; api items need api.path and a valid api.method`;
  }
  return null;
}

/** Drop plan items whose groups the user did not select (multi-group items
 *  survive with disallowed groups stripped), backfill the primary `group`
 *  when the AI only emitted `groups`, and clear orphaned journey references.
 *  Keeps the plan internally consistent after AI generation. */
export function sanitizeQaPlan(
  plan: QaTestPlan,
  groups: QaTestGroup[],
): QaTestPlan {
  const allowed = new Set(groups);
  // Cap journeys first so item journey-refs resolve against the kept set.
  const journeys = plan.journeys.slice(0, MAX_PLAN_JOURNEYS);
  const journeyIds = new Set(journeys.map((j) => j.id));
  let items: QaPlanItem[] = [];
  for (const raw of plan.items) {
    const kept = itemGroups(raw).filter((g) => allowed.has(g));
    if (kept.length === 0) continue;
    const item: QaPlanItem = { ...raw, group: kept[0], groups: kept };
    if (item.journeyId && !journeyIds.has(item.journeyId)) {
      item.journeyId = undefined;
    }
    items.push(item);
  }
  // Backstop overflow: keep original order under the cap; when over it, trim
  // lowest-priority first (stable within a priority) so P1 coverage survives.
  if (items.length > MAX_PLAN_ITEMS) {
    const rank: Record<QaPriority, number> = { P1: 0, P2: 1, P3: 2 };
    items = items
      .map((it, idx) => ({ it, idx }))
      .sort(
        (a, b) => rank[a.it.priority] - rank[b.it.priority] || a.idx - b.idx,
      )
      .slice(0, MAX_PLAN_ITEMS)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.it);
  }
  return { ...plan, journeys, items };
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
  if (p.consoleErrors?.length) {
    lines.push(
      `Console errors on load (pre-existing noise — NOT caused by tests): ${p.consoleErrors
        .slice(0, 8)
        .map((e) => `"${e}"`)
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

  // Add whole page digests until the budget is spent, then stop at the page
  // boundary and say how many were dropped — never slice mid-page, which would
  // hand the planner a half-described page it can't ground selectors in.
  const header = sections.join("\n\n");
  const pages = discovery.crawledPages;
  let budget = MAX_DIGEST_CHARS - header.length;
  const pageSections: string[] = [];
  let included = 0;
  for (const page of pages) {
    const section = pageDigest(page);
    if (included > 0 && section.length + 2 > budget) break;
    pageSections.push(section);
    budget -= section.length + 2;
    included += 1;
  }
  const omitted = pages.length - included;
  const body = pageSections.join("\n\n");
  const suffix =
    omitted > 0
      ? `\n\n…(${omitted} more crawled page${omitted > 1 ? "s" : ""} omitted to fit the context budget)`
      : "";
  return `${header}\n\n${body}${suffix}`;
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
- Console noise: the executor fails a test on ANY console error. When the digest reports pre-existing console errors for a page (third-party/analytics noise present before any test runs), the scenario for a non-resilience test on that page MUST instruct blocking those third-party requests (page.route the offending host to abort/fulfill) so the test only fails on errors it actually caused.
- Every test must be independent and idempotent where possible.
- Idempotent test data: any scenario that CREATES a record (signup, new order, new item, invited user) must use a per-run unique value for the uniqueness-constrained field (email, name, slug, title). Instruct the generator to stamp it at runtime (e.g. \`user-\${Date.now().toString(36)}@example.com\`) — a hardcoded value passes once, then fails every re-run on "already exists". Note this in the scenario for create flows.

CONSOLIDATION (minimize test count): the platform runs EVERY check layer (visual, a11y/axe, performance/CWV, console, network, text, DOM) on each test execution automatically. When multiple coverage angles exercise the same page or flow, plan ONE test tagged with all applicable groups instead of separate tests — never plan a standalone a11y or perf test for a page another planned test already visits; tag that test instead. Compatibility rules:
- smoke, ui, hybrid, journey, a11y, perf combine freely in one test.
- resilience and negative may combine with each other (both expect console/network noise) but NEVER with smoke or journey (smoke is production-safe read-only; an injected failure invalidates outcome proof).
- api never combines (headless, no browser).`;

export function buildPlannerSystemPrompt(): string {
  return `You are a principal QA architect designing a comprehensive automated test suite for a web application. You are given real discovery data: rendered-DOM page maps, verified selectors, observed API endpoints, and (when available) routes from the app's source code.

${BEST_PRACTICES}

OUTPUT: a single JSON object, no markdown fences, no commentary, matching exactly:
{
  "appProfile": { "summary": string, "businessDomain": string, "primaryOutcome": string },
  "journeys": [ { "id": "J1", "title": string, "priority": "P1"|"P2"|"P3", "businessArea": string, "steps": [string], "businessOutcome": string, "endStateVerification": string } ],
  "items": [ { "id": "T1", "groups": [<group>, ...], "title": string, "priority": "P1"|"P2"|"P3", "journeyId": string?, "businessArea": string, "pagePath": string?, "rationale": string, "scenario": string, "selectorHints": [string]?, "api": { "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "path": string, "expectedStatus": number }? } ],
  "entryCriteria": [string],
  "exitCriteria": [string],
  "risks": [string]
}

RULES:
- "scenario" must be generator-ready: numbered concrete steps with expected results, grounded in the discovery digest (real button labels, real form fields, real paths).
- "groups" lists EVERY coverage group the test satisfies, most-defining first — the scenario must genuinely exercise each listed group (a11y: reaches the key interaction states; perf: plain navigation to the page; ui: user-visible interaction).
- Every journey needs at least one covering item with "journey" in its groups and journeyId set (traceability).
- Items with "api" in groups MUST include the "api" object using an endpoint observed in discovery. Do not plan api items for endpoints you did not observe.
- selectorHints must be copied from the digest's verified selectors / data-testid lists — never invented.
- pagePath is relative to the target URL (e.g. "/login").
- "businessArea" is REQUIRED on every item and journey: a short, consistent functional-domain name (e.g. "Authentication", "Accounts", "Checkout", "Marketing"). Use 2-5 distinct areas total and reuse the exact same spelling across items — they become the rows of a coverage matrix.
- Every selected group must appear in at least one item's "groups". Plan the SMALLEST test set that achieves this — typically 1-2 items per page/flow — and 1-3 journeys. Quality over quantity: every item must be executable against the discovered pages. HARD LIMITS: at most ${MAX_PLAN_ITEMS} items and ${MAX_PLAN_JOURNEYS} journeys — consolidate rather than exceed them (tests generate one at a time, so a bloated plan is slow and low-signal).
- Ground the plan in the DISCOVERY DIGEST's actual crawled pages. When the digest's crawled pages are signed-in, in-app pages (a dashboard, resource lists, detail/settings pages), the app IS authenticated for this run — plan coverage of that in-app product surface. Never collapse an authenticated run into public login/register pages that the crawl did not even map; the auth pages are the gateway, not the product.
- Authentication: when an authenticated session is available (see the user message), plan the in-app surface and journeys need NOT script a login (the session is applied automatically) — do not spend items on the login form unless login itself is a listed coverage goal. When no authenticated session is available, plan public-surface coverage only.`;
}

export function buildPlannerUserPrompt(opts: {
  digest: string;
  groups: QaTestGroup[];
  /** The discovery crawl ran with an authenticated session AND generated tests
   *  will run authenticated (typed credentials, a captured storage state, or
   *  repo default setup steps). When true the planner must cover the
   *  discovered signed-in in-app surface, not just public auth/marketing pages.
   *  This is auth AVAILABILITY, not "plaintext credentials were typed" — a
   *  storage-state session counts. */
  authenticated: boolean;
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
    opts.authenticated
      ? "Authenticated session available: YES — the discovery crawl ran signed-in and every generated test starts authenticated. The DISCOVERY DIGEST below is the signed-in, in-app surface. Plan coverage of THAT in-app surface (the real product features the crawl mapped — dashboards, lists, detail pages, settings, create/edit flows). Do NOT reduce the plan to public login/register/marketing pages; those are the gateway, not the product. Journeys must exercise the primary in-app outcome, not just reaching the app."
      : "Authenticated session available: NO — public surface only. Plan coverage of the public pages the crawl mapped (login, register, forgot-password, marketing) only; do not plan tests that require being signed in.",
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
// Journey refiner — turn a human's plain-language journeys into structured,
// grounded journeys + covering items and MERGE them into an existing plan.
// The condensed digest loses domain intent; this lets the human inject the
// journeys they care about and have the AI make them executable, without
// re-planning (existing items and the reviewer's enable/disable choices stay).
// ---------------------------------------------------------------------------

/** The AI journey refiner returns only NEW additions to merge into the plan. */
export interface RefinedJourneys {
  journeys: QaPlanJourney[];
  items: QaPlanItem[];
}

/** Hard cap on how many items ONE refine call can add, on top of the plan's
 *  existing items. Bounds sequential browser-generation time. */
export const MAX_REFINED_NEW_ITEMS = MAX_PLAN_ITEMS;

export function isRefinedJourneys(v: unknown): v is RefinedJourneys {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.journeys) || !r.journeys.every(isJourney)) return false;
  if (!Array.isArray(r.items) || !r.items.every(isPlanItem)) return false;
  return r.journeys.length > 0 || r.items.length > 0;
}

/** First concrete reason a value fails isRefinedJourneys, for retry prompts. */
export function explainInvalidRefinedJourneys(v: unknown): string | null {
  if (!v || typeof v !== "object")
    return "top-level value is not a JSON object";
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.journeys)) return '"journeys" must be an array';
  const badJourney = r.journeys.findIndex((j) => !isJourney(j));
  if (badJourney !== -1) {
    return `journeys[${badJourney}] is malformed — each journey needs id, title, priority (P1|P2|P3), steps[], businessOutcome, endStateVerification`;
  }
  if (!Array.isArray(r.items)) return '"items" must be an array';
  const badItem = r.items.findIndex((i) => !isPlanItem(i));
  if (badItem !== -1) {
    return `items[${badItem}] is malformed — each item needs id, group or groups[], title, priority (P1|P2|P3), scenario`;
  }
  if (r.journeys.length === 0 && r.items.length === 0) {
    return "produced no journeys and no items — refine the user's journeys into at least one journey and one covering item";
  }
  return null;
}

export function buildJourneyRefinerSystemPrompt(): string {
  return `You are a principal QA architect. A QA engineer has written one or more user journeys in plain language that they want ADDED to an existing, already-approved test plan for a web application. Refine each into a rigorous, executable journey plus the covering test items that prove it, grounded in the real discovery data (rendered-DOM page maps, verified selectors, observed API endpoints).

${BEST_PRACTICES}

OUTPUT: a single JSON object, no markdown fences, no commentary, matching exactly:
{
  "journeys": [ { "id": "U1", "title": string, "priority": "P1"|"P2"|"P3", "businessArea": string, "steps": [string], "businessOutcome": string, "endStateVerification": string } ],
  "items": [ { "id": "UT1", "groups": [<group>, ...], "title": string, "priority": "P1"|"P2"|"P3", "journeyId": string, "businessArea": string, "pagePath": string?, "rationale": string, "scenario": string, "selectorHints": [string]?, "api": { "method": ..., "path": string, "expectedStatus": number }? } ]
}

RULES:
- Output ONLY the NEW journeys the user asked for and the items that cover them — do NOT restate the existing plan (it is shown for context so you avoid duplicating it).
- Refine, don't merely echo: turn each plain-language journey into concrete numbered steps, a real business outcome, and an end-state verification that proves the outcome beyond a toast.
- Ground every step, selector, and path in the DISCOVERY DIGEST. If the user's journey references a page or action not present in the digest, plan the closest real flow the digest supports and note the assumption in "rationale" — never invent selectors or routes.
- Each journey needs at least one covering item with "journey" in its groups and journeyId set to that journey's id.
- Respect the selected coverage groups only. Consolidate: one item may carry several compatible groups (see CONSOLIDATION).
- Keep it tight: at most one or two items per journey unless the user's journey is genuinely multi-page. Every item must be executable against the discovered pages.`;
}

export function buildJourneyRefinerUserPrompt(opts: {
  digest: string;
  groups: QaTestGroup[];
  userJourneys: string[];
  /** Titles of the plan's current journeys + items, so the refiner does not
   *  duplicate coverage that already exists. */
  existingPlanDigest: string;
  authenticated: boolean;
}): string {
  const groupList = opts.groups
    .map((g) => {
      const meta = QA_GROUPS.find((m) => m.id === g);
      return `- ${g}: ${meta?.description ?? ""}`;
    })
    .join("\n");
  const journeyList = opts.userJourneys
    .map((j, i) => `${i + 1}. ${j}`)
    .join("\n");
  return [
    `Refine the user-supplied journeys below into structured journeys + covering test items, grounded in the discovery digest.`,
    `Selected coverage groups:\n${groupList}`,
    opts.authenticated
      ? "Authenticated session available: YES — the discovery digest is the signed-in, in-app surface and generated tests run authenticated. Plan the journeys against that in-app surface."
      : "Authenticated session available: NO — public surface only.",
    `--- USER-SUPPLIED JOURNEYS (refine these) ---\n${journeyList}`,
    `--- EXISTING PLAN (context only — DO NOT duplicate) ---\n${opts.existingPlanDigest}`,
    `--- DISCOVERY DIGEST ---\n${opts.digest}`,
  ].join("\n\n");
}

/** Compact digest of a plan's current journeys + item titles for the refiner. */
export function buildExistingPlanDigest(plan: QaTestPlan): string {
  const journeys = plan.journeys.length
    ? plan.journeys.map((j) => `- journey: "${j.title}"`).join("\n")
    : "(none)";
  const items = plan.items.length
    ? plan.items.map((i) => `- test: "${i.title}"`).join("\n")
    : "(none)";
  return `Journeys:\n${journeys}\n\nTests:\n${items}`;
}

const PRIORITY_RANK: Record<QaPriority, number> = { P1: 0, P2: 1, P3: 2 };

/**
 * Merge AI-refined journeys/items into an existing plan WITHOUT disturbing the
 * existing items or the reviewer's enable/disable choices. Deduplicates against
 * existing titles, strips groups the user didn't select, remaps AI ids to fresh
 * collision-free ids (preserving journey→item links), guarantees journey-linked
 * items carry the "journey" group, and bounds how many new items are added so
 * sequential browser generation stays tractable. Returns the merged plan plus a
 * count of items that were dropped by the budget.
 */
export function mergeRefinedJourneys(
  plan: QaTestPlan,
  refined: RefinedJourneys,
  groups: QaTestGroup[],
): {
  plan: QaTestPlan;
  addedJourneys: number;
  addedItems: number;
  trimmed: number;
} {
  const allowed = new Set(groups);
  const existingItemTitles = new Set(
    plan.items.map((i) => normalizeTitle(i.title)),
  );
  const existingJourneyByTitle = new Map(
    plan.journeys.map((j) => [normalizeTitle(j.title), j.id]),
  );

  // Journeys: dedup by title (map dup ids onto the existing journey), remap the
  // rest to fresh U-prefixed ids. Journeys are cheap metadata — allow up to
  // MAX_PLAN_JOURNEYS new ones on top of the existing set.
  const idMap = new Map<string, string>();
  const newJourneys: QaPlanJourney[] = [];
  let jn = plan.journeys.length;
  for (const rj of refined.journeys) {
    const dupId = existingJourneyByTitle.get(normalizeTitle(rj.title));
    if (dupId) {
      idMap.set(rj.id, dupId);
      continue;
    }
    if (newJourneys.length >= MAX_PLAN_JOURNEYS) continue;
    const newId = `U${++jn}`;
    idMap.set(rj.id, newId);
    newJourneys.push({ ...rj, id: newId });
  }
  const journeyIds = new Set([
    ...plan.journeys.map((j) => j.id),
    ...newJourneys.map((j) => j.id),
  ]);

  // Items: strip disallowed groups, dedup by title, remap ids + journeyId,
  // ensure journey-linked items carry the "journey" group.
  const candidates: QaPlanItem[] = [];
  let tn = plan.items.length;
  for (const ri of refined.items) {
    let kept = itemGroups(ri).filter((g) => allowed.has(g));
    if (kept.length === 0) continue;
    if (existingItemTitles.has(normalizeTitle(ri.title))) continue;
    const mappedJourneyId = ri.journeyId ? idMap.get(ri.journeyId) : undefined;
    const journeyId =
      mappedJourneyId && journeyIds.has(mappedJourneyId)
        ? mappedJourneyId
        : undefined;
    if (journeyId && allowed.has("journey") && !kept.includes("journey")) {
      kept = ["journey", ...kept];
    }
    candidates.push({
      ...ri,
      id: `U${++tn}`,
      group: kept[0],
      groups: kept,
      journeyId,
    });
  }

  // Bound new items so combined stays near MAX_PLAN_ITEMS, but always admit a
  // few of the user's items even when the plan is already full (explicit ask).
  const budget = Math.max(4, MAX_PLAN_ITEMS - plan.items.length);
  const ranked = candidates
    .map((it, idx) => ({ it, idx }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.it.priority] - PRIORITY_RANK[b.it.priority] ||
        a.idx - b.idx,
    );
  const keptItems = ranked.slice(0, budget).map((x) => x.it);
  // Restore original refiner order for the kept subset (stable, readable plan).
  const keptIds = new Set(keptItems.map((i) => i.id));
  const newItems = candidates.filter((i) => keptIds.has(i.id));
  // Drop journeys that ended up with no covering item (deduped or trimmed away)
  // — an orphan journey would show as an empty matrix row with nothing to run.
  const linkedJourneyIds = new Set(
    newItems.map((i) => i.journeyId).filter(Boolean) as string[],
  );
  const admittedJourneys = newJourneys.filter((j) =>
    linkedJourneyIds.has(j.id),
  );

  return {
    plan: {
      ...plan,
      journeys: [...plan.journeys, ...admittedJourneys],
      items: [...plan.items, ...newItems],
    },
    addedJourneys: admittedJourneys.length,
    addedItems: newItems.length,
    trimmed: candidates.length - newItems.length,
  };
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
    "This is a NEGATIVE test. Drive the form(s) through the invalid-input matrix in the scenario (empty, boundary, wrong type, XSS-payload-as-inert-text). Assert validation feedback appears and no invalid submission succeeds. When a valid control case creates a record, make its unique field per-run unique (see below).",
  hybrid:
    "This is a HYBRID test. Where the scenario says to verify via API, use the page's fetch from the browser context (const res = await page.evaluate(...fetch...)) against the same origin and assert on the JSON, in addition to UI assertions.",
  journey:
    "This is a BUSINESS-OUTCOME JOURNEY. Complete the full flow and then PROVE the outcome per the end-state verification (assert the persisted result is visible: updated balance, created record in a list, confirmation with a real identifier). A success toast alone is insufficient. If the flow creates a record with a uniqueness-constrained field (email/name/slug), generate that value at runtime with a unique suffix (e.g. `item-` + Date.now().toString(36)) so the journey stays green on every re-run instead of failing on 'already exists'.",
};

export function buildGeneratorPrompt(opts: {
  item: QaPlanItem;
  plan: QaTestPlan;
  targetUrl: string;
  credentials?: { email: string; password: string };
  /** When qa_login captured a session, tests start authenticated via setup
   *  steps — the generator must not script a login (and gets no plaintext
   *  credentials). */
  auth?: { preAuthenticated: boolean };
  /** How the app authenticates, resolved by qa_login. Passed so the generator
   *  always knows the auth story of the page it's exploring — the login page it
   *  will be redirected to if the session lapses, and the sign-up page for
   *  register/onboarding scenarios. Never URL-guessed (DOM-observed). */
  loginContext?: { loginUrl?: string; signupUrl?: string };
}): string {
  const { item, plan } = opts;
  const groups = itemGroups(item);
  const journey = item.journeyId
    ? plan.journeys.find((j) => j.id === item.journeyId)
    : undefined;
  const parts: string[] = [];
  parts.push(`Test: ${item.title}`);
  parts.push(
    `Coverage group${groups.length > 1 ? "s" : ""}: ${groups.join(" + ")} · Priority: ${item.priority}`,
  );
  if (item.pagePath) parts.push(`Page under test: ${item.pagePath}`);
  // Multi-group items get every group's guidance (canonical order, primary
  // first — itemGroups guarantees that), so one test serves all its tags.
  for (const group of groups) {
    const guidance = GROUP_GENERATION_GUIDANCE[group];
    if (guidance) parts.push(guidance);
  }
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
  const login = opts.loginContext;
  const loginRef = login?.loginUrl
    ? ` The app's login page is ${login.loginUrl}${login.signupUrl ? ` and its sign-up page is ${login.signupUrl}` : ""} (DOM-observed).`
    : "";
  if (opts.auth?.preAuthenticated) {
    parts.push(
      `The browser session starts already authenticated — a stored login session is applied as a setup step before the test runs. Do NOT write login steps; navigate straight to the page under test. If you are unexpectedly redirected to a login page during exploration the injected session lapsed — do not script a manual login to work around it; report it.${loginRef}`,
    );
  } else if (opts.credentials) {
    parts.push(
      `If the scenario requires authentication, log in first${login?.loginUrl ? ` at ${login.loginUrl}` : ""} with email "${opts.credentials.email}" and password "${opts.credentials.password}".${login?.signupUrl ? ` The sign-up page is ${login.signupUrl}.` : ""}`,
    );
  } else if (loginRef) {
    // Public-surface run: no session, no creds — still tell the generator where
    // auth lives so login/register/forgot-password scenarios ground correctly.
    parts.push(
      `No authenticated session is available for this run.${loginRef}`,
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
  // A multi-group test counts toward EVERY group it is tagged with — per-group
  // buckets measure coverage, not test count (top-level totals stay per-test).
  for (const item of items) {
    for (const group of itemGroups(item)) {
      const bucket = (byGroup[group] ??= emptyBucket());
      bucket.planned += 1;
    }
  }
  let generatedCount = 0;
  let covered = 0;
  let passed = 0;
  let failed = 0;
  let healed = 0;
  for (const g of generated) {
    const groups = g.groups?.length ? g.groups : [g.group];
    const buckets = groups.map((grp) => (byGroup[grp] ??= emptyBucket()));
    if (g.status === "covered") {
      covered += 1;
      for (const bucket of buckets) bucket.covered += 1;
      continue;
    }
    if (g.status !== "generation_failed" && g.status !== "generating") {
      generatedCount += 1;
      for (const bucket of buckets) bucket.generated += 1;
    }
    if (g.status === "passed" || g.status === "healed") {
      passed += 1;
      for (const bucket of buckets) bucket.passed += 1;
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
    const entry = ledgerByItem.get(item.id);
    // A multi-group test marks every group column it is tagged with.
    for (const group of itemGroups(item)) {
      const cell = (row[group] ??= {
        planned: 0,
        covered: 0,
        generated: 0,
        passed: 0,
      });
      cell.planned += 1;
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
