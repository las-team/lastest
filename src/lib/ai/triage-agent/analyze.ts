/**
 * The Triage agent's single build-scoped AI pass.
 *
 * One call per build, replacing the per-diff `diff-analyzer` pass and the
 * per-failed-test `failure-triage` pass. Provider routing follows the same
 * shape as `change-map-analyzer.ts` / the retired `diff-analyzer.ts`:
 * `aiConfigFromSettings` + `checkAiConfigReadiness` + `generateWithAI` +
 * `parseAiJson`.
 *
 * It NEVER throws. Every unhappy path (AI off for the team, provider not
 * runnable here, unparseable response, provider error) returns a `skipped`
 * result with a reason, and the caller falls back to the deterministic
 * clusters. The Run Results screen is never empty just because AI is off.
 */

import { generateWithAI } from "@/lib/ai";
import { checkAiConfigReadiness } from "@/lib/ai/availability";
import { parseAiJson } from "@/lib/ai/json-parse";
import { aiConfigFromSettings, aiModelId } from "@/lib/ai/provider-config";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type { TriageGroupKind } from "@lastest/triage-model";

import {
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
  type TriagePromptInput,
} from "./prompts";

const log = getLogger("Triage");

export interface TriageAnalysisGroup {
  /** Deterministic cluster key, or a new slug when the model merged/split. */
  key: string;
  headline: string;
  note: string;
  kind: TriageGroupKind;
  /** 0-100. */
  confidence: number;
  /** Final membership — candidate ids. */
  caseIds: string[];
}

export interface TriageAnalysisCase {
  id: string;
  note: string;
  /** 0-100. */
  confidence: number;
}

export interface TriageAnalysis {
  /** `completed` = the model answered; `skipped` = fall back to the pre-pass. */
  status: "completed" | "skipped";
  /** Populated whenever `status` is `skipped`. */
  skippedReason?: string;
  modelId?: string;
  headline?: string;
  summary?: string;
  groups: TriageAnalysisGroup[];
  cases: TriageAnalysisCase[];
}

export interface TriageAnalysisInput extends TriagePromptInput {
  repositoryId: string;
}

const VALID_KINDS: ReadonlySet<string> = new Set<TriageGroupKind>([
  "regression",
  "flake",
  "noise",
  "maintenance",
  "environment",
  "unknown",
]);

function skipped(reason: string): TriageAnalysis {
  return { status: "skipped", skippedReason: reason, groups: [], cases: [] };
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Tolerate a model that answered 0..1 instead of 0..100.
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Normalize the model's answer against the ids we actually sent. Any id the
 * model invented is dropped; any id it forgot is left for the caller to place
 * back onto its deterministic cluster.
 */
function normalize(
  parsed: Record<string, unknown>,
  knownIds: ReadonlySet<string>,
): Omit<TriageAnalysis, "status" | "modelId"> {
  const seen = new Set<string>();

  const groups: TriageAnalysisGroup[] = Array.isArray(parsed.groups)
    ? parsed.groups
        .map((raw): TriageAnalysisGroup | null => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          const key = str(r.key, 64);
          if (!key) return null;
          const caseIds = Array.isArray(r.caseIds)
            ? r.caseIds.filter(
                (id): id is string =>
                  typeof id === "string" && knownIds.has(id) && !seen.has(id),
              )
            : [];
          for (const id of caseIds) seen.add(id);
          if (caseIds.length === 0) return null;
          const kind = str(r.kind, 32);
          return {
            key,
            headline: str(r.headline, 200) || "Unnamed cluster",
            note: str(r.note, 1000),
            kind: (VALID_KINDS.has(kind) ? kind : "unknown") as TriageGroupKind,
            confidence: clampConfidence(r.confidence),
            caseIds,
          };
        })
        .filter((g): g is TriageAnalysisGroup => g !== null)
    : [];

  const cases: TriageAnalysisCase[] = Array.isArray(parsed.cases)
    ? parsed.cases
        .map((raw): TriageAnalysisCase | null => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          const id = str(r.id, 200);
          if (!id || !knownIds.has(id)) return null;
          return {
            id,
            note: str(r.note, 600),
            confidence: clampConfidence(r.confidence),
          };
        })
        .filter((c): c is TriageAnalysisCase => c !== null)
    : [];

  return {
    headline: str(parsed.headline, 300) || undefined,
    summary: str(parsed.summary, 2000) || undefined,
    groups,
    cases,
  };
}

export async function runTriageAnalysis(
  input: TriageAnalysisInput,
): Promise<TriageAnalysis> {
  if (input.candidates.length === 0) {
    return skipped("no failed or review-required cases in this build");
  }

  try {
    // MCP-first: background AI only runs when the team switched built-in AI on.
    if (!(await queries.getInProductAiEnabled(input.repositoryId))) {
      return skipped("in-product AI is not enabled for this team");
    }

    const settings = await queries.getAISettings(input.repositoryId);
    const readiness = checkAiConfigReadiness(settings);
    if (!readiness.runnable) return skipped(readiness.reason);

    const config = aiConfigFromSettings(settings, { readOnly: true });
    const modelId = aiModelId(config);

    const response = await generateWithAI(
      config,
      buildTriageUserPrompt(input),
      TRIAGE_SYSTEM_PROMPT,
      { actionType: "triage", responseFormat: "json_object" },
    );

    // Error messages are attacker-influenced (they can carry page content), so
    // shape-validate rather than trusting the parse.
    const isObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;
    const parsed = parseAiJson(response, isObject, { source: "triage" });
    if (!parsed) return skipped("AI response was not parseable as JSON");

    const knownIds = new Set(input.candidates.map((c) => c.id));
    const normalized = normalize(parsed, knownIds);
    if (normalized.groups.length === 0 && !normalized.summary) {
      return skipped("AI response contained no usable groups");
    }

    return { status: "completed", modelId, ...normalized };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn(
      { err: error, repositoryId: input.repositoryId },
      "triage AI pass failed",
    );
    return skipped(`AI pass failed: ${reason.slice(0, 300)}`);
  }
}
