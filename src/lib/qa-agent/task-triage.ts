import type { QaPlanItem, QaTestGroup, QaTestPlan } from "@/lib/db/schema";
import { QA_GROUPS } from "./plan";

/**
 * Direct-the-agent triage — pure helpers for routing a task-queue directive.
 *
 * When the dispatcher claims a task it runs one small, logged AI call built
 * from these prompts to decide the protocol:
 *
 *   targeted  the directive names concrete coverage (a flow, page, form, or
 *             scenario) the generator can produce directly as 1–3 tests
 *   explore   the directive is broad/open-ended — the scout must re-discover
 *             the app and the planner must design coverage before generating
 *
 * Deterministic and side-effect free, mirroring plan.ts, so it unit-tests
 * without a DB, browser, or AI provider. The orchestrator
 * (src/server/actions/qa-agent.ts) wires these into dispatchNextQaTask.
 */

/** Hard cap on tests one directive may synthesize without a stored plan —
 *  targeted means targeted; anything larger must triage as "explore". */
export const MAX_TRIAGE_TESTS = 3;

export interface TaskTriageTest {
  title: string;
  scenario: string;
  pagePath?: string;
  group?: QaTestGroup;
}

export interface TaskTriageResult {
  scope: "targeted" | "explore";
  reason: string;
  tests: TaskTriageTest[];
}

function isTriageTest(v: unknown): v is TaskTriageTest {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  if (typeof t.title !== "string" || !t.title.trim()) return false;
  if (typeof t.scenario !== "string" || !t.scenario.trim()) return false;
  if (t.pagePath !== undefined && typeof t.pagePath !== "string") return false;
  if (t.group !== undefined && typeof t.group !== "string") return false;
  return true;
}

export function isTaskTriageResult(v: unknown): v is TaskTriageResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r.scope !== "targeted" && r.scope !== "explore") return false;
  if (typeof r.reason !== "string" || !r.reason.trim()) return false;
  if (!Array.isArray(r.tests) || !r.tests.every(isTriageTest)) return false;
  return true;
}

/** First concrete reason a value fails isTaskTriageResult, for retry prompts. */
export function explainInvalidTaskTriage(v: unknown): string | null {
  if (!v || typeof v !== "object")
    return "top-level value is not a JSON object";
  const r = v as Record<string, unknown>;
  if (r.scope !== "targeted" && r.scope !== "explore") {
    return '"scope" must be exactly "targeted" or "explore"';
  }
  if (typeof r.reason !== "string" || !r.reason.trim()) {
    return '"reason" must be a non-empty string';
  }
  if (!Array.isArray(r.tests)) {
    return '"tests" must be an array (use [] for scope "explore")';
  }
  const bad = r.tests.findIndex((t) => !isTriageTest(t));
  if (bad !== -1) {
    return `tests[${bad}] is malformed — each test needs a non-empty title and scenario (pagePath and group are optional strings)`;
  }
  return null;
}

export function buildTaskTriageSystemPrompt(): string {
  return `You are the dispatcher for an autonomous QA agent. The team drops plain-language directives ("Cover the billing flow with an expired card", "Audit accessibility everywhere") and you decide how the agent should work each one.

Scopes:
- "targeted": the directive asks for specific, nameable coverage — a concrete flow, page, form, or scenario the agent can honestly cover with 1-${MAX_TRIAGE_TESTS} tests. This is the right call for most directives.
- "explore": the directive is broad or open-ended (whole areas, "everything", "audit", "increase coverage across ..."), or it needs pages/flows that are not in the provided context. The agent will re-crawl the app and build a full test plan before generating.

OUTPUT: a single JSON object, no markdown fences, no commentary, matching exactly:
{"scope": "targeted"|"explore", "reason": string, "tests": [{"title": string, "scenario": string, "pagePath": string?, "group": string?}]}

RULES:
- "reason": one sentence explaining the routing decision — it is logged for the team to review.
- For "targeted": 1-${MAX_TRIAGE_TESTS} tests. Each "scenario" must be concrete and executable: the numbered actions to take plus the end-state verification that proves the outcome beyond a toast. Ground "pagePath" in the KNOWN PAGES list or in a route the directive itself names (parameterized segments like /builds/:id are fine — the test navigates to a real instance); omit it when unsure — never invent routes.
- "group", when set, must be one of the selected coverage group ids.
- For "explore": "tests" must be [].
- When a directive names one flow but implies many variants ("all edge cases of checkout"), stay "targeted" only if ${MAX_TRIAGE_TESTS} tests can honestly cover it; otherwise choose "explore".`;
}

export function buildTaskTriageUserPrompt(opts: {
  directive: string;
  groups: QaTestGroup[];
  /** Titles of the stored plan's journeys + items, when a plan exists. */
  existingPlanDigest?: string;
  /** Page paths the stored plan already targets — grounding for pagePath. */
  knownPagePaths?: string[];
  authenticated: boolean;
}): string {
  const groupList = opts.groups
    .map((g) => {
      const meta = QA_GROUPS.find((m) => m.id === g);
      return `- ${g}: ${meta?.description ?? ""}`;
    })
    .join("\n");
  return [
    `Route the directive below and, when targeted, spell out the covering tests.`,
    `Selected coverage groups:\n${groupList}`,
    opts.authenticated
      ? "Authenticated session available: YES — generated tests run signed in, so in-app flows are fair game."
      : "Authenticated session available: NO — public surface only.",
    `--- DIRECTIVE ---\n${opts.directive}`,
    opts.existingPlanDigest
      ? `--- EXISTING PLAN (context — the agent can extend it) ---\n${opts.existingPlanDigest}`
      : `--- EXISTING PLAN ---\n(none — this repository has no stored test plan yet)`,
    opts.knownPagePaths?.length
      ? `--- KNOWN PAGES ---\n${opts.knownPagePaths.map((p) => `- ${p}`).join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Turn a targeted triage's tests into plan items for a directive-only run.
 *  Ids are D-prefixed so they can't collide with planner (T… / U…) ids;
 *  groups outside the repo's selection fall back to the first selected
 *  group. */
export function triageTestsToPlanItems(
  tests: TaskTriageTest[],
  groups: QaTestGroup[],
): QaPlanItem[] {
  const allowed: QaTestGroup[] = groups.length ? groups : ["journey"];
  return tests.slice(0, MAX_TRIAGE_TESTS).map((t, i) => {
    const group = t.group && allowed.includes(t.group) ? t.group : allowed[0];
    return {
      id: `D${i + 1}`,
      group,
      groups: [group],
      title: t.title.trim(),
      priority: "P1" as const,
      pagePath: t.pagePath?.trim() || undefined,
      scenario: t.scenario.trim(),
      rationale: "Direct-the-agent directive",
    };
  });
}

/** Minimal plan wrapping a directive's items so the fill_gaps pipeline
 *  (generate → execute → heal → summary) can run without a stored plan. */
export function buildTaskPlanFromTriage(
  directive: string,
  items: QaPlanItem[],
): QaTestPlan {
  return {
    appProfile: {
      summary: `Task-scoped plan for a single team directive: ${directive.slice(0, 200)}`,
    },
    journeys: [],
    items,
  };
}
