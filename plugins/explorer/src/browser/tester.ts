import type { AiCapability, BrowserSession } from "@lastest/contracts";
import {
  describeSnapshot,
  interactableSnapshotScript,
} from "@lastest/page-map";

import {
  isActionLooping,
  MAX_ACTIONS_PER_SCENARIO,
} from "../domain/supervisor";
import type {
  ExplorerActionLog,
  ExplorerActionStep,
  ExplorerScenario,
  KnowledgePageAutomationStep,
} from "../types";
import { generateJson } from "../ai/gateway";
import { currentStateHash } from "./research";
import {
  ACTION_TIMEOUT_MS,
  gotoAndSettle,
  NAV_TIMEOUT_MS,
  SETTLE_TIMEOUT_MS,
  type ExplorerPage,
} from "./page";

/**
 * Explorer tester: executes one scenario against a live page, AI-in-the-loop.
 *
 * Each turn the host snapshots the page's interactable elements, asks the model
 * for the SINGLE next action as JSON, executes it, and repeats until the model
 * declares pass/fail or a budget runs out. Strategic control stays
 * deterministic — step budgets, loop detection, evidence capture — and only the
 * tactical "what next" is AI-driven. That split is what keeps every provider
 * supported and yields an exact action log for findings and keep-as-test.
 *
 * The change this migration made: `chromium.connectOverCDP(cdpUrl)` is gone,
 * along with the browser and context lifecycle that came with it. This file now
 * receives pages. It cannot leak one, outlive its deadline, or learn a pod
 * address — which is the honest form of the R4 claim, and all of it comes from
 * *not having the connection*, not from good behaviour.
 */

const TESTER_SYSTEM_PROMPT = `You are an exploratory tester driving a real browser one action at a time.
Each turn you get: the scenario, the actions taken so far with results, and a snapshot of the current page's interactable elements.
Reply with JSON only — the SINGLE next action:
{"intent": string, "action": "click"|"fill"|"select"|"press"|"navigate"|"wait"|"pass"|"fail", "selector"?: string, "value"?: string, "note"?: string}

Rules:
- selector is a CSS selector or text=... / role=... Playwright selector taken from the snapshot. Never invent selectors.
- "fill" needs selector + value. "press" value is a key like "Enter". "navigate" value is a same-origin URL or path.
- Use "pass" when the expected outcome is visibly achieved (note = what you observed proving it).
- Use "fail" when the app misbehaves: broken flow, error page, wrong result, validation that should exist but doesn't (note = what went wrong, be specific).
- If an unexpected modal/cookie banner blocks you, dismiss it first.
- Never perform destructive account-level actions or real payments.`;

const ACTIONS = [
  "click",
  "fill",
  "select",
  "press",
  "navigate",
  "wait",
  "pass",
  "fail",
] as const;

interface NextAction {
  intent: string;
  action: (typeof ACTIONS)[number];
  selector?: string;
  value?: string;
  note?: string;
}

function isNextAction(value: unknown): value is NextAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.intent === "string" &&
    typeof v.action === "string" &&
    (ACTIONS as readonly string[]).includes(v.action)
  );
}

/** Compact interactable snapshot for the prompt. Distinct from the research
 *  map: live visibility + current URL, re-taken every turn. */
async function snapshot(page: ExplorerPage): Promise<string> {
  const snap = await page.evaluate(interactableSnapshotScript);
  return describeSnapshot({ url: page.url(), ...snap });
}

/** Deterministic pre-steps from matched knowledge notes (cookie banners etc). */
async function runPageAutomation(
  page: ExplorerPage,
  steps: KnowledgePageAutomationStep[],
): Promise<void> {
  for (const step of steps) {
    try {
      if (step.action === "wait") {
        await page.waitForTimeout(
          Math.min(Number(step.value ?? 1) * 1000, 10_000),
        );
      } else if (step.action === "waitForSelector" && step.selector) {
        await page.waitForSelector(step.selector, {
          timeout: ACTION_TIMEOUT_MS,
        });
      } else if (step.action === "click" && step.selector) {
        await page.click(step.selector, { timeout: ACTION_TIMEOUT_MS });
      } else if (step.action === "fill" && step.selector) {
        await page.fill(step.selector, step.value ?? "", {
          timeout: ACTION_TIMEOUT_MS,
        });
      }
    } catch {
      // Automation steps are best-effort hints, never fatal.
    }
  }
}

