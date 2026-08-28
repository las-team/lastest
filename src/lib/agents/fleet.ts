import type {
  AgentSession,
  AgentSessionKind,
  AgentStepState,
} from "@/lib/db/schema";
// Type-only, so this module stays pure and importable from a client component:
// `explorer-reads` is `server-only`, and the import is erased at compile time.
import type { ExplorerFleetSession } from "@/lib/core/explorer-reads";

/**
 * The slice of a QA-agent task this module needs.
 *
 * `qa_agent_tasks` belongs to `@lastest/plugin-qa-agent`, and core may not
 * import a plugin's row type — so the escalation merge narrows it the way
 * `@lastest/coverage-model` narrows its rows (`CellLike`, `DimensionLike`).
 * The caller passes `QaAgentTask[]` straight in; it is structurally assignable.
 */
export interface EscalatableTaskLike {
  id: string;
  title: string;
  status: string;
  agentReply: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * The Agents console's view model.
 *
 * Pure derivation — no DB, no clock beyond what the caller passes in — so the
 * roster rules are unit-testable without a database. The page composes rows
 * from two sources that cannot be joined in SQL: core's `agent_sessions` and
 * the explorer plugin's own table, read through
 * `src/lib/core/explorer-reads.ts`. Both arrive here as `FleetRow`s.
 */

/** What the roster groups on. Deliberately not `AgentSessionStatus`: "paused"
 *  and "waiting for a human" are the same DB status but opposite meanings to
 *  whoever is reading the console. */
export type FleetState = "working" | "blocked" | "paused" | "idle";

export interface FleetRow {
  /** Stable per-row key. Session id where there is a live session. */
  id: string;
  /** Which agent this is, for the label and the drill-through target. */
  kind: FleetAgentKind;
  /** Display name — "QA agent", "Explorer", … */
  label: string;
  state: FleetState;
  /** One line of what it is doing right now, already flattened. */
  narration: string | null;
  /** 0-100, or null for agents that do not report step progress. */
  progress: number | null;
  /** Sub-agent role of the active step, when the session reports one. */
  role: string | null;
  /** Where "Open" goes. */
  href: string;
  startedAt: Date | null;
  /** Only set when `state === "blocked"` — what the agent is waiting for. */
  blockedOn: string | null;
  /**
   * Whether this agent is *expected* to be holding an embedded browser.
   *
   * Inferred from the run's own state (`working` or `blocked`), NOT read back
   * from the EB pool — core has no pool handle on a page render, and the pool
   * service is a separate process. It is therefore an estimate: an agent whose
   * browser already crashed still reports true, and a run between claims
   * reports true before it holds anything. The console labels the derived
   * count as an estimate rather than as pool capacity.
   */
  holdsBrowser: boolean;
}

/** Core kinds plus the plugin-owned explorer. */
export type FleetAgentKind = AgentSessionKind | "explorer";

const KIND_LABELS: Record<FleetAgentKind, string> = {
  qa: "QA agent",
  ranger: "Ranger",
  play: "Play agent",
  quickstart: "QuickStart",
  explorer: "Explorer",
};

const KIND_HREFS: Record<FleetAgentKind, string> = {
  qa: "/qa-agent",
  ranger: "/run",
  play: "/tests",
  quickstart: "/",
  explorer: "/explorer",
};

export function fleetLabel(kind: FleetAgentKind): string {
  return KIND_LABELS[kind];
}

/**
 * The step a session is "at" — the first non-settled one, matching what
 * `PhaseTimeline` highlights so the console and the drill-through never
 * disagree about which phase is current.
 */
export function activeStep(session: AgentSession): AgentStepState | undefined {
  return session.steps.find(
    (s) =>
      s.status === "active" ||
      s.status === "waiting_user" ||
      s.status === "failed",
  );
}

/**
 * One line of narration: the active step plus its freshest running substep.
 *
 * Mirrors `sessionNarration` in `qa-agent-header.tsx`. That copy stays where it
 * is — it is a client component and this module is imported by the server page
 * — but the two must produce the same sentence for the same session.
 */
export function sessionNarration(session: AgentSession): string | null {
  const step = activeStep(session);
  if (!step) return null;
  const running = [...(step.substeps ?? [])]
    .reverse()
    .find((s) => s.status === "running");
  if (running) return `${step.label} — ${running.detail ?? running.label}`;
  return `${step.label} — ${step.description}`;
}

/** Same formula as `use-qa-agent.ts` so the console's bar matches the page's. */
export function sessionProgress(session: AgentSession): number {
  const done = session.steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length;
  const total = session.steps.length;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/**
 * A blocked agent is one whose current step is a human gate. It is NOT the
 * same as `status === "paused"` — a paused agent was stopped by a person and
 * has released its browser, while a blocked one is mid-run and still holding
 * it. The console separates them because the second costs pool capacity and
 * the first does not.
 */
export function deriveState(session: AgentSession): FleetState {
  if (session.status === "paused") return "paused";
  if (session.status !== "active") return "idle";
  return activeStep(session)?.status === "waiting_user" ? "blocked" : "working";
}

/** Build a roster row from a core `agent_sessions` row. */
export function rowFromSession(session: AgentSession): FleetRow {
  const step = activeStep(session);
  const state = deriveState(session);
  const role =
    [...(step?.substeps ?? [])].reverse().find((s) => s.agent)?.agent ?? null;
  return {
    id: session.id,
    kind: session.kind,
    label: KIND_LABELS[session.kind],
    state,
    narration: sessionNarration(session),
    progress: sessionProgress(session),
    role,
    href: KIND_HREFS[session.kind],
    startedAt: session.createdAt ?? null,
    blockedOn:
      state === "blocked" ? (step?.description ?? step?.label ?? null) : null,
    // A run holds its browser for as long as it is not settled — including
    // while it waits on a human, which is the whole point of showing this.
    holdsBrowser: state === "working" || state === "blocked",
  };
}

/** A kind with no live session still gets a row, so the roster shows the whole
 *  fleet rather than only what happens to be running. */
export function idleRow(kind: FleetAgentKind): FleetRow {
  return {
    id: `idle:${kind}`,
    kind,
    label: KIND_LABELS[kind],
    state: "idle",
    narration: null,
    progress: null,
    role: null,
    href: KIND_HREFS[kind],
    startedAt: null,
    blockedOn: null,
    holdsBrowser: false,
  };
}

/**
 * The explorer's projection, as a roster row.
 *
 * Kept here beside `rowFromSession` rather than in the read port so both
 * sources land on one shape and one set of rules — the console must not care
 * which table a row came from.
 *
 * Takes `ExplorerFleetSession` itself rather than an inline structural copy of
 * it: two hand-maintained shapes that must stay byte-identical would let a
 * field added to the projection be silently dropped here.
 */
export function rowFromExplorer(session: ExplorerFleetSession): FleetRow {
  const state: FleetState =
    session.status === "paused"
      ? "paused"
      : session.awaitingUser
        ? "blocked"
        : "working";
  const narration = session.stepLabel
    ? session.stepDetail
      ? `${session.stepLabel} — ${session.stepDetail}`
      : session.stepLabel
    : null;
  return {
    id: session.id,
    kind: "explorer",
    label: KIND_LABELS.explorer,
    state,
    narration: session.targetUrl
      ? `${narration ?? "Exploring"} · ${session.targetUrl}`
      : narration,
    progress: session.progress,
    // Explorer's steps carry no sub-agent role the way a QA run's do.
    role: null,
    href: KIND_HREFS.explorer,
    startedAt: session.startedAt,
    blockedOn: state === "blocked" ? session.stepLabel : null,
    holdsBrowser: state === "working" || state === "blocked",
  };
}

export interface FleetSummary {
  working: number;
  blocked: number;
  paused: number;
  idle: number;
  /**
   * Estimated browsers held by this repo's agents — the count of rows whose
   * `holdsBrowser` is inferred true. See the field's note: this is derived
   * from run state, not read from the EB pool, so it is an upper bound on
   * capacity actually in use.
   */
  browsersHeld: number;
}

export function summarise(rows: FleetRow[]): FleetSummary {
  return {
    working: rows.filter((r) => r.state === "working").length,
    blocked: rows.filter((r) => r.state === "blocked").length,
    paused: rows.filter((r) => r.state === "paused").length,
    idle: rows.filter((r) => r.state === "idle").length,
    browsersHeld: rows.filter((r) => r.holdsBrowser).length,
  };
}

/**
 * Roster order: the rows that need a human first, then what is running, then
 * everything at rest. Within a group, most recently started first.
 */
const STATE_ORDER: Record<FleetState, number> = {
  blocked: 0,
  working: 1,
  paused: 2,
  idle: 3,
};

export function sortRoster(rows: FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    return (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
  });
}

/**
 * Everything an agent is waiting on a human for, in one list.
 *
 * Two sources, deliberately merged: a session parked on a `waiting_user` step,
 * and a `qa_tasks` row the agent pushed back with `needs_input`. They are the
 * same thing to whoever has to answer them.
 */
export interface Escalation {
  id: string;
  kind: FleetAgentKind;
  label: string;
  question: string;
  href: string;
  since: Date | null;
  /** True when answering this frees a browser back to the pool. */
  holdsBrowser: boolean;
}

export function escalationsFrom(
  rows: FleetRow[],
  tasks: EscalatableTaskLike[],
): Escalation[] {
  const fromSessions: Escalation[] = rows
    .filter((r) => r.state === "blocked")
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      question: r.blockedOn ?? "Waiting for a decision",
      href: r.href,
      since: r.startedAt,
      holdsBrowser: r.holdsBrowser,
    }));

  const fromTasks: Escalation[] = tasks
    .filter((t) => t.status === "needs_input")
    .map((t) => ({
      id: `task:${t.id}`,
      kind: "qa" as const,
      label: KIND_LABELS.qa,
      question: t.agentReply ?? t.title,
      href: "/qa-agent",
      since: t.updatedAt ?? t.createdAt ?? null,
      // A task pushed back to the queue is not holding anything — the run that
      // raised it has already ended.
      holdsBrowser: false,
    }));

  // Oldest first — the thing that has been waiting longest is the thing to
  // answer next. An escalation with no timestamp sorts LAST rather than
  // pinning to the top forever: `?? 0` would make "unknown" read as "waiting
  // since 1970".
  return [...fromSessions, ...fromTasks].sort((a, b) => {
    const at = a.since?.getTime();
    const bt = b.since?.getTime();
    if (at === undefined || Number.isNaN(at))
      return bt === undefined || Number.isNaN(bt) ? 0 : 1;
    if (bt === undefined || Number.isNaN(bt)) return -1;
    return at - bt;
  });
}
