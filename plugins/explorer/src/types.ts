import type { PageMap } from "@lastest/page-map";

/**
 * Explorer's own vocabulary.
 *
 * All of this used to live in `packages/db/src/schema/agents.ts`, in the union
 * types and metadata bag shared by four different agents. Splitting it out is
 * most of the point of the migration: a `AgentSessionMetadata` with 60 optional
 * fields, of which explorer owned 15 and qa-agent owned 25, is a shape nobody
 * can reason about and every agent can silently break for the others.
 */

export type ExplorerStyle = "normal" | "curious" | "psycho";
export type ExplorerFindingKind = "defect" | "ux";
export type ExplorerSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ExplorerFindingStatus = "open" | "triaged" | "dismissed" | "kept";
export type ExplorerSessionTrigger = "manual" | "schedule" | "mcp";

export type ExplorerSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ExplorerStepId =
  | "explorer_setup"
  | "explorer_login"
  | "explorer_research"
  | "explorer_plan"
  | "explorer_act"
  | "explorer_analyze"
  | "explorer_keep"
  | "explorer_summary";

export type ExplorerStepStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped";

export interface ExplorerSubstep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  agent?: string;
}

export interface ExplorerStepState {
  id: ExplorerStepId;
  status: ExplorerStepStatus;
  label: string;
  description: string;
  /** Loop steps repeat once per iteration; this disambiguates the entries. */
  iteration?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
  substeps?: ExplorerSubstep[];
}

/** How this run authenticates, decided once by the login step. */
export interface ExplorerAuthState {
  strategy: "existing_setup" | "creds_untested" | "public_only";
  validated: boolean;
  /** Opaque id core resolves into credential material. Never a secret. */
  storageStateId?: string;
  setupTestId?: string;
  defaultSetupInUse?: boolean;
  loginUrl?: string;
  notes?: string;
}

export interface ExplorerScenario {
  id: string;
  title: string;
  style: ExplorerStyle;
  steps: string[];
  rationale: string;
  expectedOutcome?: string;
  skipped?: boolean;
}

export interface ExplorerActionStep {
  intent: string;
  action: string;
  selector?: string;
  value?: string;
  result: "ok" | "error" | "blocked";
  note?: string;
}

export type ExplorerScenarioOutcome = "passed" | "failed" | "blocked" | "stuck";

export interface ExplorerActionLog {
  scenarioId: string;
  status: ExplorerScenarioOutcome;
  steps: ExplorerActionStep[];
  consoleErrors?: string[];
  failedRequests?: Array<{ url: string; status: number; method: string }>;
  finalStateHash?: string;
  finalUrl?: string;
  summary?: string;
}

export interface ExplorerReportCluster {
  rootCause: string;
  severity: ExplorerSeverity;
  kind: ExplorerFindingKind;
  findingIds: string[];
  summary: string;
}

export interface ExplorerReport {
  clusters: ExplorerReportCluster[];
  totalFindings: number;
  iterationsRun: number;
  assessment?: string;
}

export type KnowledgeMatchKind = "exact" | "prefix" | "regex";

/** A deterministic pre-step run when a knowledge note matches the page. */
export interface KnowledgePageAutomationStep {
  action: "click" | "fill" | "waitForSelector" | "wait";
  selector?: string;
  value?: string;
}

export type ExperienceNoteKind = "resolution" | "failure" | "observation";

export interface ExperienceNote {
  kind: ExperienceNoteKind;
  text: string;
  scenarioStyle?: ExplorerStyle;
  sessionId?: string;
  /** ISO timestamp. */
  at: string;
}

export interface ExplorerFindingEvidence {
  consoleErrors?: string[];
  failedRequests?: Array<{ url: string; status: number; method: string }>;
  actionSteps?: ExplorerActionStep[];
}

/**
 * Session metadata.
 *
 * Still a jsonb bag, but now a *closed* one — no index signature, and every
 * field belongs to this feature. The old shared bag's `[key: string]: unknown`
 * is what let four agents write into each other's namespace unnoticed.
 */
export interface ExplorerSessionMetadata {
  targetUrl?: string;
  maxIterations?: number;
  /** Current loop index (0-based) — the resume cursor. */
  iteration?: number;
  styleRotation?: ExplorerStyle[];
  /** Ordered page-state hashes (loop detection + experience keys). */
  stateHistory?: string[];
  /** Unvisited same-origin URLs queued for later iterations (BFS frontier). */
  frontier?: string[];
  /** Normalized URLs already researched, for frontier dedup. */
  visitedUrls?: string[];
  pageMap?: PageMap;
  currentState?: { hash: string; url: string; headings: string[] };
  currentPlan?: ExplorerScenario[];
  /** scenarioId → execution log, accumulated across iterations. */
  actionLogs?: Record<string, ExplorerActionLog>;
  findingIds?: string[];
  report?: ExplorerReport;
  keptTestIds?: string[];
  auth?: ExplorerAuthState;
  trigger?: ExplorerSessionTrigger;
  /** True when the stuck-loop heuristic ended the loop early. */
  stuck?: boolean;
  /** Live CDP screencast URL — a signed, expiring grant, never a pod address. */
  streamUrl?: string;
  /** True while a step is blocked waiting for a browser from the pool. */
  queuedForBrowser?: boolean;
  /** Target-app credentials. Encrypted at rest by the query layer. */
  credsProvided?: boolean;
  email?: string;
  password?: string;
}