async function executeAction(
  page: ExplorerPage,
  action: NextAction,
  baseOrigin: string,
): Promise<{ result: ExplorerActionStep["result"]; note?: string }> {
  try {
    switch (action.action) {
      case "click":
        if (!action.selector) return { result: "error", note: "no selector" };
        await page
          .locator(action.selector)
          .first()
          .click({ timeout: ACTION_TIMEOUT_MS });
        break;
      case "fill":
        if (!action.selector) return { result: "error", note: "no selector" };
        await page
          .locator(action.selector)
          .first()
          .fill(action.value ?? "", { timeout: ACTION_TIMEOUT_MS });
        break;
      case "select":
        if (!action.selector) return { result: "error", note: "no selector" };
        await page
          .locator(action.selector)
          .first()
          .selectOption(action.value ?? "", { timeout: ACTION_TIMEOUT_MS });
        break;
      case "press":
        await page.keyboard.press(action.value || "Enter");
        break;
      case "navigate": {
        const target = new URL(action.value ?? "/", baseOrigin);
        // The model chose this URL from page content, which the app under test
        // controls. Same-origin is the only thing standing between "explore the
        // app" and "drive an authenticated browser somewhere else".
        if (target.origin !== baseOrigin) {
          return { result: "blocked", note: "cross-origin navigation refused" };
        }
        await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
        break;
      }
      case "wait":
        await page.waitForTimeout(
          Math.min(Number(action.value ?? 1) * 1000, 8_000),
        );
        break;
      default:
        return { result: "error", note: `unknown action ${action.action}` };
    }
    await page
      .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});
    return { result: "ok" };
  } catch (err) {
    return {
      result: "error",
      note: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}

export interface RunScenarioInput {
  scenario: ExplorerScenario;
  targetUrl: string;
  repositoryId: string;
  knowledgeBlock: string;
  pageAutomation: KnowledgePageAutomationStep[];
  signal?: AbortSignal;
}

/** Scenarios in an iteration are independent, and each tester turn is a
 *  blocking AI call — the dominant cost is model latency, not browser CPU. */
export const SCENARIO_CONCURRENCY = 3;

/** Stop early once the app has refused this many actions in a row: the tester
 *  is thrashing against a control that will not budge, and further turns just
 *  burn AI calls. */
const MAX_CONSECUTIVE_FAILURES = 4;

/** Bounded, deduped evidence accumulators. Caps matter: console output is
 *  attacker-influenced, and an unbounded list is a memory footgun on a page
 *  that logs in a render loop. */
function attachObservers(page: ExplorerPage, baseOrigin: string) {
  const consoleErrors: string[] = [];
  const failedRequests: NonNullable<ExplorerActionLog["failedRequests"]> = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error" || consoleErrors.length >= 15) return;
    const text = msg.text().replace(/\s+/g, " ").trim().slice(0, 200);
    if (text && !consoleErrors.includes(text)) consoleErrors.push(text);
  });
  page.on("pageerror", (err) => {
    if (consoleErrors.length >= 15) return;
    const text = `${err.name}: ${err.message}`.slice(0, 200);
    if (!consoleErrors.includes(text)) consoleErrors.push(text);
  });
  page.on("response", (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (type !== "fetch" && type !== "xhr") return;
      if (response.status() < 400 || failedRequests.length >= 20) return;
      const url = new URL(response.url());
      if (url.origin !== baseOrigin) return;
      failedRequests.push({
        url: url.pathname.slice(0, 120),
        status: response.status(),
        method: req.method(),
      });
    } catch {
      // Best-effort observation.
    }
  });

  return { consoleErrors, failedRequests };
}

/**
 * The adaptive loop, run against one page.
 *
 * Page lifetime belongs to the caller (ultimately to core's `withBrowser`
 * scope), so this never closes anything.
 */
