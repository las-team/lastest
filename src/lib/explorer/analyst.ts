import { generateWithAI } from "@/lib/ai";
import type { AIProviderConfig } from "@/lib/ai";
import { parseAiJson } from "@/lib/ai/json-parse";
import type {
  AgentFinding,
  ExplorerFindingKind,
  ExplorerReport,
  ExplorerSeverity,
} from "@/lib/db/schema";

/**
 * Explorer analyst: one AI call at session end clustering raw findings by
 * root cause (three failures on one control = one defect), refining severity,
 * and writing the session assessment. Deterministic fallback: every finding
 * becomes its own cluster.
 */

const ANALYST_SYSTEM_PROMPT = `You are a QA analyst reviewing raw findings from an exploratory testing session.
Cluster findings that share a single root cause (e.g. three validation failures on one form = one defect). Separate real product defects from UX friction.
Respond with JSON only:
{"assessment": string, "clusters": [{"rootCause": string, "severity": "critical"|"high"|"medium"|"low"|"info", "kind": "defect"|"ux", "findingIds": string[], "summary": string}]}
Every finding id must appear in exactly one cluster. The assessment is 2-4 sentences on overall app quality observed.`;

const SEVERITIES: ExplorerSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const KINDS: ExplorerFindingKind[] = ["defect", "ux"];

interface AnalystOutput {
  assessment?: string;
  clusters: Array<Record<string, unknown>>;
}

function isAnalystOutput(value: unknown): value is AnalystOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { clusters?: unknown }).clusters)
  );
}

function fallbackReport(
  findings: AgentFinding[],
  iterationsRun: number,
): ExplorerReport {
  return {
    clusters: findings.map((f) => ({
      rootCause: f.title.slice(0, 120),
      severity: f.severity,
      kind: f.kind,
      findingIds: [f.id],
      summary: f.description.slice(0, 300),
    })),
    totalFindings: findings.length,
    iterationsRun,
  };
}

export async function clusterFindings(
  config: AIProviderConfig,
  input: {
    findings: AgentFinding[];
    iterationsRun: number;
    repositoryId: string;
    signal?: AbortSignal;
  },
): Promise<ExplorerReport> {
  if (input.findings.length === 0) {
    return {
      clusters: [],
      totalFindings: 0,
      iterationsRun: input.iterationsRun,
      assessment:
        "No defects or UX issues were observed during this exploration.",
    };
  }

  const digest = input.findings
    .map(
      (f) =>
        `id=${f.id} [${f.severity}/${f.kind}] "${f.title}" @ ${f.url ?? "?"}\n  ${f.description.replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");

  let parsed: AnalystOutput | null = null;
  try {
    const raw = await generateWithAI(
      config,
      `FINDINGS (${input.findings.length}):\n${digest}\n\nCluster by root cause. JSON only.`,
      ANALYST_SYSTEM_PROMPT,
      {
        actionType: "explorer_analyze",
        repositoryId: input.repositoryId,
        responseFormat: "json_object",
        signal: input.signal,
      },
    );
    parsed = parseAiJson(raw, isAnalystOutput, { source: "explorer-analyst" });
  } catch {
    parsed = null;
  }
  if (!parsed) return fallbackReport(input.findings, input.iterationsRun);

  const validIds = new Set(input.findings.map((f) => f.id));
  const assigned = new Set<string>();
  const clusters: ExplorerReport["clusters"] = [];

  for (const c of parsed.clusters) {
    const ids = Array.isArray(c.findingIds)
      ? c.findingIds.filter(
          (id): id is string =>
            typeof id === "string" && validIds.has(id) && !assigned.has(id),
        )
      : [];
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));
    clusters.push({
      rootCause:
        typeof c.rootCause === "string"
          ? c.rootCause.slice(0, 160)
          : "Unclustered",
      severity: SEVERITIES.includes(c.severity as ExplorerSeverity)
        ? (c.severity as ExplorerSeverity)
        : "medium",
      kind: KINDS.includes(c.kind as ExplorerFindingKind)
        ? (c.kind as ExplorerFindingKind)
        : "defect",
      findingIds: ids,
      summary: typeof c.summary === "string" ? c.summary.slice(0, 400) : "",
    });
  }

  // Findings the model forgot get singleton clusters — nothing is dropped.
  for (const f of input.findings) {
    if (!assigned.has(f.id)) {
      clusters.push({
        rootCause: f.title.slice(0, 120),
        severity: f.severity,
        kind: f.kind,
        findingIds: [f.id],
        summary: f.description.slice(0, 300),
      });
    }
  }

  return {
    clusters,
    totalFindings: input.findings.length,
    iterationsRun: input.iterationsRun,
    assessment:
      typeof parsed.assessment === "string"
        ? parsed.assessment.slice(0, 1000)
        : undefined,
  };
}
