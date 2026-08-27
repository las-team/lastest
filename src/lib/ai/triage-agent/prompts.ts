/**
 * Prompt builders for the Triage agent's single build-scoped LLM pass.
 *
 * This pass REPLACES the two per-item passes that used to run at build
 * completion (one per visual diff, one per failed test). The model never sees a
 * bare list of failures: it receives the deterministic clusters from
 * `clusterDeterministically` and is asked to *name, narrate and refine* them.
 * That keeps the expensive step to judgement and keeps the grouping
 * reproducible when the model is unavailable.
 */

import type { ClusterResult, TriageCandidate } from "@lastest/triage-model";
import type { ChangeMap } from "@/lib/db/schema";

/** Everything one triage pass is given. */
export interface TriagePromptInput {
  /** Repo/branch context for the narrative's voice. */
  branch?: string | null;
  /** Every failed / review-required case in the build. */
  candidates: readonly TriageCandidate[];
  /** The deterministic pre-pass output the model refines. */
  clusters: ClusterResult;
  /** `build_change_maps.payload`, when the build has one. */
  changeMap?: Pick<ChangeMap, "files" | "areas" | "intentSummary"> | null;
}

export const TRIAGE_SYSTEM_PROMPT = `You are the triage lead for a visual-regression and end-to-end test platform. A build just finished. You are given every failed or review-required case in it, plus deterministic clusters computed from error signatures, overlapping changed screen regions, and spec/browser sets.

Your job is to explain the run by ROOT CAUSE, not by test name. Reviewers should be able to read your output top-to-bottom and understand what happened without opening a single screenshot.

For each cluster decide a "kind":
- "regression"  — a genuine bug in the application; the test correctly caught it.
- "flake"       — an unreliable test that fails intermittently with no real app issue (timeouts, races, alternating pass/fail history).
- "noise"       — the pixels changed but nothing meaningful did (anti-aliasing, sub-pixel text, animation frames, timestamps).
- "maintenance" — the app changed intentionally and the test/baseline is now stale (moved selectors, new copy, redesigned layout).
- "environment" — the environment is broken, not the product (connection refused, auth expired, missing config).
- "unknown"     — you genuinely cannot tell.

You may MERGE deterministic clusters that share one cause, or SPLIT one that clearly contains two causes, by listing the case ids you want in each of your groups. Every case id you are given must appear in exactly one group. Never invent a case id.

Confidence is an integer 0-100. Be honest: a cluster you are guessing at is 30, not 80.

Respond with ONLY a JSON object of this exact shape, no prose, no markdown fencing:
{
  "headline": "<one sentence thesis for the whole run>",
  "summary": "<2-4 sentences: what happened, what is most likely responsible, what to look at first>",
  "groups": [
    {
      "key": "<the deterministic cluster key you started from, or a new short kebab-case slug for a merge/split>",
      "headline": "<short noun phrase, e.g. 'Completed-row layout shifted'>",
      "note": "<1-2 sentences explaining the shared cause>",
      "kind": "regression" | "flake" | "noise" | "maintenance" | "environment" | "unknown",
      "confidence": <0-100>,
      "caseIds": ["<case id>", "..."]
    }
  ],
  "cases": [
    { "id": "<case id>", "note": "<one short sentence specific to this case>", "confidence": <0-100> }
  ]
}`;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function renderCandidate(c: TriageCandidate): string {
  const bits: string[] = [
    `  - id: ${c.id}`,
    `    test: ${c.testName ?? c.testId}${c.stepLabel ? ` [step: ${c.stepLabel}]` : ""}`,
    `    status: ${c.status}${c.browser ? `, browser: ${c.browser}` : ""}`,
  ];
  if (c.specFile) bits.push(`    spec: ${c.specFile}`);
  if (c.errorMessage)
    bits.push(
      `    error: ${truncate(c.errorMessage.replace(/\s+/g, " "), 400)}`,
    );
  if (c.diffPercentage != null)
    bits.push(`    diff: ${c.diffPercentage}% of pixels changed`);
  if (c.changedRegions?.length)
    bits.push(
      `    changed regions: ${c.changedRegions
        .slice(0, 6)
        .map(
          (r) =>
            `(${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)})`,
        )
        .join(" ")}`,
    );
  if (c.layers?.length) bits.push(`    layers flagged: ${c.layers.join(", ")}`);
  if (c.history) {
    const h = c.history;
    const parts: string[] = [];
    if (h.buildsSeen != null) parts.push(`seen in ${h.buildsSeen} recent runs`);
    if (h.consecutiveFailures != null)
      parts.push(`${h.consecutiveFailures} consecutive failing runs`);
    if (h.flakyRate != null)
      parts.push(`flip rate ${Math.round(h.flakyRate * 100)}%`);
    if (parts.length) bits.push(`    history: ${parts.join(", ")}`);
  }
  return bits.join("\n");
}

function renderClusters(input: TriagePromptInput): string {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const lines = input.clusters.groups.map((g) => {
    const detail = [
      `  - key: ${g.key}`,
      `    grouped because: ${g.reason}`,
      `    cases: ${g.candidateIds.join(", ")}`,
    ];
    if (g.errorSignature)
      detail.push(`    shared error signature: ${g.errorSignature}`);
    if (g.browsers.length)
      detail.push(`    browsers: ${g.browsers.join(", ")}`);
    if (g.layers.length) detail.push(`    layers: ${g.layers.join(", ")}`);
    if (g.specFiles.length)
      detail.push(`    spec files: ${g.specFiles.slice(0, 6).join(", ")}`);
    const names = g.candidateIds
      .map((id) => byId.get(id)?.testName)
      .filter(Boolean)
      .slice(0, 6);
    if (names.length) detail.push(`    tests: ${names.join(", ")}`);
    return detail.join("\n");
  });
  if (input.clusters.ungrouped.length) {
    lines.push(
      `  - key: (ungrouped)\n    cases: ${input.clusters.ungrouped.join(", ")}\n    note: no deterministic pass paired these with anything — decide for yourself whether they belong with a cluster above or stand alone.`,
    );
  }
  return lines.join("\n") || "  (none)";
}

function renderChangeMap(input: TriagePromptInput): string {
  const cm = input.changeMap;
  if (!cm) return "No change map available for this build.";
  const files = (cm.files ?? [])
    .slice(0, 40)
    .map((f) => `  ${f.status} ${f.path} (+${f.insertions}/-${f.deletions})`)
    .join("\n");
  const areas = (cm.areas ?? [])
    .slice(0, 20)
    .map((a) => `  - ${a.areaName} (risk: ${a.risk})`)
    .join("\n");
  return [
    cm.intentSummary ? `intent: ${cm.intentSummary}` : null,
    files ? `changed files (${cm.files?.length ?? 0}):\n${files}` : null,
    areas ? `affected areas:\n${areas}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTriageUserPrompt(input: TriagePromptInput): string {
  return [
    input.branch ? `branch: ${input.branch}` : null,
    `\ncases (${input.candidates.length}):\n${input.candidates.map(renderCandidate).join("\n")}`,
    `\ndeterministic clusters (${input.clusters.groups.length}):\n${renderClusters(input)}`,
    `\nbuild change map:\n${renderChangeMap(input)}`,
    `\nEvery one of the ${input.candidates.length} case ids above must appear in exactly one group in your response, and should also appear once in "cases". Respond with the JSON object described in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");
}
