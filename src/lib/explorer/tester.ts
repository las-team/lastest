import { chromium, type Page } from "playwright";
import { generateWithAI } from "@/lib/ai";
import type { AIProviderConfig } from "@/lib/ai";
import { parseAiJson } from "@/lib/ai/json-parse";
import type {
  ExplorerActionLog,
  ExplorerActionStep,
  ExplorerScenario,
  KnowledgePageAutomationStep,
} from "@/lib/db/schema";
import { hashState } from "./state";
import { isActionLooping, MAX_ACTIONS_PER_SCENARIO } from "./supervisor";

/**
 * Explorer tester: executes one scenario against the live EB, AI-in-the-loop.
 * Each turn the host extracts a compact interactable snapshot of the current
 * page, asks the model for the SINGLE next action as JSON, executes it with
 * Playwright over CDP, and repeats until the model declares pass/fail or the
 * step budget runs out. Strategic control stays deterministic (host-side
 * budgets, loop detection, evidence capture); only the tactical "what next"
 * is AI-driven — which keeps every provider supported and yields an exact
 * action log for findings and keep-as-test.
 */

const ACTION_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 5_000;

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

interface NextAction {
  intent: string;
  action:
    | "click"
    | "fill"
    | "select"
    | "press"
    | "navigate"
    | "wait"
    | "pass"
    | "fail";
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
    [
      "click",
      "fill",
      "select",
      "press",
      "navigate",
      "wait",
      "pass",
      "fail",
    ].includes(v.action)
  );
}

/** Compact interactable-elements snapshot for the tester prompt. Distinct
 *  from the research map: includes live visibility + current URL each turn. */
async function snapshotInteractables(page: Page): Promise<string> {
  const snap = await page.evaluate(() => {
    const text = (el: Element | null): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const vis = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const sel = (el: Element): string => {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      const tid = el.getAttribute("data-testid");
      if (tid) return `[data-testid="${tid}"]`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      const t = text(el).slice(0, 40);
      if (t) return `text=${t}`;
      return el.tagName.toLowerCase();
    };
    const items: string[] = [];
    document
      .querySelectorAll(
        "a[href],button,[role=button],input,select,textarea,[role=tab],[role=menuitem],[role=checkbox]",
      )
      .forEach((el) => {
        if (items.length >= 60 || !vis(el)) return;
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type");
        const label =
          text(el) ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("value") ||
          "";
        items.push(
          `${tag}${type ? `[${type}]` : ""} "${label.slice(0, 50)}" → ${sel(el)}`,
        );
      });
    const headings = Array.from(document.querySelectorAll("h1,h2"))
      .map((h) => text(h))
      .filter(Boolean)
      .slice(0, 6);
    const alerts = Array.from(
      document.querySelectorAll(
        '[role=alert],.error,.alert,[aria-invalid="true"]',
      ),
    )
      .map((e) => text(e))
      .filter(Boolean)
      .slice(0, 6);
    return { items, headings, alerts, title: document.title };
  });
  const lines = [
    `URL: ${page.url()}`,
    `Title: ${snap.title}`,
    snap.headings.length > 0 ? `Headings: ${snap.headings.join(" | ")}` : "",
    snap.alerts.length > 0
      ? `Visible alerts/errors: ${snap.alerts.join(" | ")}`
      : "",
    `Interactable elements:\n${snap.items.map((i) => `  ${i}`).join("\n")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Deterministic pre-steps from matched knowledge notes (cookie banners etc). */
async function runPageAutomation(
  page: Page,
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
  page: Page,
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
        if (target.origin !== baseOrigin) {
          return { result: "blocked", note: "cross-origin navigation refused" };
        }
        await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
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
  onStep?: (step: ExplorerActionStep, index: number) => void;
}

export async function runScenario(
  config: AIProviderConfig,
  cdpUrl: string,
  input: RunScenarioInput,
): Promise<ExplorerActionLog> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const steps: ExplorerActionStep[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: ExplorerActionLog["failedRequests"] = [];
  let status: ExplorerActionLog["status"] = "blocked";
  let summary: string | undefined;
  let finalUrl: string | undefined;
  let finalStateHash: string | undefined;

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const baseOrigin = new URL(input.targetUrl).origin;

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

    // Start each scenario from the target page in a known state.
    await page.goto(input.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});
    await runPageAutomation(page, input.pageAutomation);

    for (let turn = 0; turn < MAX_ACTIONS_PER_SCENARIO; turn++) {
      if (input.signal?.aborted) {
        status = "blocked";
        summary = "aborted";
        break;
      }

      const snapshot = await snapshotInteractables(page).catch(
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
        `CURRENT PAGE:\n${snapshot}`,
        `Turn ${turn + 1}/${MAX_ACTIONS_PER_SCENARIO}. Reply with the single next action as JSON.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const raw = await generateWithAI(config, prompt, TESTER_SYSTEM_PROMPT, {
        actionType: "explorer_act",
        repositoryId: input.repositoryId,
        responseFormat: "json_object",
        signal: input.signal,
      });
      const action = parseAiJson(raw, isNextAction, {
        source: "explorer-tester",
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
      const step: ExplorerActionStep = {
        intent: action.intent.slice(0, 200),
        action: action.action,
        selector: action.selector?.slice(0, 200),
        value:
          action.action === "fill" || action.action === "select"
            ? action.value?.slice(0, 200)
            : action.value?.slice(0, 120),
        result: outcome.result,
        note: outcome.note ?? action.note?.slice(0, 200),
      };
      steps.push(step);
      input.onStep?.(step, steps.length - 1);

      if (isActionLooping(steps)) {
        status = "stuck";
        summary = "tester repeated the same action without progress";
        break;
      }
    }

    if (status === "blocked" && steps.length >= MAX_ACTIONS_PER_SCENARIO) {
      status = "stuck";
      summary = "action budget exhausted before an outcome";
    }

    finalUrl = page.url();
    const headings = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("h1,h2")).map((h) => ({
          level: Number(h.tagName[1]),
          text: (h.textContent ?? "").replace(/\s+/g, " ").trim(),
        })),
      )
      .catch(() => [] as Array<{ level: number; text: string }>);
    finalStateHash = hashState(finalUrl, headings);
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    scenarioId: input.scenario.id,
    status,
    steps,
    consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    failedRequests: failedRequests.length > 0 ? failedRequests : undefined,
    finalStateHash,
    finalUrl,
    summary,
  };
}
