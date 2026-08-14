import { generateWithAI } from "@/lib/ai";
import type { AIProviderConfig } from "@/lib/ai";
import { parseAiJson } from "@/lib/ai/json-parse";
import type { ExplorerScenario, ExplorerStyle } from "@/lib/db/schema";
import type { RangerPageMap } from "@/lib/playwright/ranger";
import { condensePageMap } from "./research";
import { STYLE_FRAGMENTS } from "./styles";
import { MAX_SCENARIOS_PER_ITERATION } from "./supervisor";

/**
 * Explorer planner: one AI call per iteration turning the current page map
 * (+ memory + coverage) into a handful of exploratory scenarios in the
 * iteration's planning style. No browser access — plain JSON generation.
 */

const PLANNER_SYSTEM_PROMPT = `You are an exploratory QA planner. Given a rendered page map of a web app, draft test scenarios a skilled manual tester would run RIGHT NOW on this page.

Rules:
- Base scenarios ONLY on elements listed in the page map. Never invent controls.
- Each scenario is 2-6 concrete steps a tester performs on THIS page (navigation to a directly-linked page is allowed).
- Every scenario states an expected outcome that can be verified from the UI.
- Skip anything the coverage section already covers — mark nothing twice.
- NEVER plan destructive account-level actions (delete account, cancel subscription) or real payments.
- Respond with JSON only: {"scenarios": [{"title": string, "steps": string[], "rationale": string, "expectedOutcome": string}]}
- At most ${MAX_SCENARIOS_PER_ITERATION} scenarios. Fewer, sharper scenarios beat many shallow ones.`;

export interface PlanScenariosInput {
  pageMap: RangerPageMap;
  style: ExplorerStyle;
  iteration: number;
  knowledgeBlock: string;
  experienceBlock: string;
  coverageDigest: string;
  /** Titles of scenarios already executed this session (avoid repeats). */
  priorScenarioTitles: string[];
  repositoryId: string;
  signal?: AbortSignal;
  onLogCreated?: (logId: string) => void;
}

function isPlannerOutput(
  value: unknown,
): value is { scenarios: Array<Record<string, unknown>> } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { scenarios?: unknown }).scenarios)
  );
}

export async function planScenarios(
  config: AIProviderConfig,
  input: PlanScenariosInput,
): Promise<ExplorerScenario[]> {
  const sections = [
    STYLE_FRAGMENTS[input.style],
    `CURRENT PAGE MAP:\n${condensePageMap(input.pageMap)}`,
  ];
  if (input.knowledgeBlock) sections.push(input.knowledgeBlock);
  if (input.experienceBlock) sections.push(input.experienceBlock);
  sections.push(
    `COVERAGE (skip what is already covered):\n${input.coverageDigest}`,
  );
  if (input.priorScenarioTitles.length > 0) {
    sections.push(
      `SCENARIOS ALREADY RUN THIS SESSION (do not repeat):\n${input.priorScenarioTitles
        .slice(-30)
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }
  sections.push(
    `Draft up to ${MAX_SCENARIOS_PER_ITERATION} scenarios in the style above. JSON only.`,
  );

  const raw = await generateWithAI(
    config,
    sections.join("\n\n"),
    PLANNER_SYSTEM_PROMPT,
    {
      actionType: "explorer_plan",
      repositoryId: input.repositoryId,
      responseFormat: "json_object",
      signal: input.signal,
      onLogCreated: input.onLogCreated,
    },
  );

  const parsed = parseAiJson(raw, isPlannerOutput, {
    source: "explorer-planner",
  });
  if (!parsed) return [];

  return parsed.scenarios
    .slice(0, MAX_SCENARIOS_PER_ITERATION)
    .map((s, i): ExplorerScenario | null => {
      const title = typeof s.title === "string" ? s.title.trim() : "";
      const steps = Array.isArray(s.steps)
        ? s.steps.filter((x): x is string => typeof x === "string").slice(0, 8)
        : [];
      if (!title || steps.length === 0) return null;
      return {
        id: `it${input.iteration}-s${i}-${crypto.randomUUID().slice(0, 8)}`,
        title: title.slice(0, 160),
        style: input.style,
        steps,
        rationale:
          typeof s.rationale === "string" ? s.rationale.slice(0, 400) : "",
        expectedOutcome:
          typeof s.expectedOutcome === "string"
            ? s.expectedOutcome.slice(0, 400)
            : undefined,
      };
    })
    .filter((s): s is ExplorerScenario => s !== null);
}