export async function runScenarioOnPage(
  ai: AiCapability,
  page: ExplorerPage,
  input: RunScenarioInput,
): Promise<ExplorerActionLog> {
  const steps: ExplorerActionStep[] = [];
  let status: ExplorerActionLog["status"] = "blocked";
  let summary: string | undefined;
  let finalUrl: string | undefined;
  let finalStateHash: string | undefined;
  let consecutiveFailures = 0;
  let observed: ReturnType<typeof attachObservers> | undefined;

  try {
    const baseOrigin = new URL(input.targetUrl).origin;
    observed = attachObservers(page, baseOrigin);

    // Start each scenario from the target page in a known state.
    await gotoAndSettle(page, input.targetUrl);
    await runPageAutomation(page, input.pageAutomation);

    for (let turn = 0; turn < MAX_ACTIONS_PER_SCENARIO; turn++) {
      if (input.signal?.aborted) {
        status = "blocked";
        summary = "aborted";
        break;
      }

      const current = await snapshot(page).catch(
        () => `URL: ${page.url()}\n(snapshot failed)`,
      );
      const history =
        steps.length > 0
          ? steps
              .map(
                (s, i) =>
                  `${i + 1}. [${s.result}] ${s.action}${s.selector ? ` ${s.selector}` : ""}${s.value ? ` = "${s.value.slice(0, 40)}"` : ""} — ${s.intent}${s.note ? ` (${s.note})` : ""}`,
              )
              .join("\n")
          : "(none yet)";

      const prompt = [
        `SCENARIO: ${input.scenario.title}`,
        `Steps to perform:\n${input.scenario.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        input.scenario.expectedOutcome
          ? `Expected outcome: ${input.scenario.expectedOutcome}`
          : "",
        input.knowledgeBlock,
        `ACTIONS TAKEN SO FAR:\n${history}`,
        `CURRENT PAGE:\n${current}`,
        `Turn ${turn + 1}/${MAX_ACTIONS_PER_SCENARIO}. Reply with the single next action as JSON.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const action = await generateJson(ai, {
        prompt,
        systemPrompt: TESTER_SYSTEM_PROMPT,
        actionType: "explorer_act",
        // One call per browser action, dozens per scenario. This is the tier
        // decision that decides whether exploration is affordable at all.
        tier: "fast",
        isValid: isNextAction,
        source: "explorer-tester",
        repositoryId: input.repositoryId,
        signal: input.signal,
      });
      if (!action) {
        status = "blocked";
        summary = "tester returned unparseable action";
        break;
      }

      if (action.action === "pass" || action.action === "fail") {
        status = action.action === "pass" ? "passed" : "failed";
        summary = action.note ?? action.intent;
        break;
      }

      const outcome = await executeAction(page, action, baseOrigin);
      steps.push({
        intent: action.intent.slice(0, 200),
        action: action.action,
        selector: action.selector?.slice(0, 200),
        value:
          action.action === "fill" || action.action === "select"
            ? action.value?.slice(0, 200)
            : action.value?.slice(0, 120),
        result: outcome.result,
        note: outcome.note ?? action.note?.slice(0, 200),
      });

      if (isActionLooping(steps)) {
        status = "stuck";
        summary = "tester repeated the same action without progress";
        break;
      }

      consecutiveFailures =
        outcome.result === "ok" ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        status = "stuck";
        summary = `app refused ${consecutiveFailures} actions in a row`;
        break;
      }
    }

    if (status === "blocked" && steps.length >= MAX_ACTIONS_PER_SCENARIO) {
      status = "stuck";
      summary = "action budget exhausted before an outcome";
    }

    finalUrl = page.url();
    finalStateHash = await currentStateHash(page);
  } catch (err) {
    status = "blocked";
    summary = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }

  return {
    scenarioId: input.scenario.id,
    status,
    steps,
    consoleErrors: observed?.consoleErrors.length
      ? observed.consoleErrors
      : undefined,
    failedRequests: observed?.failedRequests.length
      ? observed.failedRequests
      : undefined,
    finalStateHash,
    finalUrl,
    summary,
  };
}

/**
 * Run a batch of scenarios concurrently on ONE claimed browser.
 *
 * ### Why `isolatedPage()` and not `withBrowserSwarm`
 *
 * The migration brief expected this to map onto `withBrowserSwarm`. It does
 * not, and the difference is the whole reason `BrowserSession.isolatedPage()`
 * exists.
 *
 * These scenarios explore one app behind one login. A swarm gives N *separate*
 * EBs: N pool slots, N streams of metered run-minutes, and N browsers that each
 * need authenticating — and the state they need is the one produced by *this
 * run's* login, which may never have been persisted, so `storageStateId` cannot
 * express it either. `isolatedPage()` mints a fresh context inside the same
 * browser, seeded from the default context's live state, and core closes it
 * when the scope ends. One slot, one meter, identical isolation.
 *
 * So: the contract does cover the storage-state sharing case, just not through
 * the primitive the brief guessed. Reach for `withBrowserSwarm` when the work
 * genuinely needs N browsers; this is not that.
 *
 * Scenario 0 runs on the session's default page so the EB screencast keeps
 * showing something a human can watch.
 */
export async function runScenariosConcurrent(
  ai: AiCapability,
  session: BrowserSession,
  inputs: RunScenarioInput[],
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onComplete?: (
      log: ExplorerActionLog,
      index: number,
    ) => void | Promise<void>;
  } = {},
): Promise<ExplorerActionLog[]> {
  const results: ExplorerActionLog[] = new Array(inputs.length);
  if (inputs.length === 0) return results;

  let next = 0;
  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return;
      const i = next++;
      if (i >= inputs.length) return;
      let log: ExplorerActionLog;
      try {
        const page =
          i === 0
            ? (session.page as ExplorerPage)
            : ((await session.isolatedPage()) as ExplorerPage);
        log = await runScenarioOnPage(ai, page, inputs[i]);
      } catch (err) {
        log = {
          scenarioId: inputs[i].scenario.id,
          status: "blocked",
          steps: [],
          summary: err instanceof Error ? err.message : String(err),
        };
      }
      results[i] = log;
      await opts.onComplete?.(log, i);
    }
  };

  const poolSize = Math.min(
    opts.concurrency ?? SCENARIO_CONCURRENCY,
    inputs.length,
  );
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
