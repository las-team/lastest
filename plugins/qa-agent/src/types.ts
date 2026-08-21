/**
 * QA Agent's own domain types, plus the narrowed views of core's.
 *
 * Two different things live here and recipe §6.1's "narrow, or promote?" table
 * is what separates them:
 *
 * - **Promoted (elsewhere).** The ~27 `Qa*` payload shapes — the test plan,
 *   the crawl snapshot, the coverage matrix, the PR diff facts — are this
 *   plugin's own jsonb and were moved to `@lastest/eb-protocol` in the core PR
 *   ahead of this migration, because core's `AgentSessionMetadata` still has
 *   to name them. Import them from there, not from here.
 * - **Narrowed (here).** `agent_sessions` is a **core** table shared by three
 *   `kind`s, so its row and step shapes belong to core. The plugin declares
 *   only the fields it reads; `src/lib/core/qa-agent-host.ts` carries the
 *   `satisfies` clauses that keep the two in step. If core's shape drifts,
 *   that file stops type-checking — which is what makes narrowing not a fork.
 *
 * The task-board types below are the third case: `qa_agent_tasks` is the
 * plugin's own table, so they are simply its own types.
 */

import type {
  QaGeneratedTestStatus,
  QaRunMode,
  QaSessionTrigger,
} from "@lastest/eb-protocol";

// ── The plugin's own table (`qa_agent_tasks`) ────────────────────────────────

export type QaTaskStatus =
  | "queued"
  | "working"
  /** The agent finished abnormally (failed/cancelled run) and left a reply —
   *  the human decides whether to retry (→ queued) or drop (→ cancelled). */
  | "needs_input"
  | "done"
  | "cancelled";

export type QaTaskSource = "user" | "mcp" | "coverage_gap";

/** A test the task's run touched — rendered as a linked chip on the board card
 *  when the task settles. `status` is the ledger outcome at settle time. */
export interface QaTaskTestRef {
  testId: string;
  name: string;
  status: QaGeneratedTestStatus;
}

// ── Narrowed views of core's `agent_sessions` ────────────────────────────────

/** The nine steps of the QA pipeline. A strict subset of core's `AgentStepId`
 *  union, which also carries the play/QuickStart/ranger step ids this plugin
 *  never writes. */
export type QaStepId =
  | "qa_setup"
  | "qa_login"
  | "qa_discover"
  | "qa_plan"
  | "qa_plan_review"
  | "qa_generate"
  | "qa_execute"
  | "qa_heal"
  | "qa_summary";

export type QaStepStatus =
  | "pending"
  | "active"
  | "waiting_user"
  | "completed"
  | "failed"
  | "skipped";

/** One substep card under a step. Core's `AgentSubstep` carries several more
 *  planner-observability fields the QA pipeline never sets; these are the ones
 *  it does. */
export interface QaSubstep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  /** Which sub-agent is handling this substep (shown as a badge in the UI).
   *  Narrowed from core's `PwAgentType` to the five values QA emits. */
  agent?: QaAgentRole;
  promptLogId?: string;
  durationMs?: number;
  rawError?: string;
}

/** The `PwAgentType` values this pipeline tags its work with. Narrowed rather
 *  than imported: the full union is core's, shared with the play agent and
 *  three other still-unmigrated agents. */
export type QaAgentRole =
  | "orchestrator"
  | "scout"
  | "planner"
  | "generator"
  | "healer"
  | "ranger";

export interface QaStepState {
  id: QaStepId;
  status: QaStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
  substeps?: QaSubstep[];
}

export type QaSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * The QA-relevant slice of `agent_sessions.metadata`.
 *
 * Core's `AgentSessionMetadata` is an open shape (`[key: string]: unknown`)
 * shared with `play`, `quickstart` and `ranger` rows. Only these keys are QA's,
 * and only these are declared — with the deliberate exception of the two
 * QuickStart credential fields, which QA writes too *and which are encrypted
 * at rest by core's agent-session query layer, by field name, across the whole
 * table*. That sharing is why this plugin does not take its own sessions
 * table; see `host.ts` item 2.
 */
export interface QaSessionMetadata {
  /** Target app URL for the run. */
  qaTargetUrl?: string;
  qaMode?: QaRunMode;
  qaTrigger?: QaSessionTrigger;
  /** Registered/verified app login. Encrypted at rest by core; callers always
   *  see plaintext. Field names are shared with QuickStart by design. */
  quickstartEmail?: string;
  quickstartPassword?: string;
  /** Free-text sign-in instructions from the Explore dialog. Encrypted at rest
   *  by core — the prose routinely contains a password. */
  qaAuthContext?: string;
  /** Proxied EB screencast URL while the run holds a browser. Never a pod
   *  address: core mints it, signed and expiring, on `session.streamUrl`. */
  streamUrl?: string;
  queuedForBrowser?: boolean;
  qaTaskId?: string;
  qaTaskItemIds?: string[];
  [key: string]: unknown;
}

// ── Narrowed views of core's test-config jsonb ───────────────────────────────

/**
 * The check-layer overrides the generator writes onto a `tests` row.
 *
 * Core's `TestPlaywrightOverrides` carries ~20 keys (browser choice, timeouts,
 * every check layer's mode). These four are the only ones this plugin sets —
 * a11y and perf tests enforce their own layer, resilience/negative tests
 * downgrade console+network to `log` because they break the network on
 * purpose. Narrowed rather than imported: the type is core's, describing a
 * core column, and `src/lib/core/qa-agent-host.ts` asserts the two still
 * agree.
 */
export interface QaPlaywrightOverrides {
  a11yMode?: "enforce" | "log" | "disable";
  perfMode?: "enforce" | "log" | "disable";
  networkMode?: "enforce" | "log" | "disable";
  consoleMode?: "enforce" | "log" | "disable";
}

/** The setup chain a generated test inherits — a storage state, a login test,
 *  or neither. Narrowed from core's `TestSetupOverrides`. */
export interface QaSetupOverrides {
  skippedDefaultStepIds: string[];
  extraSteps: Array<{
    stepType: "test" | "script" | "storage_state";
    testId?: string | null;
    scriptId?: string | null;
    storageStateId?: string | null;
  }>;
}

/** The columns of an `agent_sessions` row the plugin reads. */
export interface QaSessionRow {
  id: string;
  repositoryId: string;
  teamId: string | null;
  status: QaSessionStatus;
  currentStepId: QaStepId | null;
  steps: QaStepState[];
  metadata: QaSessionMetadata;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
}
