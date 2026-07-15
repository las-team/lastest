import type {
  ExplorerActionLog,
  ExplorerActionStep,
  ExplorerScenario,
} from "@/lib/db/schema";

/**
 * Keep-as-test: render a passing exploratory scenario's action log into a
 * runnable test in the runner contract format
 * (`export async function test(page, baseUrl, screenshotPath, stepLogger)`).
 * Deterministic — the explorer's log already carries verified selectors and
 * values, so no AI (and no request auth context) is needed in the detached
 * pipeline. Generated tests are created quarantined for human review.
 */

function jsString(value: string): string {
  return JSON.stringify(value);
}

function lineFor(step: ExplorerActionStep): string[] {
  const sel = step.selector ? jsString(step.selector) : null;
  switch (step.action) {
    case "click":
      return sel
        ? [`await page.locator(${sel}).first().click({ timeout: 10000 });`]
        : [];
    case "fill":
      return sel
        ? [
            `await page.locator(${sel}).first().fill(${jsString(step.value ?? "")}, { timeout: 10000 });`,
          ]
        : [];
    case "select":
      return sel
        ? [
            `await page.locator(${sel}).first().selectOption(${jsString(step.value ?? "")}, { timeout: 10000 });`,
          ]
        : [];
    case "press":
      return [`await page.keyboard.press(${jsString(step.value || "Enter")});`];
    case "navigate":
      return [
        `await page.goto(new URL(${jsString(step.value ?? "/")}, baseUrl).href, { waitUntil: 'domcontentloaded' });`,
      ];
    case "wait":
      return [
        `await page.waitForTimeout(${Math.min(Number(step.value ?? 1) * 1000, 8000)});`,
      ];
    default:
      return [];
  }
}

export function renderKeptTestCode(
  scenario: ExplorerScenario,
  log: ExplorerActionLog,
  targetUrl: string,
): string {
  const body: string[] = [];
  let shotIndex = 1;

  // Only replay actions that succeeded — blocked/error steps were dead ends
  // the tester recovered from, not part of the passing flow.
  const steps = log.steps.filter((s) => s.result === "ok");

  for (const step of steps) {
    const code = lineFor(step);
    if (code.length === 0) continue;
    body.push(`  stepLogger.log(${jsString(step.intent || step.action)});`);
    for (const line of code) body.push(`  ${line}`);
    body.push(`  await settle();`);
    // Screenshot checkpoints after state-changing actions.
    if (["click", "navigate", "press", "select"].includes(step.action)) {
      body.push(
        `  await page.screenshot({ path: shot(${shotIndex}, ${jsString(
          step.action,
        )}), fullPage: true });`,
      );
      shotIndex++;
    }
    body.push("");
  }

  const header = [
    `// Kept by the Explorer agent from a passing exploratory scenario.`,
    `// Scenario: ${scenario.title.replace(/\n/g, " ")}`,
    scenario.expectedOutcome
      ? `// Expected outcome: ${scenario.expectedOutcome.replace(/\n/g, " ")}`
      : null,
    log.summary ? `// Observed: ${log.summary.replace(/\n/g, " ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(function () {});
    await page.waitForTimeout(300);
  }

  stepLogger.log('Open target page');
  await page.goto(${jsString(targetUrl)}, { waitUntil: 'domcontentloaded' });
  await settle();
  await page.screenshot({ path: shot(0, 'start'), fullPage: true });

${body.join("\n")}
  await page.screenshot({ path: shot(${shotIndex}, 'end'), fullPage: true });
}
`;
}

/** A log is keepable when it passed and actually did something replayable. */
export function isKeepable(log: ExplorerActionLog): boolean {
  return (
    log.status === "passed" &&
    log.steps.filter((s) => s.result === "ok").length >= 2
  );
}
